'use client';

import * as React from 'react';
import type { FlatMediaItem } from '../../core/media';
import { cn } from '../cn';
import { createSlots, type StyleableProps } from '../slots';

export type MediaGallerySlot =
  | 'root' | 'notice' | 'refresh' | 'grid' | 'item' | 'frame' | 'image'
  | 'placeholder' | 'caption' | 'badge' | 'empty';

export interface MediaGalleryProps extends StyleableProps<MediaGallerySlot> {
  items: FlatMediaItem[];
  /** Show the "URLs are expiring" notice. Wire to `useShipmentMedia().stale`. */
  stale?: boolean;
  onRefresh?: () => void;
  onSelect?: (item: FlatMediaItem) => void;
  emptyState?: React.ReactNode;
}

const SIDE_LABELS: Record<string, string> = {
  front: 'Front', back: 'Back', left: 'Left', right: 'Right', top: 'Top', all: 'Overview',
  front_low: 'Front (low)', front_high: 'Front (high)',
  left_low: 'Left (low)', left_high: 'Left (high)',
  right_low: 'Right (low)', right_high: 'Right (high)',
};

/**
 * Inspection images.
 *
 * The URLs are presigned and short-lived, so the gallery surfaces expiry rather
 * than letting images silently 403. If these images are evidence — a claim, an
 * audit trail — copy them to your own storage when you receive them; refreshing
 * only works while the media is still retained upstream.
 */
export function MediaGallery({
  items,
  stale = false,
  onRefresh,
  onSelect,
  emptyState,
  className,
  classNames,
  unstyled,
}: MediaGalleryProps) {
  const slot = createSlots<MediaGallerySlot>({ classNames, unstyled });
  const [failed, setFailed] = React.useState<ReadonlySet<number>>(() => new Set());

  if (items.length === 0) {
    return (
      <div className={cn(slot('root', 'arvist-root'), className)}>
        <p className={slot('empty', 'arvist-media__empty')}>
          {emptyState ?? 'No images captured yet.'}
        </p>
      </div>
    );
  }

  return (
    <div className={cn(slot('root', 'arvist-root'), className)}>
      {stale ? (
        <div className={slot('notice', 'arvist-media__notice')}>
          <span>These image links are about to expire.</span>
          {onRefresh ? (
            <button type="button" onClick={onRefresh} className={slot('refresh', 'arvist-media__refresh')}>
              Refresh
            </button>
          ) : null}
        </div>
      ) : null}

      <ul className={slot('grid', 'arvist-media__grid')}>
        {items.map((item) => {
          const label = SIDE_LABELS[item.side] ?? item.side;
          const broken = failed.has(item.id) || !item.url;

          const inner = (
            <>
              <div className={slot('frame', 'arvist-media__frame')}>
                {broken ? (
                  <span className={slot('placeholder', 'arvist-media__placeholder')}>
                    Link expired
                  </span>
                ) : (
                  <img
                    src={item.url}
                    alt={`${label} view`}
                    loading="lazy"
                    onError={() => setFailed((prev) => new Set(prev).add(item.id))}
                    className={slot('image', 'arvist-media__image')}
                  />
                )}
                {item.damageCount > 0 ? (
                  <span
                    className={slot('badge', 'arvist-media__badge')}
                    aria-label={`${item.damageCount} damage finding(s)`}
                  >
                    {item.damageCount}
                  </span>
                ) : null}
              </div>
              <p className={slot('caption', 'arvist-media__caption')}>{label}</p>
            </>
          );

          return (
            <li key={item.id}>
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(item)}
                  className={slot('item', 'arvist-media__item')}
                >
                  {inner}
                </button>
              ) : (
                <div className={slot('item', 'arvist-media__item')}>{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
