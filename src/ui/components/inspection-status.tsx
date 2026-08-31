'use client';

import * as React from 'react';
import type { ConnectionState } from '../../core/realtime';
import type { InspectionPhase } from '../../react/hooks/use-inspection';
import { cn } from '../cn';
import { createSlots, type StyleableProps } from '../slots';

export type InspectionStatusSlot =
  | 'root' | 'phase' | 'phaseGroup' | 'dot' | 'label' | 'connection' | 'detail'
  | 'progress' | 'bar' | 'fill' | 'pct';

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

const CONNECTION_LABELS: Record<ConnectionState, string> = {
  idle: 'Not connected',
  connecting: 'Connecting…',
  connected: 'Live',
  reconnecting: 'Reconnecting…',
  closed: 'Disconnected',
};

/**
 * Phase, progress and connection in one strip.
 *
 * The connection indicator is not decorative. When the feed drops the screen
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
    <div data-phase={phase} className={cn(slot('root', 'arvist-root arvist-status'), className)}>
      <div className={slot('phase', 'arvist-status__phase')}>
        <div className={slot('phaseGroup', 'arvist-status__phase-group')}>
          <span
            aria-hidden="true"
            className={slot('dot', 'arvist-dot arvist-status__dot', `arvist-status__dot--${phase}`)}
          />
          <span className={slot('label', 'arvist-status__label')}>{PHASE_LABELS[phase]}</span>
        </div>
        {!hideConnection && connection ? (
          <span
            data-connection={connection}
            className={slot(
              'connection',
              'arvist-status__connection',
              `arvist-status__connection--${connection}`,
            )}
          >
            {CONNECTION_LABELS[connection]}
          </span>
        ) : null}
      </div>

      {detail ? <p className={slot('detail', 'arvist-status__detail')}>{detail}</p> : null}

      {pct != null ? (
        <div className={slot('progress', 'arvist-status__progress')}>
          <div
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Inspection progress"
            className={slot('bar', 'arvist-status__bar')}
          >
            <div className={slot('fill', 'arvist-status__fill')} style={{ width: `${pct}%` }} />
          </div>
          <p className={slot('pct', 'arvist-status__pct')}>{pct}%</p>
        </div>
      ) : null}
    </div>
  );
}
