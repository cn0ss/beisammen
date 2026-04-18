import { v } from 'convex/values';

import type { Doc, Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import { action, internalMutation, internalQuery, mutation, query } from './_generated/server';
import { canManageCircle, isOwnerRole } from './lib/permissions';
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
import { requireCircleMembership, requireViewer } from './lib/viewer';

export const circleFunctionSurface = [
  'circles.create',
  'circles.listForViewer',
  'circles.getById',
  'circles.update',
  'circles.listMembers',
  'circles.updateMemberRole',
  'circles.removeMember',
  'circles.transferOwnership',
  'circles.leave',
  'circles.createImageTarget',
  'circles.completeImageUpload',
  'circles.removeImage',
  'circles.getImageReadUrl',
] as const;

interface PreparedCircleImageUpload {
  uploadId: Id<'imageUploads'>;
  pendingStorage: NonNullable<Doc<'imageUploads'>['pendingStorage']>;
  mimeType: string;
}

interface CircleImageCompleteContext {
  uploadId: Id<'imageUploads'>;
  pendingStorage: NonNullable<Doc<'imageUploads'>['pendingStorage']>;
}

function buildCircleSummary(
  circle: Doc<'circles'>,
  membership: Doc<'circleMembers'>,
  memberCount: number,
) {
  const canManage = canManageCircle(membership.role);

  return {
    _id: circle._id,
    _creationTime: circle._creationTime,
    name: circle.name,
    description: circle.description ?? '',
    role: membership.role,
    memberCount,
    createdAt: circle.createdAt,
    hasImage: Boolean(circle.imageStorage),
    canManage,
    canEdit: canManage,
    canInvite: canManage,
    canLeave: !isOwnerRole(membership.role),
    isOwner: isOwnerRole(membership.role),
  };
}

function buildDisplayName(user: Doc<'users'> | null) {
  if (!user) {
    return 'Unbekannte Person';
  }

  return user.displayName?.trim() || user.email?.trim() || 'Unbekannte Person';
}

function roleSortValue(role: Doc<'circleMembers'>['role']) {
  switch (role) {
    case 'owner':
      return 0;
    case 'admin':
      return 1;
    default:
      return 2;
  }
}

export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const now = Date.now();
    const circleId = await ctx.db.insert('circles', {
      name: args.name.trim(),
      ...(args.description ? { description: args.description.trim() } : {}),
      createdBy: viewer._id,
      createdAt: now,
    });
    await ctx.db.insert('circleMembers', {
      circleId,
      userId: viewer._id,
      role: 'owner',
      joinedAt: now,
    });

    return {
      circleId,
    };
  },
});

export const listForViewer = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewer(ctx);
    const memberships = await ctx.db
      .query('circleMembers')
      .withIndex('by_user', (q) => q.eq('userId', viewer._id))
      .collect();

    const circles = await Promise.all(
      memberships.map(async (membership) => {
        const circle = await ctx.db.get(membership.circleId);

        if (!circle) {
          return null;
        }

        const members = await ctx.db
          .query('circleMembers')
          .withIndex('by_circle', (q) => q.eq('circleId', circle._id))
          .collect();

        return buildCircleSummary(circle, membership, members.length);
      }),
    );

    return circles
      .filter((circle): circle is NonNullable<typeof circle> => circle !== null)
      .sort((left, right) => right.createdAt - left.createdAt);
  },
});

export const getById = query({
  args: {
    circleId: v.id('circles'),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const membership = await requireCircleMembership(ctx, viewer._id, args.circleId);
    const circle = await ctx.db.get(args.circleId);

    if (!circle) {
      throw new Error('Circle not found.');
    }

    const members = await ctx.db
      .query('circleMembers')
      .withIndex('by_circle', (q) => q.eq('circleId', args.circleId))
      .collect();

    return buildCircleSummary(circle, membership, members.length);
  },
});

