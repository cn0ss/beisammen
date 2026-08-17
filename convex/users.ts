import { v } from 'convex/values';

import type { Doc, Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import { action, internalMutation, internalQuery, mutation, query } from './_generated/server';
import { deleteStorageReference, storageReferenceKey } from './legacyStorage';
import {
  createS3ReadUrl,
  createS3UploadTarget,
  deleteS3Object,
  verifyS3ObjectExists,
} from './lib/storage/s3';
import {
  buildImageUploadObjectKey,
  buildS3StorageReference,
  getCurrentInstanceStorage,
  requireS3StorageProvider,
} from './lib/storage/shared';
import { assertValidDeclaredImageSize } from './lib/uploadLimits';
import { requireViewer } from './lib/viewer';

export const userFunctionSurface = [
  'users.viewer',
  'users.viewerState',
  'users.upsertFromIdentity',
  'users.createProfileImageTarget',
  'users.completeProfileImageUpload',
  'users.removeProfileImage',
  'users.getProfileImageReadUrl',
] as const;

function serializeViewer(viewer: Doc<'users'>) {
  return {
    _id: viewer._id,
    _creationTime: viewer._creationTime,
    tokenIdentifier: viewer.tokenIdentifier,
    authProvider: viewer.authProvider,
    authSubject: viewer.authSubject,
    email: viewer.email,
    displayName: viewer.displayName,
    avatarUrl: viewer.avatarUrl,
    createdAt: viewer.createdAt,
    hasProfileImage: Boolean(viewer.profileImageStorage),
    deletionRequestedAt: viewer.deletionRequestedAt,
    deletionCompletedAt: viewer.deletionCompletedAt,
  };
}

interface PreparedProfileImageUpload {
  uploadId: Id<'imageUploads'>;
  pendingStorage: NonNullable<Doc<'imageUploads'>['pendingStorage']>;
  mimeType: string;
  sizeBytes: number;
}

interface ProfileImageCompleteContext {
  uploadId: Id<'imageUploads'>;
  pendingStorage: NonNullable<Doc<'imageUploads'>['pendingStorage']>;
  declaredSizeBytes?: number;
}

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      return null;
    }

    const record = await ctx.db
      .query('users')
      .withIndex('by_token_identifier', (q) =>
        q.eq('tokenIdentifier', identity.tokenIdentifier),
      )
      .unique();

    return record ? serializeViewer(record) : null;
  },
});

export const viewerState = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      return {
        isAuthenticated: false,
        viewer: null,
      };
    }

    const record = await ctx.db
      .query('users')
      .withIndex('by_token_identifier', (q) =>
        q.eq('tokenIdentifier', identity.tokenIdentifier),
      )
      .unique();

    return {
      isAuthenticated: true,
      viewer: record ? serializeViewer(record) : null,
    };
  },
});

export const upsertFromIdentity = mutation({
  args: {
    email: v.optional(v.string()),
    displayName: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      throw new Error('Authenticated user required.');
    }

    const existing = await ctx.db
      .query('users')
      .withIndex('by_token_identifier', (q) =>
        q.eq('tokenIdentifier', identity.tokenIdentifier),
      )
      .unique();

    const email = args.email ?? identity.email;
    const displayName = args.displayName ?? identity.name;
    const avatarUrl = args.avatarUrl ?? identity.pictureUrl;

    if (existing) {
      if (existing.deletionRequestedAt !== undefined) {
        return serializeViewer(existing);
      }

      const patch: {
        authProvider: 'clerk';
        authSubject: string;
        email?: string;
        displayName?: string;
        avatarUrl?: string;
      } = {
        authProvider: 'clerk',
        authSubject: identity.subject,
      };

      if (email !== undefined) {
        patch.email = email;
      }

      if (displayName !== undefined) {
        patch.displayName = displayName;
      }

      if (avatarUrl !== undefined) {
        patch.avatarUrl = avatarUrl;
      }

      await ctx.db.patch(existing._id, patch);

      const updated = await ctx.db.get(existing._id);
      return updated ? serializeViewer(updated) : null;
    }

    const userId = await ctx.db.insert('users', {
      tokenIdentifier: identity.tokenIdentifier,
      authProvider: 'clerk',
      authSubject: identity.subject,
      createdAt: Date.now(),
      ...(email !== undefined ? { email } : {}),
      ...(displayName !== undefined ? { displayName } : {}),
      ...(avatarUrl !== undefined ? { avatarUrl } : {}),
    });

    const created = await ctx.db.get(userId);
    return created ? serializeViewer(created) : null;
  },
});

