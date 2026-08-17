import { v } from 'convex/values';

import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { ActionCtx, MutationCtx, QueryCtx } from './_generated/server';
import { internalAction, internalMutation, internalQuery } from './_generated/server';
import { createS3UploadTarget, deleteS3Object, verifyS3ObjectExists } from './lib/storage/s3';
import { buildS3StorageReference } from './lib/storage/shared';

/**
 * Everything that still knows about the legacy 'convex-files' storage
 * provider lives in this file. The runtime code path that served or accepted
 * media through Convex file storage has been removed; what remains is:
 *
 * 1. A narrowly-scoped deletion helper (`deleteStorageReference`) so cleanup
 *    flows (account deletion, circle purge, stale-media cron, share/asset
 *    deletion) never fail on rows written before the S3 migration.
 * 2. A manual data migration that MOVES legacy blobs to S3.
 *
 * Migration runbook (run against production):
 *
 *   npx convex run legacyStorage:countLegacyRows
 *   npx convex run legacyStorage:migrateBatch        # repeat until migrated=0
 *   npx convex run legacyStorage:countLegacyRows     # expect all-zero counts
 *                                                    # with isTruncated=false
 *
 * `migrateBatch` reads each legacy blob via ctx.storage.get, PUTs it to S3
 * under the deterministic key `legacy/convex-files/<storageId>`, patches every
 * row that references it to the S3 shape, and only then deletes the Convex
 * blob. It is safe to re-run until it reports zero migrated and zero failed.
 *
 * Once `countLegacyRows` reports zero legacy rows everywhere (with
 * isTruncated=false), the 'convex-files' members of the storage unions in
 * convex/schema.ts and this whole file can be deleted in a follow-up.
 */

/** Storage reference as persisted in the schema; may still be legacy. */
export type StoredStorageReference = Doc<'assets'>['storage'];

const LEGACY_TABLES = ['assets', 'uploads', 'imageUploads', 'users', 'circles'] as const;

type LegacyTable = (typeof LEGACY_TABLES)[number];

type LegacyField =
  | 'storage'
  | 'previewStorage'
  | 'pendingStorage'
  | 'previewPendingStorage'
  | 'profileImageStorage'
  | 'imageStorage';

const COUNT_SCAN_LIMIT = 512;
const DEFAULT_MIGRATE_BATCH_SIZE = 10;
const MAX_MIGRATE_BATCH_SIZE = 25;

/** Stable dedupe key for storage references, including legacy ones. */
export function storageReferenceKey(storage: StoredStorageReference): string {
  if (storage.provider === 'convex-files') {
    return `convex-files:${storage.storageId}`;
  }

  return [
    's3',
    storage.bucket,
    storage.region ?? '',
    storage.endpoint ?? '',
    storage.basePath ?? '',
    storage.objectKey,
  ].join(':');
}

/**
 * Deletes the object behind a stored storage reference. This is the only
 * place outside `migrateBatch` that may still touch Convex file storage: rows
 * written before the S3 migration must always remain deletable (account
 * deletion in particular must never fail on old data). No bytes are ever
 * served through this path.
 */
export async function deleteStorageReference(
  ctx: MutationCtx | ActionCtx,
  storage: StoredStorageReference,
): Promise<void> {
  if (storage.provider === 'convex-files') {
    const existingUrl = await ctx.storage.getUrl(storage.storageId);

    if (!existingUrl) {
      return;
    }

    await ctx.storage.delete(storage.storageId);
    return;
  }

  await deleteS3Object({
    storage,
  });
}

function isLegacyReference(
  value: StoredStorageReference | undefined,
): value is { provider: 'convex-files'; storageId: Id<'_storage'> } {
  return value?.provider === 'convex-files';
}

interface LegacyReferenceItem {
  table: LegacyTable;
  docId: string;
  field: LegacyField;
  storageId: Id<'_storage'>;
  mimeType?: string;
}

interface TableScan {
  items: LegacyReferenceItem[];
  scanned: number;
  isTruncated: boolean;
}

