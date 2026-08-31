import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRESIGNED_TTL_MS,
  flattenMedia,
  getMediaExpiry,
  isMediaUrlExpired,
  parsePresignedExpiry,
  sortMediaBySide,
} from '../core/media';

const SIGNED =
  'https://media.example.com/img.jpg?X-Amz-Date=20260818T140000Z&X-Amz-Expires=1800&X-Amz-Signature=abc';

describe('parsePresignedExpiry', () => {
  it('reads the SigV4 date and TTL', () => {
    expect(parsePresignedExpiry(SIGNED)?.toISOString()).toBe('2026-08-18T14:30:00.000Z');
  });

  it('reads a bare Expires epoch', () => {
    const at = parsePresignedExpiry('https://e.com/i.jpg?Expires=1755526200');
    expect(at?.getTime()).toBe(1755526200 * 1000);
  });

  it('returns undefined for an unsigned or malformed URL', () => {
    expect(parsePresignedExpiry('https://e.com/i.jpg')).toBeUndefined();
    expect(parsePresignedExpiry('not a url')).toBeUndefined();
  });
});

describe('getMediaExpiry', () => {
  it('prefers an explicit expires_at over the URL', () => {
    const result = getMediaExpiry(
      { url: SIGNED, expires_at: '2026-08-18T15:00:00Z' },
      undefined,
      new Date('2026-08-18T14:00:00Z'),
    );
    expect(result.expiresAt?.toISOString()).toBe('2026-08-18T15:00:00.000Z');
    expect(result.expired).toBe(false);
  });

  it('flags a URL past its expiry', () => {
    const result = getMediaExpiry({ url: SIGNED }, undefined, new Date('2026-08-18T15:00:00Z'));
    expect(result.expired).toBe(true);
  });

  it('flags a URL as stale inside the refresh margin', () => {
    const result = getMediaExpiry({ url: SIGNED }, undefined, new Date('2026-08-18T14:29:00Z'));
    expect(result.expired).toBe(false);
    expect(result.stale).toBe(true);
  });

  it('assumes the default TTL from receipt when the URL carries no expiry', () => {
    const receivedAt = new Date('2026-08-18T14:00:00Z');
    const url = 'https://e.com/i.jpg';
    expect(
      getMediaExpiry({ url }, receivedAt, new Date(receivedAt.getTime() + DEFAULT_PRESIGNED_TTL_MS + 1))
        .expired,
    ).toBe(true);
    expect(getMediaExpiry({ url }, receivedAt, receivedAt).expired).toBe(false);
  });

  it('treats a missing URL as expired', () => {
    expect(isMediaUrlExpired(undefined)).toBe(true);
    expect(isMediaUrlExpired({ url: undefined })).toBe(true);
  });

  it('does not guess when there is neither an expiry nor a receipt time', () => {
    const result = getMediaExpiry({ url: 'https://e.com/i.jpg' });
    expect(result.expired).toBe(false);
    expect(result.expiresAt).toBeUndefined();
  });
});

describe('flattenMedia and sortMediaBySide', () => {
  it('flattens the nested image shape', () => {
    const [item] = flattenMedia([
      {
        id: 1,
        side: 'front',
        shipment_unit_session_id: 99,
        media: { url: SIGNED, filename: 'f.jpg', content_id: 'c1', mime_type: 'image/jpeg' },
        damages: [{ id: 1 } as never],
      },
    ]);
    expect(item).toMatchObject({
      id: 1, side: 'front', url: SIGNED, contentId: 'c1', unitSessionId: 99, damageCount: 1,
    });
  });

  it('orders sides the way an operator walks a unit, unknowns last', () => {
    const sorted = sortMediaBySide([
      { side: 'top' }, { side: 'mystery' }, { side: 'front' }, { side: 'back' },
    ]);
    expect(sorted.map((s) => s.side)).toEqual(['front', 'back', 'top', 'mystery']);
  });

  it('tolerates undefined input', () => {
    expect(flattenMedia(undefined)).toEqual([]);
  });
});
