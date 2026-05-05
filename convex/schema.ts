import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

const circleRole = v.union(v.literal('owner'), v.literal('admin'), v.literal('member'));
// Legacy: 'convex-files' retained for existing data. New uploads always use 's3'.
const storageProviderKind = v.union(v.literal('convex-files'), v.literal('s3'));
const mediaLocation = v.object({
  latitude: v.number(),
  longitude: v.number(),
  accuracyMeters: v.optional(v.number()),
  label: v.optional(v.string()),
  city: v.optional(v.string()),
  region: v.optional(v.string()),
  country: v.optional(v.string()),
  source: v.union(v.literal('embedded'), v.literal('device-fallback')),
});
const storageReference = v.union(
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
);

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    authProvider: v.union(v.literal('workos'), v.literal('convex-auth')),
    authSubject: v.string(),
    email: v.optional(v.string()),
    displayName: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    profileImageStorage: v.optional(storageReference),
    profileImageSizeBytes: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_token_identifier', ['tokenIdentifier'])
    .index('by_auth_provider_and_auth_subject', ['authProvider', 'authSubject'])
    .index('by_email', ['email']),

  circles: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    imageStorage: v.optional(storageReference),
    imageSizeBytes: v.optional(v.number()),
    billingOwnerId: v.optional(v.id('users')),
    createdBy: v.id('users'),
    createdAt: v.number(),
  }).index('by_created_by', ['createdBy']),

  circleMembers: defineTable({
    circleId: v.id('circles'),
    userId: v.id('users'),
    role: circleRole,
    joinedAt: v.number(),
  })
    .index('by_circle', ['circleId'])
    .index('by_user', ['userId'])
    .index('by_user_and_joined_at', ['userId', 'joinedAt'])
    .index('by_circle_and_user', ['circleId', 'userId'])
    .index('by_circle_and_role', ['circleId', 'role']),

  circleStats: defineTable({
    circleId: v.id('circles'),
    memberCount: v.number(),
    imageCount: v.number(),
    videoCount: v.number(),
    totalSizeBytes: v.number(),
    updatedAt: v.number(),
  }).index('by_circle', ['circleId']),

  invites: defineTable({
    circleId: v.id('circles'),
    invitedEmail: v.string(),
    role: v.union(v.literal('admin'), v.literal('member')),
    tokenHash: v.string(),
    status: v.union(
      v.literal('pending'),
      v.literal('accepted'),
      v.literal('expired'),
      v.literal('revoked'),
    ),
    invitedBy: v.id('users'),
    expiresAt: v.number(),
    acceptedAt: v.optional(v.number()),
  })
    .index('by_circle', ['circleId'])
    .index('by_circle_and_expires_at', ['circleId', 'expiresAt'])
    .index('by_invited_email', ['invitedEmail'])
    .index('by_token_hash', ['tokenHash']),

  shareBatches: defineTable({
    circleId: v.id('circles'),
    authorId: v.id('users'),
    caption: v.optional(v.string()),
    assetCount: v.number(),
    status: v.union(v.literal('draft'), v.literal('published')),
    createdAt: v.number(),
    updatedAt: v.number(),
    publishedAt: v.optional(v.number()),
  })
    .index('by_circle', ['circleId'])
    .index('by_author', ['authorId'])
    .index('by_circle_and_author_and_status', ['circleId', 'authorId', 'status'])
    .index('by_circle_and_status', ['circleId', 'status']),

  assets: defineTable({
    shareBatchId: v.id('shareBatches'),
    circleId: v.id('circles'),
    kind: v.union(v.literal('image'), v.literal('video')),
    // Widened for migration: older assets were created before fileName existed.
    fileName: v.optional(v.string()),
    mimeType: v.string(),
    sizeBytes: v.optional(v.number()),
    storage: storageReference,
    previewStorage: v.optional(storageReference),
    createdAt: v.number(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    durationSeconds: v.optional(v.number()),
    location: v.optional(mediaLocation),
  })
    .index('by_share_batch', ['shareBatchId'])
    .index('by_circle', ['circleId']),

  uploads: defineTable({
    shareBatchId: v.id('shareBatches'),
    circleId: v.id('circles'),
    createdBy: v.id('users'),
    assetId: v.optional(v.id('assets')),
    providerKind: storageProviderKind,
    pendingStorage: v.optional(storageReference),
    previewPendingStorage: v.optional(storageReference),
    kind: v.union(v.literal('image'), v.literal('video')),
    fileName: v.string(),
    mimeType: v.string(),
    storage: v.optional(storageReference),
    previewStorage: v.optional(storageReference),
    status: v.union(
      v.literal('draft'),
      v.literal('uploading'),
      v.literal('uploaded'),
      v.literal('failed'),
    ),
    failureReason: v.optional(v.string()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index('by_circle', ['circleId'])
    .index('by_status', ['status'])
    .index('by_status_and_created_at', ['status', 'createdAt'])
    .index('by_asset', ['assetId'])
    .index('by_share_batch', ['shareBatchId'])
    .index('by_share_batch_and_status', ['shareBatchId', 'status']),

  imageUploads: defineTable({
    targetKind: v.union(v.literal('user-profile'), v.literal('circle-image')),
    userId: v.id('users'),
    circleId: v.optional(v.id('circles')),
    providerKind: storageProviderKind,
    pendingStorage: v.optional(storageReference),
    storage: v.optional(storageReference),
    fileName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.optional(v.number()),
    status: v.union(
      v.literal('uploading'),
      v.literal('uploaded'),
      v.literal('failed'),
    ),
    failureReason: v.optional(v.string()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index('by_user', ['userId'])
    .index('by_circle', ['circleId'])
    .index('by_status_and_created_at', ['status', 'createdAt'])
    .index('by_target_kind_and_user', ['targetKind', 'userId']),

  waitlistEntries: defineTable({
    email: v.string(),
    normalizedEmail: v.string(),
    locale: v.union(v.literal('en'), v.literal('de')),
    source: v.literal('landing'),
    referrer: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    submissionCount: v.number(),
  }).index('by_normalized_email', ['normalizedEmail']),

  activityEvents: defineTable({
    circleId: v.id('circles'),
    actorId: v.id('users'),
    type: v.string(),
    entityId: v.string(),
    shareBatchId: v.optional(v.id('shareBatches')),
    assetId: v.optional(v.id('assets')),
    commentId: v.optional(v.id('comments')),
    reactionId: v.optional(v.id('reactions')),
    createdAt: v.number(),
  })
    .index('by_circle', ['circleId'])
    .index('by_share_batch', ['shareBatchId'])
    .index('by_circle_and_entity_id', ['circleId', 'entityId'])
    .index('by_circle_and_created_at', ['circleId', 'createdAt']),

  activityInboxItems: defineTable({
    activityEventId: v.id('activityEvents'),
    userId: v.id('users'),
    circleId: v.id('circles'),
    actorId: v.id('users'),
    type: v.string(),
    shareBatchId: v.id('shareBatches'),
    assetId: v.optional(v.id('assets')),
    status: v.union(v.literal('unread'), v.literal('read')),
    createdAt: v.number(),
    readAt: v.optional(v.number()),
  })
    .index('by_user_and_created_at', ['userId', 'createdAt'])
    .index('by_user_and_status_and_created_at', ['userId', 'status', 'createdAt'])
    .index('by_activity_event_id', ['activityEventId'])
    .index('by_share_batch', ['shareBatchId']),

  comments: defineTable({
    shareBatchId: v.id('shareBatches'),
    assetId: v.optional(v.id('assets')),
    circleId: v.id('circles'),
    authorId: v.id('users'),
    targetKind: v.union(v.literal('share'), v.literal('asset')),
    targetKey: v.string(),
    body: v.string(),
    status: v.union(v.literal('active'), v.literal('deleted')),
    createdAt: v.number(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
  })
    .index('by_share_batch', ['shareBatchId'])
    .index('by_asset', ['assetId'])
    .index('by_circle_and_share_batch', ['circleId', 'shareBatchId'])
    .index('by_share_batch_and_status', ['shareBatchId', 'status'])
    .index('by_share_target_status_created_at', [
      'shareBatchId',
      'targetKey',
      'status',
      'createdAt',
    ]),

  reactions: defineTable({
    shareBatchId: v.id('shareBatches'),
    assetId: v.optional(v.id('assets')),
    circleId: v.id('circles'),
    userId: v.id('users'),
    targetKind: v.union(v.literal('share'), v.literal('asset')),
    targetKey: v.string(),
    emoji: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_share_batch', ['shareBatchId'])
    .index('by_asset', ['assetId'])
    .index('by_circle_and_share_batch', ['circleId', 'shareBatchId'])
    .index('by_share_target', ['shareBatchId', 'targetKey'])
    .index('by_share_target_user', ['shareBatchId', 'targetKey', 'userId']),
});