function collectItem(
  items: LegacyReferenceItem[],
  table: LegacyTable,
  docId: string,
  field: LegacyField,
  value: StoredStorageReference | undefined,
  mimeType?: string,
): void {
  if (isLegacyReference(value)) {
    items.push({
      table,
      docId,
      field,
      storageId: value.storageId,
      ...(mimeType ? { mimeType } : {}),
    });
  }
}

async function scanTableForLegacyReferences(
  ctx: QueryCtx,
  table: LegacyTable,
): Promise<TableScan> {
  const items: LegacyReferenceItem[] = [];
  let scanned = 0;

  switch (table) {
    case 'assets': {
      const rows = await ctx.db.query('assets').take(COUNT_SCAN_LIMIT);
      scanned = rows.length;

      for (const row of rows) {
        collectItem(items, 'assets', row._id, 'storage', row.storage, row.mimeType);
        collectItem(items, 'assets', row._id, 'previewStorage', row.previewStorage, 'image/jpeg');
      }
      break;
    }
    case 'uploads': {
      const rows = await ctx.db.query('uploads').take(COUNT_SCAN_LIMIT);
      scanned = rows.length;

      for (const row of rows) {
        collectItem(items, 'uploads', row._id, 'pendingStorage', row.pendingStorage, row.mimeType);
        collectItem(
          items,
          'uploads',
          row._id,
          'previewPendingStorage',
          row.previewPendingStorage,
          'image/jpeg',
        );
        collectItem(items, 'uploads', row._id, 'storage', row.storage, row.mimeType);
        collectItem(items, 'uploads', row._id, 'previewStorage', row.previewStorage, 'image/jpeg');
      }
      break;
    }
    case 'imageUploads': {
      const rows = await ctx.db.query('imageUploads').take(COUNT_SCAN_LIMIT);
      scanned = rows.length;

      for (const row of rows) {
        collectItem(items, 'imageUploads', row._id, 'pendingStorage', row.pendingStorage, row.mimeType);
        collectItem(items, 'imageUploads', row._id, 'storage', row.storage, row.mimeType);
      }
      break;
    }
    case 'users': {
      const rows = await ctx.db.query('users').take(COUNT_SCAN_LIMIT);
      scanned = rows.length;

      for (const row of rows) {
        collectItem(items, 'users', row._id, 'profileImageStorage', row.profileImageStorage);
      }
      break;
    }
    case 'circles': {
      const rows = await ctx.db.query('circles').take(COUNT_SCAN_LIMIT);
      scanned = rows.length;

      for (const row of rows) {
        collectItem(items, 'circles', row._id, 'imageStorage', row.imageStorage);
      }
      break;
    }
  }

  return {
    items,
    scanned,
    isTruncated: scanned >= COUNT_SCAN_LIMIT,
  };
}

/**
 * Bounded per-table count of rows that still reference 'convex-files'
 * storage. `isTruncated: true` means the table has more rows than the scan
 * window, so a zero count is not yet conclusive for that table.
 */
