/**
 * Presigned media helpers.
 *
 * Inspection media is served as short-lived presigned URLs — assume roughly 30
 * minutes unless the API tells you otherwise. A URL that worked when a page
 * loaded will not work an hour later, so anything you need to keep must be
 * copied to your own storage on receipt.
 */

import type { MediaRef, ShipmentImage } from './types';

/** Conservative default lifetime, used when the URL carries no expiry of its own. */
export const DEFAULT_PRESIGNED_TTL_MS = 30 * 60 * 1000;

/** Refresh this far ahead of expiry so an in-flight request does not race it. */
export const PRESIGN_REFRESH_MARGIN_MS = 2 * 60 * 1000;

/**
 * Reads the expiry out of a presigned URL.
 *
 * Handles the two common signing conventions — `X-Amz-Date` +
 * `X-Amz-Expires`, and a bare `Expires` epoch. Returns `undefined` when the URL
 * is not signed or uses a scheme we do not recognise, in which case callers
 * should fall back to {@link DEFAULT_PRESIGNED_TTL_MS} from receipt.
 */
export function parsePresignedExpiry(url: string): Date | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const params = parsed.searchParams;

  const amzDate = params.get('X-Amz-Date');
  const amzExpires = params.get('X-Amz-Expires');
  if (amzDate && amzExpires) {
    // Basic-format ISO 8601: 20260818T142530Z
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(amzDate);
    if (m) {
      const [, y, mo, d, h, mi, s] = m;
      const start = Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +s!);
      const ttl = Number(amzExpires);
      if (Number.isFinite(ttl)) return new Date(start + ttl * 1000);
    }
  }

  const expires = params.get('Expires');
  if (expires && /^\d+$/.test(expires)) return new Date(Number(expires) * 1000);

  return undefined;
}

export interface MediaExpiry {
  expiresAt?: Date;
  /** `true` once the URL is past its expiry (or its assumed one). */
  expired: boolean;
  /** `true` once it is close enough to expiry to be worth re-fetching. */
  stale: boolean;
  msRemaining?: number;
}

/**
 * Expiry state for a presigned URL.
 *
 * `receivedAt` matters when the URL carries no parseable expiry: the assumed
 * TTL runs from when you received it, not from now.
 */
export function getMediaExpiry(
  media: Pick<MediaRef, 'url' | 'expires_at'> | undefined,
  receivedAt?: Date,
  now: Date = new Date(),
): MediaExpiry {
  if (!media?.url) return { expired: true, stale: true };

  const explicit = media.expires_at ? new Date(media.expires_at) : undefined;
  const parsed = explicit ?? parsePresignedExpiry(media.url);
  const assumed = receivedAt
    ? new Date(receivedAt.getTime() + DEFAULT_PRESIGNED_TTL_MS)
    : undefined;
  const expiresAt = parsed ?? assumed;

  if (!expiresAt || Number.isNaN(expiresAt.getTime())) {
    return { expired: false, stale: false };
  }

  const msRemaining = expiresAt.getTime() - now.getTime();
  return {
    expiresAt,
    msRemaining,
    expired: msRemaining <= 0,
    stale: msRemaining <= PRESIGN_REFRESH_MARGIN_MS,
  };
}

export function isMediaUrlExpired(
  media: Pick<MediaRef, 'url' | 'expires_at'> | undefined,
  receivedAt?: Date,
): boolean {
  return getMediaExpiry(media, receivedAt).expired;
}

export interface FlatMediaItem {
  id: number;
  side: string;
  url?: string;
  filename?: string;
  contentId?: string;
  mimeType?: string;
  unitSessionId: number;
  damageCount: number;
}

/** Flattens the nested image structure into a list a gallery can render. */
export function flattenMedia(images: ShipmentImage[] | undefined): FlatMediaItem[] {
  return (images ?? []).map((image) => ({
    id: image.id,
    side: String(image.side),
    url: image.media?.url,
    filename: image.media?.filename ?? image.filepath,
    contentId: image.media?.content_id,
    mimeType: image.media?.mime_type,
    unitSessionId: image.shipment_unit_session_id,
    damageCount: image.damages?.length ?? 0,
  }));
}

const SIDE_ORDER = [
  'front', 'front_low', 'front_high', 'right', 'right_low', 'right_high',
  'back', 'left', 'left_low', 'left_high', 'top', 'all',
];

/** Sorts media into the order operators expect to walk a unit. */
export function sortMediaBySide<T extends { side: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const ai = SIDE_ORDER.indexOf(a.side);
    const bi = SIDE_ORDER.indexOf(b.side);
    return (ai === -1 ? SIDE_ORDER.length : ai) - (bi === -1 ? SIDE_ORDER.length : bi);
  });
}