export const prepareProfileImageUpload = internalMutation({
  args: {
    mimeType: v.string(),
    fileName: v.string(),
    sizeBytes: v.number(),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const storageMode = getCurrentInstanceStorage();

    requireS3StorageProvider(storageMode.providerKind);
    assertValidDeclaredImageSize(args.sizeBytes);

    const uploadId = await ctx.db.insert('imageUploads', {
      targetKind: 'user-profile',
      userId: viewer._id,
      providerKind: storageMode.providerKind,
      fileName: args.fileName.trim(),
      mimeType: args.mimeType.trim(),
      // Declared byte size, enforced by signing content-length into the
      // presigned PUT and re-checked against the S3 HEAD at completion.
      sizeBytes: args.sizeBytes,
      status: 'uploading',
      createdAt: Date.now(),
    });

    const pendingStorage = buildS3StorageReference({
      objectKey: buildImageUploadObjectKey({
        targetKind: 'user-profile',
        userId: viewer._id,
        fileName: args.fileName.trim(),
        uploadId,
      }),
    });

    await ctx.db.patch(uploadId, {
      pendingStorage,
    });

    return {
      uploadId,
      pendingStorage,
      mimeType: args.mimeType.trim(),
      sizeBytes: args.sizeBytes,
    };
  },
});

export const authorizeProfileImageUpload = internalQuery({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewer(ctx);

    return {
      userId: viewer._id,
    };
  },
});

export const markProfileImageUploadFailed = internalMutation({
  args: {
    uploadId: v.id('imageUploads'),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const upload = await ctx.db.get(args.uploadId);

    if (!upload || upload.userId !== viewer._id || upload.targetKind !== 'user-profile') {
      return null;
    }

    await ctx.db.patch(upload._id, {
      status: 'failed',
      failureReason: args.message,
    });

    return {
      uploadId: upload._id,
    };
  },
});

export const getProfileImageCompleteContext = internalQuery({
  args: {
    uploadId: v.id('imageUploads'),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const upload = await ctx.db.get(args.uploadId);

    if (!upload || upload.userId !== viewer._id || upload.targetKind !== 'user-profile') {
      throw new Error('Profile image upload not found.');
    }

    if (!upload.pendingStorage) {
      throw new Error('Profile image upload is missing its storage target.');
    }

    return {
      uploadId: upload._id,
      pendingStorage: upload.pendingStorage,
      declaredSizeBytes: upload.sizeBytes,
      previousSizeBytes: viewer.profileImageSizeBytes ?? 0,
    };
  },
});

export const finalizeProfileImageUpload = internalMutation({
  args: {
    uploadId: v.id('imageUploads'),
    storage: v.object({
      provider: v.literal('s3'),
      objectKey: v.string(),
      bucket: v.string(),
      region: v.optional(v.string()),
      endpoint: v.optional(v.string()),
      basePath: v.optional(v.string()),
    }),
    sizeBytes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const upload = await ctx.db.get(args.uploadId);

    if (!upload || upload.userId !== viewer._id || upload.targetKind !== 'user-profile') {
      throw new Error('Profile image upload not found.');
    }

    const previousStorage = viewer.profileImageStorage;

    await ctx.db.patch(viewer._id, {
      profileImageStorage: args.storage,
      profileImageSizeBytes: args.sizeBytes,
    });
    await ctx.db.patch(upload._id, {
      storage: args.storage,
      pendingStorage: undefined,
      sizeBytes: args.sizeBytes,
      status: 'uploaded',
      failureReason: undefined,
      completedAt: Date.now(),
    });

    return {
      previousStorage: previousStorage ?? null,
      previousSizeBytes: viewer.profileImageSizeBytes ?? 0,
      nextStorage: args.storage,
    };
  },
});

export const clearProfileImage = internalMutation({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewer(ctx);
    const previousStorage = viewer.profileImageStorage;

    await ctx.db.patch(viewer._id, {
      profileImageStorage: undefined,
      profileImageSizeBytes: undefined,
    });

    return {
      previousStorage: previousStorage ?? null,
      previousSizeBytes: viewer.profileImageSizeBytes ?? 0,
    };
  },
});

export const getProfileImageDeleteContext = internalQuery({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewer(ctx);

    return {
      previousStorage: viewer.profileImageStorage ?? null,
      previousSizeBytes: viewer.profileImageSizeBytes ?? 0,
    };
  },
});

const PROFILE_IMAGE_SHARED_CIRCLE_LIMIT = 200;

export const getProfileImageReadContext = internalQuery({
  args: {
    userId: v.optional(v.id('users')),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);

    if (!args.userId || args.userId === viewer._id) {
      return {
        storage: viewer.profileImageStorage ?? null,
      };
    }

    const target = await ctx.db.get(args.userId);

    if (!target?.profileImageStorage) {
      return { storage: null };
    }

    // Another member's image is only visible when both share a circle.
    const viewerMemberships = await ctx.db
      .query('circleMembers')
      .withIndex('by_user', (q) => q.eq('userId', viewer._id))
      .take(PROFILE_IMAGE_SHARED_CIRCLE_LIMIT);

    for (const membership of viewerMemberships) {
      const sharedMembership = await ctx.db
        .query('circleMembers')
        .withIndex('by_circle_and_user', (q) =>
          q.eq('circleId', membership.circleId).eq('userId', args.userId!),
        )
        .unique();

      if (sharedMembership) {
        return { storage: target.profileImageStorage };
      }
    }

    return { storage: null };
  },
});