export const update = mutation({
  args: {
    circleId: v.id('circles'),
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const membership = await requireCircleMembership(ctx, viewer._id, args.circleId);

    if (!canManageCircle(membership.role)) {
      throw new Error('Only owners and admins can edit the circle.');
    }

    const circle = await ctx.db.get(args.circleId);

    if (!circle) {
      throw new Error('Circle not found.');
    }

    await ctx.db.patch(circle._id, {
      name: args.name.trim(),
      description: args.description?.trim() ? args.description.trim() : undefined,
    });

    return {
      circleId: circle._id,
    };
  },
});

export const listMembers = query({
  args: {
    circleId: v.id('circles'),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const viewerMembership = await requireCircleMembership(ctx, viewer._id, args.circleId);

    const memberships = await ctx.db
      .query('circleMembers')
      .withIndex('by_circle', (q) => q.eq('circleId', args.circleId))
      .collect();

    const members = await Promise.all(
      memberships.map(async (membership) => {
        const user = await ctx.db.get(membership.userId);
        const isSelf = membership.userId === viewer._id;
        const viewerIsOwner = isOwnerRole(viewerMembership.role);
        const targetIsOwner = isOwnerRole(membership.role);

        return {
          _id: membership._id,
          userId: membership.userId,
          role: membership.role,
          joinedAt: membership.joinedAt,
          isSelf,
          displayName: buildDisplayName(user),
          email: user?.email,
          avatarUrl: user?.avatarUrl,
          hasProfileImage: Boolean(user?.profileImageStorage),
          canChangeRole: viewerIsOwner && !isSelf && !targetIsOwner,
          canRemove: viewerIsOwner && !isSelf && !targetIsOwner,
          canTransferOwnership: viewerIsOwner && !isSelf && !targetIsOwner,
        };
      }),
    );

    return members.sort((left, right) => {
      const roleDelta = roleSortValue(left.role) - roleSortValue(right.role);

      if (roleDelta !== 0) {
        return roleDelta;
      }

      return left.displayName.localeCompare(right.displayName, 'de', {
        sensitivity: 'base',
      });
    });
  },
});

export const updateMemberRole = mutation({
  args: {
    circleId: v.id('circles'),
    memberId: v.id('circleMembers'),
    role: v.union(v.literal('admin'), v.literal('member')),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const viewerMembership = await requireCircleMembership(ctx, viewer._id, args.circleId);

    if (!isOwnerRole(viewerMembership.role)) {
      throw new Error('Only the owner can change member roles.');
    }

    const targetMembership = await ctx.db.get(args.memberId);

    if (!targetMembership || targetMembership.circleId !== args.circleId) {
      throw new Error('Target member not found.');
    }

    if (targetMembership.userId === viewer._id) {
      throw new Error('You cannot change your own role.');
    }

    if (isOwnerRole(targetMembership.role)) {
      throw new Error('The circle owner role cannot be changed here.');
    }

    await ctx.db.patch(targetMembership._id, {
      role: args.role,
    });

    return {
      memberId: targetMembership._id,
      role: args.role,
    };
  },
});

export const removeMember = mutation({
  args: {
    circleId: v.id('circles'),
    memberId: v.id('circleMembers'),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const viewerMembership = await requireCircleMembership(ctx, viewer._id, args.circleId);

    if (!isOwnerRole(viewerMembership.role)) {
      throw new Error('Only the owner can remove members.');
    }

    const targetMembership = await ctx.db.get(args.memberId);

    if (!targetMembership || targetMembership.circleId !== args.circleId) {
      throw new Error('Target member not found.');
    }

    if (targetMembership.userId === viewer._id) {
      throw new Error('Use leave to remove yourself from the circle.');
    }

    if (isOwnerRole(targetMembership.role)) {
      throw new Error('The circle owner cannot be removed.');
    }

    await ctx.db.delete(targetMembership._id);

    return {
      memberId: targetMembership._id,
    };
  },
});