export const countLegacyRows = internalQuery({
  args: {},
  returns: v.record(
    v.string(),
    v.object({
      legacyReferences: v.number(),
      scanned: v.number(),
      isTruncated: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const counts: Record<
      string,
      { legacyReferences: number; scanned: number; isTruncated: boolean }
    > = {};

    for (const table of LEGACY_TABLES) {
      const scan = await scanTableForLegacyReferences(ctx, table);

      counts[table] = {
        legacyReferences: scan.items.length,
        scanned: scan.scanned,
        isTruncated: scan.isTruncated,
      };
    }

    return counts;
  },
});

const legacyReferenceItemValidator = v.object({
  table: v.union(
    v.literal('assets'),
    v.literal('uploads'),
    v.literal('imageUploads'),
    v.literal('users'),
    v.literal('circles'),
  ),
  docId: v.string(),
  field: v.union(
    v.literal('storage'),
    v.literal('previewStorage'),
    v.literal('pendingStorage'),
    v.literal('previewPendingStorage'),
    v.literal('profileImageStorage'),
    v.literal('imageStorage'),
  ),
  storageId: v.id('_storage'),
  mimeType: v.optional(v.string()),
});

const s3StorageReferenceValidator = v.object({
  provider: v.literal('s3'),
  objectKey: v.string(),
  bucket: v.string(),
  region: v.optional(v.string()),
  endpoint: v.optional(v.string()),
  basePath: v.optional(v.string()),
});

export const listLegacyReferences = internalQuery({
  args: {
    limit: v.number(),
  },
  returns: v.object({
    references: v.array(legacyReferenceItemValidator),
    hasMore: v.boolean(),
    scanTruncated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.floor(args.limit));
    const references: LegacyReferenceItem[] = [];
    let hasMore = false;
    let scanTruncated = false;

    for (const table of LEGACY_TABLES) {
      const scan = await scanTableForLegacyReferences(ctx, table);

      scanTruncated = scanTruncated || scan.isTruncated;

      for (const item of scan.items) {
        if (references.length >= limit) {
          hasMore = true;
          break;
        }

        references.push(item);
      }
    }

    return {
      references,
      hasMore: hasMore || scanTruncated,
      scanTruncated,
    };
  },
});

export const patchLegacyReferences = internalMutation({
  args: {
    storageId: v.id('_storage'),
    storage: s3StorageReferenceValidator,
    items: v.array(
      v.object({
        table: legacyReferenceItemValidator.fields.table,
        docId: v.string(),
        field: legacyReferenceItemValidator.fields.field,
      }),
    ),
  },
  returns: v.object({
    patched: v.number(),
  }),
  handler: async (ctx, args) => {
    let patched = 0;
    const matches = (value: StoredStorageReference | undefined): boolean =>
      isLegacyReference(value) && value.storageId === args.storageId;

    for (const item of args.items) {
      switch (item.table) {
        case 'assets': {
          const id = ctx.db.normalizeId('assets', item.docId);
          const doc = id ? await ctx.db.get(id) : null;

          if (!id || !doc || (item.field !== 'storage' && item.field !== 'previewStorage')) {
            break;
          }

          if (item.field === 'storage' && matches(doc.storage)) {
            await ctx.db.patch(id, { storage: args.storage });
            patched += 1;
          } else if (item.field === 'previewStorage' && matches(doc.previewStorage)) {
            await ctx.db.patch(id, { previewStorage: args.storage });
            patched += 1;
          }
          break;
        }
        case 'uploads': {
          const id = ctx.db.normalizeId('uploads', item.docId);
          const doc = id ? await ctx.db.get(id) : null;

          if (!id || !doc) {
            break;
          }

          if (item.field === 'pendingStorage' && matches(doc.pendingStorage)) {
            await ctx.db.patch(id, { pendingStorage: args.storage });
            patched += 1;
          } else if (item.field === 'previewPendingStorage' && matches(doc.previewPendingStorage)) {
            await ctx.db.patch(id, { previewPendingStorage: args.storage });
            patched += 1;
          } else if (item.field === 'storage' && matches(doc.storage)) {
            await ctx.db.patch(id, { storage: args.storage });
            patched += 1;
          } else if (item.field === 'previewStorage' && matches(doc.previewStorage)) {
            await ctx.db.patch(id, { previewStorage: args.storage });
            patched += 1;
          }
          break;
        }
        case 'imageUploads': {
          const id = ctx.db.normalizeId('imageUploads', item.docId);
          const doc = id ? await ctx.db.get(id) : null;

          if (!id || !doc) {
            break;
          }

          if (item.field === 'pendingStorage' && matches(doc.pendingStorage)) {
            await ctx.db.patch(id, { pendingStorage: args.storage });
            patched += 1;
          } else if (item.field === 'storage' && matches(doc.storage)) {
            await ctx.db.patch(id, { storage: args.storage });
            patched += 1;
          }
          break;
        }
        case 'users': {
          const id = ctx.db.normalizeId('users', item.docId);
          const doc = id ? await ctx.db.get(id) : null;

          if (id && doc && item.field === 'profileImageStorage' && matches(doc.profileImageStorage)) {
            await ctx.db.patch(id, { profileImageStorage: args.storage });
            patched += 1;
          }
          break;
        }
        case 'circles': {
          const id = ctx.db.normalizeId('circles', item.docId);
          const doc = id ? await ctx.db.get(id) : null;

          if (id && doc && item.field === 'imageStorage' && matches(doc.imageStorage)) {
            await ctx.db.patch(id, { imageStorage: args.storage });
            patched += 1;
          }
          break;
        }
      }
    }

    return {
      patched,
    };
  },
});

function legacyMigrationObjectKey(storageId: Id<'_storage'>): string {
  // Deterministic per blob so a partially applied pass (blob copied, but a
  // reference outside the scan window not yet patched) can be completed by a
  // later pass without re-reading the deleted Convex blob.
  return ['legacy', 'convex-files', storageId].join('/');
}

/**
 * Moves a bounded batch of legacy 'convex-files' blobs to S3 and patches
 * every discovered row to the S3 reference shape. Run manually via
 * `npx convex run legacyStorage:migrateBatch` until it reports zero migrated,
 * zero failed, and hasMore=false; then confirm with `countLegacyRows`.
 */
export const migrateBatch = internalAction({
  args: {
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    migrated: v.number(),
    referencesPatched: v.number(),
    failed: v.array(v.string()),
    hasMore: v.boolean(),
    scanTruncated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const batchSize = Math.max(
      1,
      Math.min(MAX_MIGRATE_BATCH_SIZE, Math.floor(args.batchSize ?? DEFAULT_MIGRATE_BATCH_SIZE)),
    );
    const batch: {
      references: LegacyReferenceItem[];
      hasMore: boolean;
      scanTruncated: boolean;
    } = await ctx.runQuery(internal.legacyStorage.listLegacyReferences, {
      limit: batchSize,
    });
    const groups = new Map<Id<'_storage'>, LegacyReferenceItem[]>();

    for (const reference of batch.references) {
      const group = groups.get(reference.storageId) ?? [];

      group.push(reference);
      groups.set(reference.storageId, group);
    }

    let migrated = 0;
    let referencesPatched = 0;
    const failed: string[] = [];

    for (const [storageId, items] of groups) {
      try {
        const storage = buildS3StorageReference({
          objectKey: legacyMigrationObjectKey(storageId),
        });
        const blob = await ctx.storage.get(storageId);

        if (blob) {
          if (blob.size <= 0) {
            throw new Error('Legacy blob is empty; migrate it manually.');
          }

          const mimeType =
            blob.type ||
            items.find((item) => item.mimeType)?.mimeType ||
            'application/octet-stream';
          const target = await createS3UploadTarget({
            storage,
            mimeType,
            sizeBytes: blob.size,
          });
          const response = await fetch(target.uploadUrl, {
            method: 'PUT',
            headers: target.headers,
            body: blob,
          });

          if (!response.ok) {
            throw new Error(`Legacy blob upload to S3 failed with status ${response.status}.`);
          }
        } else {
          // The blob was already moved by an earlier pass that missed this
          // reference. Verify the deterministic object exists before pointing
          // the row at it; throws if the data is genuinely gone.
          await verifyS3ObjectExists({ storage });
        }

        const result: { patched: number } = await ctx.runMutation(
          internal.legacyStorage.patchLegacyReferences,
          {
            storageId,
            storage,
            items: items.map((item) => ({
              table: item.table,
              docId: item.docId,
              field: item.field,
            })),
          },
        );

        referencesPatched += result.patched;

        if (blob) {
          await ctx.storage.delete(storageId);
        }

        migrated += 1;
      } catch (error) {
        failed.push(
          `${storageId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return {
      migrated,
      referencesPatched,
      failed,
      hasMore: batch.hasMore || failed.length > 0,
      scanTruncated: batch.scanTruncated,
    };
  },
});
