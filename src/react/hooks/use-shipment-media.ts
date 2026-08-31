'use client';

import * as React from 'react';
import { flattenMedia, getMediaExpiry, sortMediaBySide, type FlatMediaItem } from '../../core/media';
import type { Shipment, ShipmentImage } from '../../core/types';
import { useArvist } from '../provider';
import { useAsync } from './use-async';

export interface UseShipmentMediaResult {
  images: ShipmentImage[];
  /** Flattened and ordered the way an operator walks a unit. */
  items: FlatMediaItem[];
  loading: boolean;
  error: ReturnType<typeof useAsync>['error'];
  /** `true` once the presigned URLs are close enough to expiry to re-fetch. */
  stale: boolean;
  refresh: () => Promise<void>;
}

/**
 * Inspection media for a shipment, kept ahead of presigned-URL expiry.
 *
 * Pass the shipment rather than its id when you have it. Media arrives unit by
 * unit as an inspection runs, and the id alone never changes — so a hook keyed
 * only on the id fetches once and then shows the first unit's images for the
 * rest of the inspection. Given the shipment, this refetches whenever a new
 * unit or session appears.
 *
 * The URLs are short-lived, so this also tracks when they go stale and
 * re-fetches before they break. That keeps a long-lived screen working, but it
 * is not a retention strategy: anything you need to keep — for a claim, an
 * audit, a customer-facing record — must be copied to your own storage when you
 * receive it. Re-fetching only works while the media is still retained upstream.
 */
export function useShipmentMedia(
  source: number | Pick<Shipment, 'id' | 'units'> | undefined,
  options: { autoRefresh?: boolean } = {},
): UseShipmentMediaResult {
  const { client } = useArvist();
  const autoRefresh = options.autoRefresh ?? true;
  const [stale, setStale] = React.useState(false);
  const receivedAt = React.useRef<Date | undefined>(undefined);

  const shipmentId = typeof source === 'number' ? source : source?.id;

  // Changes as units and sessions are added, which is the signal to refetch.
  const revision =
    typeof source === 'number' || !source
      ? ''
      : (source.units ?? [])
          .map((u) => `${u.id}:${u.quality_sessions?.[0]?.id ?? ''}`)
          .join('|');

  const result = useAsync<ShipmentImage[]>(
    async (signal) => {
      const images = await client.getShipmentMedia(shipmentId!, { signal });
      receivedAt.current = new Date();
      setStale(false);
      return images;
    },
    [client, shipmentId, revision],
    { enabled: shipmentId != null },
  );

  const images = React.useMemo(() => result.data ?? [], [result.data]);
  const items = React.useMemo(() => sortMediaBySide(flattenMedia(images)), [images]);

  const { refresh } = result;
  React.useEffect(() => {
    if (!images.length) return;

    const check = () => {
      const soonest = images
        .map((img) => getMediaExpiry(img.media, receivedAt.current))
        .filter((e) => e.msRemaining != null)
        .sort((a, b) => (a.msRemaining ?? 0) - (b.msRemaining ?? 0))[0];

      if (!soonest) return;
      if (soonest.stale) {
        setStale(true);
        if (autoRefresh) void refresh();
      }
    };

    check();
    const timer = setInterval(check, 30_000);
    return () => clearInterval(timer);
  }, [images, autoRefresh, refresh]);

  return {
    images,
    items,
    loading: result.loading,
    error: result.error,
    stale,
    refresh: result.refresh,
  };
}
