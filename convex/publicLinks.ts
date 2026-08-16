import { v } from 'convex/values';

import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { ActionCtx, MutationCtx, QueryCtx } from './_generated/server';
import { internalAction, internalQuery, mutation, query } from './_generated/server';
import { listShareAssetsForDisplay } from './lib/shareAssets';
import { createS3ReadUrl } from './lib/storage/s3';
import { formatFeedTimestamp, resolveConvexReadUrl } from './lib/storage/shared';
import { isManageRole, requireCircleMembership, requireViewer } from './lib/viewer';

export const publicLinkFunctionSurface = [
  'publicLinks.createForCircle',
  'publicLinks.listForCircle',
  'publicLinks.revoke',
] as const;

const PUBLIC_LINK_DEFAULT_TTL_DAYS = 365;
const PUBLIC_LINK_ACTIVE_REVOKE_LIMIT = 20;
const PUBLIC_LINK_LIST_LIMIT = 20;
const PUBLIC_SHARE_PAGE_SIZE = 12;

type PublicCircleLink = Doc<'publicCircleLinks'>;
type PublicAssetStorage = Doc<'assets'>['storage'];

interface PublicAssetRecord {
  _id: Id<'assets'>;
  kind: Doc<'assets'>['kind'];
  fileName?: string;
  mimeType: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  capturedAt?: number;
  storage: PublicAssetStorage;
  previewStorage?: PublicAssetStorage;
}

interface PublicShareRecord {
  _id: Id<'shareBatches'>;
  caption: string;
  assetCount: number;
  authorName: string;
  publishedAt: number;
  createdAtLabel: string;
  assets: PublicAssetRecord[];
}

interface PublicCirclePage {
  circle: {
    _id: Id<'circles'>;
    name: string;
    description: string;
  };
  link: {
    expiresAt: number;
  };
  shares: PublicShareRecord[];
  isDone: boolean;
  continueCursor: string;
}

interface SignedPublicAssetRecord extends Omit<PublicAssetRecord, 'storage' | 'previewStorage'> {
  url: string | null;
  previewUrl: string | null;
  expiresAt: number | null;
}