export const createProfileImageTarget = action({
  args: {
    mimeType: v.string(),
    fileName: v.string(),
    sizeBytes: v.number(),
  },
  handler: async (ctx, args) => {
    // Profile images are deliberately exempt from cloud billing: one small,
    // client-compressed file per user, always allowed regardless of plan.
    // The declared size is still validated and signed into the PUT so the
    // presigned URL cannot be used to store an arbitrarily large object.
    await ctx.runQuery(internal.users.authorizeProfileImageUpload, {});

    const prepared: PreparedProfileImageUpload = await ctx.runMutation(
      internal.users.prepareProfileImageUpload,
      args,
    );

    if (prepared.pendingStorage.provider !== 's3') {
      throw new Error('Profile image upload target could not be prepared.');
    }

    return {
      uploadId: prepared.uploadId,
      target: await createS3UploadTarget({
        storage: prepared.pendingStorage,
        mimeType: prepared.mimeType,
        sizeBytes: prepared.sizeBytes,
      }),
    };
  },
});

export const completeProfileImageUpload = action({
  args: {
    uploadId: v.id('imageUploads'),
    objectKey: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    try {
      const completeContext: ProfileImageCompleteContext & { previousSizeBytes: number } =
        await ctx.runQuery(
          internal.users.getProfileImageCompleteContext,
          {
            uploadId: args.uploadId,
          },
        );

      if (completeContext.pendingStorage.provider !== 's3') {
        throw new Error('Profile image upload is missing its S3 storage reference.');
      }

      if (args.objectKey !== completeContext.pendingStorage.objectKey) {
        throw new Error('Completed profile image object key does not match the prepared target.');
      }

      const verified = await verifyS3ObjectExists({
        storage: completeContext.pendingStorage,
      });

      // Belt and suspenders: the signed content-length already pins the PUT
      // to the declared size. On a mismatch, drop the object and fail.
      if (
        completeContext.declaredSizeBytes !== undefined &&
        verified.sizeBytes !== completeContext.declaredSizeBytes
      ) {
        await deleteS3Object({ storage: completeContext.pendingStorage });
        throw new Error('Uploaded profile image size does not match the declared size.');
      }

      const finalized: {
        previousStorage: Doc<'users'>['profileImageStorage'] | null;
        previousSizeBytes: number;
        nextStorage: NonNullable<Doc<'users'>['profileImageStorage']>;
      } = await ctx.runMutation(internal.users.finalizeProfileImageUpload, {
        uploadId: args.uploadId,
        storage: completeContext.pendingStorage,
        // The server-observed size is authoritative.
        sizeBytes: verified.sizeBytes,
      });

      if (
        finalized.previousStorage &&
        storageReferenceKey(finalized.previousStorage) !== storageReferenceKey(finalized.nextStorage)
      ) {
        await deleteStorageReference(ctx, finalized.previousStorage);
      }

      return {
        uploadId: args.uploadId,
      };
    } catch (error) {
      await ctx.runMutation(internal.users.markProfileImageUploadFailed, {
        uploadId: args.uploadId,
        message: error instanceof Error ? error.message : 'Profile image upload failed.',
      });
      throw error;
    }
  },
});

export const removeProfileImage = action({
  args: {},
  handler: async (ctx) => {
    const deleteContext: {
      previousStorage: Doc<'users'>['profileImageStorage'] | null;
      previousSizeBytes: number;
    } = await ctx.runQuery(internal.users.getProfileImageDeleteContext, {});

    if (!deleteContext.previousStorage) {
      return {
        removed: false,
      };
    }

    await deleteStorageReference(ctx, deleteContext.previousStorage);
    await ctx.runMutation(internal.users.clearProfileImage, {});

    return {
      removed: true,
    };
  },
});

export const getProfileImageReadUrl = action({
  args: {
    // Omitted: the viewer's own image. Set: another member's image, only
    // resolvable when both share a circle.
    userId: v.optional(v.id('users')),
  },
  handler: async (ctx, args) => {
    const context: {
      storage: Doc<'users'>['profileImageStorage'] | null;
    } = await ctx.runQuery(internal.users.getProfileImageReadContext, {
      ...(args.userId ? { userId: args.userId } : {}),
    });

    if (!context.storage) {
      return {
        url: null,
        expiresAt: null,
      };
    }

    // The convex-files read path is gone. Remaining legacy rows must be moved
    // to S3 first via `npx convex run legacyStorage:migrateBatch`.
    if (context.storage.provider !== 's3') {
      throw new Error('Legacy media must be migrated to S3.');
    }

    return await createS3ReadUrl({
      storage: context.storage,
    });
  },
});
