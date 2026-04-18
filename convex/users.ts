import { v } from 'convex/values';

import type { Doc, Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import { action, internalMutation, internalQuery, mutation, query } from './_generated/server';
import { createS3ReadUrl, createS3UploadTarget, verifyS3ObjectExists } from './lib/storage/s3';
import {
  buildImageUploadObjectKey,
  buildS3StorageReference,
  deleteStorageReference,
  getCurrentInstanceStorage,
  requireS3StorageProvider,
  resolveConvexReadUrl,
  storageReferenceKey,
} from './lib/storage/shared';
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
  };
}

interface PreparedProfileImageUpload {
  uploadId: Id<'imageUploads'>;
  pendingStorage: NonNullable<Doc<'imageUploads'>['pendingStorage']>;
  mimeType: string;
}

interface ProfileImageCompleteContext {
  uploadId: Id<'imageUploads'>;
  pendingStorage: NonNullable<Doc<'imageUploads'>['pendingStorage']>;
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

    if (existing) {
      const patch: {
        authProvider: 'workos';
        authSubject: string;
        email?: string;
        displayName?: string;
        avatarUrl?: string;
      } = {
        authProvider: 'workos',
        authSubject: identity.subject,
      };

      if (args.email !== undefined) {
        patch.email = args.email;
      }

      if (args.displayName !== undefined) {
        patch.displayName = args.displayName;
      }

      if (args.avatarUrl !== undefined) {
        patch.avatarUrl = args.avatarUrl;
      }

      await ctx.db.patch(existing._id, patch);

      const updated = await ctx.db.get(existing._id);
      return updated ? serializeViewer(updated) : null;
    }

    return await ctx.db.insert('users', {
      tokenIdentifier: identity.tokenIdentifier,
      authProvider: 'workos',
      authSubject: identity.subject,
      createdAt: Date.now(),
      ...(args.email !== undefined ? { email: args.email } : {}),
      ...(args.displayName !== undefined ? { displayName: args.displayName } : {}),
      ...(args.avatarUrl !== undefined ? { avatarUrl: args.avatarUrl } : {}),
    });
  },
});

export const prepareProfileImageUpload = internalMutation({
  args: {
    mimeType: v.string(),
    fileName: v.string(),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const storageMode = getCurrentInstanceStorage();

    requireS3StorageProvider(storageMode.providerKind);

    const uploadId = await ctx.db.insert('imageUploads', {
      targetKind: 'user-profile',
      userId: viewer._id,
      providerKind: storageMode.providerKind,
      fileName: args.fileName.trim(),
      mimeType: args.mimeType.trim(),
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
    };
  },
});

export const finalizeProfileImageUpload = internalMutation({
  args: {
    uploadId: v.id('imageUploads'),
    storage: v.union(
      v.object({
        provider: v.literal('convex-files'),
        storageId: v.id('_storage'),
      }),
      v.object({
        provider: v.literal('s3'),
        objectKey: v.string(),
        bucket: v.string(),
        region: v.optional(v.string()),
        endpoint: v.optional(v.string()),
        basePath: v.optional(v.string()),
      }),
    ),
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
    });
    await ctx.db.patch(upload._id, {
      storage: args.storage,
      pendingStorage: undefined,
      status: 'uploaded',
      failureReason: undefined,
      completedAt: Date.now(),
    });

    return {
      previousStorage: previousStorage ?? null,
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
    });

    return {
      previousStorage: previousStorage ?? null,
    };
  },
});

export const getProfileImageReadContext = internalQuery({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewer(ctx);

    return {
      storage: viewer.profileImageStorage ?? null,
    };
  },
});

export const createProfileImageTarget = action({
  args: {
    mimeType: v.string(),
    fileName: v.string(),
  },
  handler: async (ctx, args) => {
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
      }),
    };
  },
});

export const completeProfileImageUpload = action({
  args: {
    uploadId: v.id('imageUploads'),
    objectKey: v.optional(v.string()),
    storageId: v.optional(v.id('_storage')),
  },
  handler: async (ctx, args) => {
    try {
      const completeContext: ProfileImageCompleteContext = await ctx.runQuery(
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

      await verifyS3ObjectExists({
        storage: completeContext.pendingStorage,
      });

      const finalized: {
        previousStorage: Doc<'users'>['profileImageStorage'] | null;
        nextStorage: NonNullable<Doc<'users'>['profileImageStorage']>;
      } = await ctx.runMutation(internal.users.finalizeProfileImageUpload, {
        uploadId: args.uploadId,
        storage: completeContext.pendingStorage,
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
    const cleared: {
      previousStorage: Doc<'users'>['profileImageStorage'] | null;
    } = await ctx.runMutation(internal.users.clearProfileImage, {});

    if (cleared.previousStorage) {
      await deleteStorageReference(ctx, cleared.previousStorage);
    }

    return {
      removed: Boolean(cleared.previousStorage),
    };
  },
});

export const getProfileImageReadUrl = action({
  args: {},
  handler: async (ctx) => {
    const context: {
      storage: Doc<'users'>['profileImageStorage'] | null;
    } = await ctx.runQuery(internal.users.getProfileImageReadContext, {});

    if (!context.storage) {
      return {
        url: null,
        expiresAt: null,
      };
    }

    if (context.storage.provider === 'convex-files') {
      return await resolveConvexReadUrl(ctx, context.storage.storageId);
    }

    return await createS3ReadUrl({
      storage: context.storage,
    });
  },
});
