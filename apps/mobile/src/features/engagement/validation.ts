import { msg } from 'gt-react-native';

import {
  normalizeCommentBody,
  normalizeReactionEmoji as normalizeSharedReactionEmoji,
} from '@beisammen/contracts';

export type CommentTarget =
  | {
      shareBatchId: string;
      targetKind: 'share';
      assetId?: undefined;
      label: string;
    }
  | {
      shareBatchId: string;
      targetKind: 'asset';
      assetId: string;
      label: string;
    };

export function normalizeReactionEmoji(value: string): string {
  return normalizeSharedReactionEmoji(value);
}

export function normalizeCommentDraft(value: string): string {
  return normalizeCommentBody(value);
}

export function buildCommentTarget(input: {
  shareBatchId: string;
  activeAssetId?: string | null;
}): CommentTarget {
  if (input.activeAssetId) {
    return {
      shareBatchId: input.shareBatchId,
      targetKind: 'asset',
      assetId: input.activeAssetId,
      label: msg('Aktuelles Medium'),
    };
  }

  return {
    shareBatchId: input.shareBatchId,
    targetKind: 'share',
    assetId: undefined,
    label: msg('Beitrag'),
  };
}