interface SignedPublicCirclePage {
  circle: PublicCirclePage['circle'];
  link: PublicCirclePage['link'];
  shares: Array<Omit<PublicShareRecord, 'assets'> & { assets: SignedPublicAssetRecord[] }>;
  isDone: boolean;
  continueCursor: string;
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function readPublicShareBaseUrl(): string {
  const configured =
    process.env.PUBLIC_WEB_BASE_URL ??
    process.env.PUBLIC_SITE_URL ??
    process.env.INSTANCE_BASE_URL ??
    process.env.CONVEX_SITE_URL ??
    'http://127.0.0.1:4321';

  return trimTrailingSlashes(configured);
}

function buildPublicShareUrl(token: string): string {
  return `${readPublicShareBaseUrl()}/share/#${encodeURIComponent(token)}`;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function createPublicToken(): string {
  return `${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`;
}

async function hashPublicToken(token: string): Promise<string> {
  const normalizedToken = token.trim();
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(normalizedToken),
  );

  return `sha256:${toHex(digest)}`;
}

function publicLinkStatus(link: PublicCircleLink, now: number): 'active' | 'expired' | 'revoked' {
  if (link.status === 'revoked') {
    return 'revoked';
  }

  return link.expiresAt <= now ? 'expired' : 'active';
}

async function requirePublicLinkManager(
  ctx: QueryCtx | MutationCtx,
  circleId: Id<'circles'>,
) {
  const viewer = await requireViewer(ctx);
  const membership = await requireCircleMembership(ctx, viewer._id, circleId);

  if (!isManageRole(membership.role)) {
    throw new Error('Only owners and admins can manage public links.');
  }

  return viewer;
}

async function findActiveLinkByToken(
  ctx: QueryCtx | MutationCtx,
  token: string,
): Promise<PublicCircleLink | null> {
  const normalizedToken = token.trim();

  if (!normalizedToken) {
    return null;
  }

  const tokenHash = await hashPublicToken(normalizedToken);
  const link = await ctx.db
    .query('publicCircleLinks')
    .withIndex('by_token_hash', (q) => q.eq('tokenHash', tokenHash))
    .unique();

  if (!link || publicLinkStatus(link, Date.now()) !== 'active') {
    return null;
  }

  return link;
}

async function revokeActiveLinksForCircle(
  ctx: MutationCtx,
  circleId: Id<'circles'>,
  viewerId: Id<'users'>,
) {
  const activeLinks = await ctx.db
    .query('publicCircleLinks')
    .withIndex('by_circle_and_status', (q) =>
      q.eq('circleId', circleId).eq('status', 'active'),
    )
    .take(PUBLIC_LINK_ACTIVE_REVOKE_LIMIT);
  const now = Date.now();

  for (const link of activeLinks) {
    await ctx.db.patch(link._id, {
      status: 'revoked',
      updatedAt: now,
      revokedAt: now,
      revokedBy: viewerId,
    });
  }
}

async function mapShareForPublicPage(
  ctx: QueryCtx,
  shareBatch: Doc<'shareBatches'>,
): Promise<PublicShareRecord | null> {
  if (shareBatch.status !== 'published') {
    return null;
  }

  const author = await ctx.db.get(shareBatch.authorId);
  const assets = await listShareAssetsForDisplay(ctx, shareBatch._id);

  return {
    _id: shareBatch._id,
    caption: shareBatch.caption ?? '',
    assetCount: shareBatch.assetCount,
    authorName: author?.displayName?.trim() || author?.email?.trim() || 'Unbekannt',
    publishedAt: shareBatch.publishedAt ?? shareBatch.createdAt,
    createdAtLabel: formatFeedTimestamp(shareBatch.publishedAt ?? shareBatch.createdAt),
    assets: assets.map((asset) => ({
      _id: asset._id,
      kind: asset.kind,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      width: asset.width,
      height: asset.height,
      durationSeconds: asset.durationSeconds,
      capturedAt: asset.capturedAt,
      storage: asset.storage,
      previewStorage: asset.previewStorage,
    })),
  };
}

async function signStorage(
  ctx: ActionCtx,
  storage: PublicAssetStorage,
): Promise<{ url: string | null; expiresAt: number | null }> {
  if (storage.provider === 'convex-files') {
    return await resolveConvexReadUrl(ctx, storage.storageId);
  }

  return await createS3ReadUrl({
    storage,
  });
}

async function signAsset(
  ctx: ActionCtx,
  asset: PublicAssetRecord,
): Promise<SignedPublicAssetRecord> {
  const [original, preview] = await Promise.all([
    signStorage(ctx, asset.storage),
    asset.previewStorage ? signStorage(ctx, asset.previewStorage) : Promise.resolve(null),
  ]);

  return {
    _id: asset._id,
    kind: asset.kind,
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    width: asset.width,
    height: asset.height,
    durationSeconds: asset.durationSeconds,
    capturedAt: asset.capturedAt,
    url: original.url,
    previewUrl: preview?.url ?? original.url,
    expiresAt: original.expiresAt,
  };
}

export const createForCircle = mutation({
  args: {
    circleId: v.id('circles'),
  },
  handler: async (ctx, args) => {
    const viewer = await requirePublicLinkManager(ctx, args.circleId);
    const circle = await ctx.db.get(args.circleId);

    if (!circle) {
      throw new Error('Circle not found.');
    }

    await revokeActiveLinksForCircle(ctx, args.circleId, viewer._id);

    const token = createPublicToken();
    const now = Date.now();
    const expiresAt = now + PUBLIC_LINK_DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000;
    const publicLinkId = await ctx.db.insert('publicCircleLinks', {
      circleId: args.circleId,
      tokenHash: await hashPublicToken(token),
      status: 'active',
      createdBy: viewer._id,
      createdAt: now,
      updatedAt: now,
      expiresAt,
    });

    return {
      publicLinkId,
      token,
      shareUrl: buildPublicShareUrl(token),
      expiresAt,
    };
  },
});

export const listForCircle = query({
  args: {
    circleId: v.id('circles'),
  },
  handler: async (ctx, args) => {
    await requirePublicLinkManager(ctx, args.circleId);
    const links = await ctx.db
      .query('publicCircleLinks')
      .withIndex('by_circle', (q) => q.eq('circleId', args.circleId))
      .order('desc')
      .take(PUBLIC_LINK_LIST_LIMIT);
    const now = Date.now();

    return await Promise.all(
      links.map(async (link) => {
        const creator = await ctx.db.get(link.createdBy);
        const status = publicLinkStatus(link, now);

        return {
          _id: link._id,
          circleId: link.circleId,
          status,
          createdAt: link.createdAt,
          expiresAt: link.expiresAt,
          revokedAt: link.revokedAt ?? null,
          createdByName: creator?.displayName?.trim() || creator?.email?.trim() || 'Unbekannt',
          canRevoke: status === 'active',
        };
      }),
    );
  },
});

export const revoke = mutation({
  args: {
    publicLinkId: v.id('publicCircleLinks'),
  },
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.publicLinkId);

    if (!link) {
      throw new Error('Public link not found.');
    }

    const viewer = await requirePublicLinkManager(ctx, link.circleId);
    const now = Date.now();

    await ctx.db.patch(link._id, {
      status: 'revoked',
      updatedAt: now,
      revokedAt: now,
      revokedBy: viewer._id,
    });

    return {
      publicLinkId: link._id,
      status: 'revoked' as const,
    };
  },
});

