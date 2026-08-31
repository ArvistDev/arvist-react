'use client';

import * as React from 'react';
import type { ConnectionState } from '../../core/realtime';
import type { InspectionPhase } from '../../react/hooks/use-inspection';
import { cn } from '../cn';
import { createSlots, type StyleableProps } from '../slots';

export type InspectionStatusSlot =
  | 'root' | 'phase' | 'dot' | 'label' | 'progress' | 'bar' | 'fill' | 'connection' | 'detail';

export interface InspectionStatusProps extends StyleableProps<InspectionStatusSlot> {
  phase: InspectionPhase;
  /** 0–1, or null when the total is not yet known. */
  progress?: number | null;
  connection?: ConnectionState;
  /** Free-text line under the status — order number, tote id, station name. */
  detail?: React.ReactNode;
  /** Hide the connection indicator when the host app shows one already. */
  hideConnection?: boolean;
}

const PHASE_LABELS: Record<InspectionPhase, string> = {
  idle: 'Waiting for a tote',
  starting: 'Starting…',
  in_progress: 'Inspecting',
  paused: 'Paused',
  review: 'In review',
  completed: 'Complete',
  canceled: 'Canceled',
  error: 'Error',
};

const PHASE_DOT: Record<InspectionPhase, string> = {
  idle: 'bg-arvist-text-muted',
  starting: 'bg-arvist-info animate-pulse',
  in_progress: 'bg-arvist-info animate-pulse',
  paused: 'bg-arvist-warning',
  review: 'bg-arvist-warning',
  completed: 'bg-arvist-ok',
  canceled: 'bg-arvist-text-muted',
  error: 'bg-arvist-blocking',
};

const CONNECTION_LABELS: Record<ConnectionState, string> = {
  idle: 'Not connected',
  connecting: 'Connecting…',
  connected: 'Live',
  reconnecting: 'Reconnecting…',
  closed: 'Disconnected',
};

const CONNECTION_STYLES: Record<ConnectionState, string> = {
  idle: 'text-arvist-text-muted',
  connecting: 'text-arvist-info',
  connected: 'text-arvist-ok',
  reconnecting: 'text-arvist-warning',
  closed: 'text-arvist-blocking',
};

/**
 * Phase, progress and connection in one strip.
 *
 * The connection indicator is not decorative: when the feed drops, the screen
 * keeps showing the last known state, and without this an operator cannot tell
 * a quiet station from a dead socket.
 */
export function InspectionStatus({
  phase,
  progress = null,
  connection,
  detail,
  hideConnection = false,
  className,
  classNames,
  unstyled,
}: InspectionStatusProps) {
  const slot = createSlots<InspectionStatusSlot>({ classNames, unstyled });
  const pct = progress == null ? null : Math.round(Math.min(Math.max(progress, 0), 1) * 100);

  return (
    <div
      data-phase={phase}
      className={cn(
        slot(
          'root',
          'arvist-root rounded-[--radius-arvist] border border-arvist-border',
          'bg-arvist-surface p-4 text-arvist-text',
        ),
        className,
      )}
    >
      <div className={slot('phase', 'flex items-center justify-between gap-3')}>
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden className={slot('dot', 'size-2.5 shrink-0 rounded-full', PHASE_DOT[phase])} />
          <span className={slot('label', 'truncate font-semibold')}>{PHASE_LABELS[phase]}</span>
        </div>
        {!hideConnection && connection ? (
          <span
            className={slot(
              'connection',
              'shrink-0 text-xs font-medium',
              CONNECTION_STYLES[connection],
            )}
          >
            {CONNECTION_LABELS[connection]}
          </span>
        ) : null}
      </div>

      {detail ? (
        <p className={slot('detail', 'mt-1 truncate text-sm text-arvist-text-muted')}>{detail}</p>
      ) : null}

      {pct != null ? (
        <div className={slot('progress', 'mt-3')}>
          <div
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            className={slot('bar', 'h-2 w-full overflow-hidden rounded-full bg-arvist-surface-muted')}
          >
            <div
              className={slot('fill', 'h-full rounded-full bg-arvist-info transition-[width] duration-300')}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-1 text-right text-xs tabular-nums text-arvist-text-muted">{pct}%</p>
        </div>
      ) : null}
    </div>
  );
}