export const transferOwnership = mutation({
  args: {
    circleId: v.id('circles'),
    targetMemberId: v.id('circleMembers'),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const viewerMembership = await requireCircleMembership(ctx, viewer._id, args.circleId);

    if (!isOwnerRole(viewerMembership.role)) {
      throw new Error('Only the owner can transfer ownership.');
    }

    const targetMembership = await ctx.db.get(args.targetMemberId);

    if (!targetMembership || targetMembership.circleId !== args.circleId) {
      throw new Error('Target member not found.');
    }

    if (targetMembership.userId === viewer._id) {
      throw new Error('Ownership cannot be transferred to yourself.');
    }

    if (isOwnerRole(targetMembership.role)) {
      throw new Error('That member already owns the circle.');
    }

    await ctx.db.patch(viewerMembership._id, {
      role: 'admin',
    });
    await ctx.db.patch(targetMembership._id, {
      role: 'owner',
    });

    return {
      circleId: args.circleId,
      ownerMemberId: targetMembership._id,
    };
  },
});

export const leave = mutation({
  args: {
    circleId: v.id('circles'),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const membership = await requireCircleMembership(ctx, viewer._id, args.circleId);

    if (isOwnerRole(membership.role)) {
      throw new Error('Transfer ownership before leaving the circle.');
    }

    await ctx.db.delete(membership._id);

    return {
      circleId: args.circleId,
    };
  },
});