export const getPublicCirclePage = internalQuery({
  args: {
    token: v.string(),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args): Promise<PublicCirclePage | null> => {
    const link = await findActiveLinkByToken(ctx, args.token);

    if (!link) {
      return null;
    }

    const circle = await ctx.db.get(link.circleId);

    if (!circle) {
      return null;
    }

    const sharePage = await ctx.db
      .query('shareBatches')
      .withIndex('by_circle_and_status', (q) =>
        q.eq('circleId', link.circleId).eq('status', 'published'),
      )
      .order('desc')
      .paginate({
        numItems: PUBLIC_SHARE_PAGE_SIZE,
        cursor: args.cursor ?? null,
      });
    const shares = (
      await Promise.all(sharePage.page.map((share) => mapShareForPublicPage(ctx, share)))
    ).filter((share): share is PublicShareRecord => share !== null);

    return {
      circle: {
        _id: circle._id,
        name: circle.name,
        description: circle.description ?? '',
      },
      link: {
        expiresAt: link.expiresAt,
      },
      shares,
      isDone: sharePage.isDone,
      continueCursor: sharePage.continueCursor,
    };
  },
});

export const resolvePublicCirclePayload = internalAction({
  args: {
    token: v.string(),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args): Promise<SignedPublicCirclePage | null> => {
    const page: PublicCirclePage | null = await ctx.runQuery(
      internal.publicLinks.getPublicCirclePage,
      {
        token: args.token,
        cursor: args.cursor ?? null,
      },
    );

    if (!page) {
      return null;
    }

    return {
      circle: page.circle,
      link: page.link,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
      shares: await Promise.all(
        page.shares.map(async (share) => ({
          _id: share._id,
          caption: share.caption,
          assetCount: share.assetCount,
          authorName: share.authorName,
          publishedAt: share.publishedAt,
          createdAtLabel: share.createdAtLabel,
          assets: await Promise.all(share.assets.map((asset) => signAsset(ctx, asset))),
        })),
      ),
    };
  },
});
