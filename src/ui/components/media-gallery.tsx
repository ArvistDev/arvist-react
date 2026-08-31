'use client';

import * as React from 'react';
import type { FlatMediaItem } from '../../core/media';
import { cn } from '../cn';
import { createSlots, type StyleableProps } from '../slots';

export type MediaGallerySlot =
  | 'root' | 'notice' | 'grid' | 'item' | 'image' | 'placeholder' | 'caption' | 'badge';

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
  const [failed, setFailed] = React.useState<Set<number>>(() => new Set());

  if (items.length === 0) {
    return (
      <div className={cn(slot('root', 'arvist-root'), className)}>
        <p className={slot('placeholder', 'py-6 text-center text-sm text-arvist-text-muted')}>
          {emptyState ?? 'No images captured yet.'}
        </p>
      </div>
    );
  }

  return (
    <div className={cn(slot('root', 'arvist-root text-arvist-text'), className)}>
      {stale ? (
        <div
          className={slot(
            'notice',
            'mb-3 flex items-center justify-between gap-3 rounded-[--radius-arvist]',
            'border border-arvist-warning/40 bg-arvist-warning-surface px-3 py-2 text-xs',
          )}
        >
          <span>These image links are about to expire.</span>
          {onRefresh ? (
            <button
              type="button"
              onClick={onRefresh}
              className="font-medium underline underline-offset-2"
            >
              Refresh
            </button>
          ) : null}
        </div>
      ) : null}

      <ul className={slot('grid', 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4')}>
        {items.map((item) => {
          const broken = failed.has(item.id) || !item.url;
          const Wrapper = onSelect ? 'button' : 'div';
          return (
            <li key={item.id}>
              <Wrapper
                {...(onSelect
                  ? { type: 'button' as const, onClick: () => onSelect(item) }
                  : {})}
                className={slot(
                  'item',
                  'group block w-full overflow-hidden rounded-[--radius-arvist]',
                  'border border-arvist-border bg-arvist-surface-muted text-left',
                  onSelect ? 'hover:border-arvist-info focus:outline-none focus:ring-2 focus:ring-arvist-info/40' : '',
                )}
              >
                <div className="relative aspect-4/3">
                  {broken ? (
                    <span
                      className={slot(
                        'placeholder',
                        'absolute inset-0 grid place-items-center px-2 text-center text-xs text-arvist-text-muted',
                      )}
                    >
                      Link expired
                    </span>
                  ) : (
                    <img
                      src={item.url}
                      alt={`${SIDE_LABELS[item.side] ?? item.side} view`}
                      loading="lazy"
                      onError={() => setFailed((prev) => new Set(prev).add(item.id))}
                      className={slot('image', 'size-full object-cover')}
                    />
                  )}
                  {item.damageCount > 0 ? (
                    <span
                      className={slot(
                        'badge',
                        'absolute right-1 top-1 rounded-full bg-arvist-blocking',
                        'px-1.5 py-0.5 text-[10px] font-semibold text-white',
                      )}
                    >
                      {item.damageCount}
                    </span>
                  ) : null}
                </div>
                <p className={slot('caption', 'truncate px-2 py-1.5 text-xs text-arvist-text-muted')}>
                  {SIDE_LABELS[item.side] ?? item.side}
                </p>
              </Wrapper>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