export const prepareImageUpload = internalMutation({
  args: {
    circleId: v.id('circles'),
    mimeType: v.string(),
    fileName: v.string(),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const membership = await requireCircleMembership(ctx, viewer._id, args.circleId);

    if (!canManageCircle(membership.role)) {
      throw new Error('Only owners and admins can update the circle image.');
    }

    const storageMode = getCurrentInstanceStorage();

    requireS3StorageProvider(storageMode.providerKind);

    const uploadId = await ctx.db.insert('imageUploads', {
      targetKind: 'circle-image',
      userId: viewer._id,
      circleId: args.circleId,
      providerKind: storageMode.providerKind,
      fileName: args.fileName.trim(),
      mimeType: args.mimeType.trim(),
      status: 'uploading',
      createdAt: Date.now(),
    });

    const pendingStorage = buildS3StorageReference({
      objectKey: buildImageUploadObjectKey({
        targetKind: 'circle-image',
        userId: viewer._id,
        circleId: args.circleId,
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

export const markImageUploadFailed = internalMutation({
  args: {
    uploadId: v.id('imageUploads'),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const upload = await ctx.db.get(args.uploadId);

    if (!upload || upload.userId !== viewer._id || upload.targetKind !== 'circle-image') {
      return null;
    }

    if (upload.circleId) {
      const membership = await requireCircleMembership(ctx, viewer._id, upload.circleId);

      if (!canManageCircle(membership.role)) {
        return null;
      }
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

export const getImageCompleteContext = internalQuery({
  args: {
    uploadId: v.id('imageUploads'),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const upload = await ctx.db.get(args.uploadId);

    if (!upload || upload.userId !== viewer._id || upload.targetKind !== 'circle-image') {
      throw new Error('Circle image upload not found.');
    }

    if (!upload.circleId) {
      throw new Error('Circle image upload is missing its circle.');
    }

    const membership = await requireCircleMembership(ctx, viewer._id, upload.circleId);

    if (!canManageCircle(membership.role)) {
      throw new Error('Only owners and admins can update the circle image.');
    }

    if (!upload.pendingStorage) {
      throw new Error('Circle image upload is missing its storage target.');
    }

    return {
      uploadId: upload._id,
      pendingStorage: upload.pendingStorage,
      circleId: upload.circleId,
    };
  },
});

export const finalizeImageUpload = internalMutation({
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

    if (!upload || upload.userId !== viewer._id || upload.targetKind !== 'circle-image') {
      throw new Error('Circle image upload not found.');
    }

    if (!upload.circleId) {
      throw new Error('Circle image upload is missing its circle.');
    }

    const membership = await requireCircleMembership(ctx, viewer._id, upload.circleId);

    if (!canManageCircle(membership.role)) {
      throw new Error('Only owners and admins can update the circle image.');
    }

    const circle = await ctx.db.get(upload.circleId);

    if (!circle) {
      throw new Error('Circle not found.');
    }

    const previousStorage = circle.imageStorage;

    await ctx.db.patch(circle._id, {
      imageStorage: args.storage,
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

export const clearImage = internalMutation({
  args: {
    circleId: v.id('circles'),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const membership = await requireCircleMembership(ctx, viewer._id, args.circleId);

    if (!canManageCircle(membership.role)) {
      throw new Error('Only owners and admins can update the circle image.');
    }

    const circle = await ctx.db.get(args.circleId);

    if (!circle) {
      throw new Error('Circle not found.');
    }

    const previousStorage = circle.imageStorage;

    await ctx.db.patch(circle._id, {
      imageStorage: undefined,
    });

    return {
      previousStorage: previousStorage ?? null,
    };
  },
});

export const getImageReadContext = internalQuery({
  args: {
    circleId: v.id('circles'),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    await requireCircleMembership(ctx, viewer._id, args.circleId);

    const circle = await ctx.db.get(args.circleId);

    if (!circle) {
      throw new Error('Circle not found.');
    }

    return {
      storage: circle.imageStorage ?? null,
    };
  },
});

export const createImageTarget = action({
  args: {
    circleId: v.id('circles'),
    mimeType: v.string(),
    fileName: v.string(),
  },
  handler: async (ctx, args) => {
    const prepared: PreparedCircleImageUpload = await ctx.runMutation(
      internal.circles.prepareImageUpload,
      args,
    );

    if (prepared.pendingStorage.provider !== 's3') {
      throw new Error('Circle image upload target could not be prepared.');
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

export const completeImageUpload = action({
  args: {
    uploadId: v.id('imageUploads'),
    objectKey: v.optional(v.string()),
    storageId: v.optional(v.id('_storage')),
  },
  handler: async (ctx, args) => {
    try {
      const completeContext: CircleImageCompleteContext = await ctx.runQuery(
        internal.circles.getImageCompleteContext,
        {
          uploadId: args.uploadId,
        },
      );

      if (completeContext.pendingStorage.provider !== 's3') {
        throw new Error('Circle image upload is missing its S3 storage reference.');
      }

      if (args.objectKey !== completeContext.pendingStorage.objectKey) {
        throw new Error('Completed circle image object key does not match the prepared target.');
      }

      await verifyS3ObjectExists({
        storage: completeContext.pendingStorage,
      });

      const finalized: {
        previousStorage: Doc<'circles'>['imageStorage'] | null;
        nextStorage: NonNullable<Doc<'circles'>['imageStorage']>;
      } = await ctx.runMutation(internal.circles.finalizeImageUpload, {
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
      await ctx.runMutation(internal.circles.markImageUploadFailed, {
        uploadId: args.uploadId,
        message: error instanceof Error ? error.message : 'Circle image upload failed.',
      });
      throw error;
    }
  },
});

export const removeImage = action({
  args: {
    circleId: v.id('circles'),
  },
  handler: async (ctx, args) => {
    const cleared: {
      previousStorage: Doc<'circles'>['imageStorage'] | null;
    } = await ctx.runMutation(internal.circles.clearImage, {
      circleId: args.circleId,
    });

    if (cleared.previousStorage) {
      await deleteStorageReference(ctx, cleared.previousStorage);
    }

    return {
      removed: Boolean(cleared.previousStorage),
    };
  },
});

export const getImageReadUrl = action({
  args: {
    circleId: v.id('circles'),
  },
  handler: async (ctx, args) => {
    const context: {
      storage: Doc<'circles'>['imageStorage'] | null;
    } = await ctx.runQuery(internal.circles.getImageReadContext, {
      circleId: args.circleId,
    });

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
