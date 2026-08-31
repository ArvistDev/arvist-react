'use client';

import * as React from 'react';
import type { StationBindingState } from '../../react/hooks/use-stations';
import { cn } from '../cn';
import { createSlots, type StyleableProps } from '../slots';

export type StationStatusSlot = 'root' | 'header' | 'name' | 'state' | 'hint' | 'action';

export interface StationStatusProps extends StyleableProps<StationStatusSlot>, StationBindingState {
  areaName: string;
  /** Rendered when the station cannot be resolved — usually a settings link. */
  action?: React.ReactNode;
}

/**
 * Whether a station is configured and ready to receive work.
 *
 * Starting an inspection succeeds whether or not a screen has the station
 * selected, so an unbound station fails silently: the record is created, and
 * nobody sees it. Surfacing that here turns the most common
 * "station not responding" report into something an operator can act on before
 * the next tote arrives.
 */
export function StationStatus({
  areaName,
  station,
  resolved,
  hasOpenInspection,
  loading,
  error,
  action,
  className,
  classNames,
  unstyled,
}: StationStatusProps) {
  const slot = createSlots<StationStatusSlot>({ classNames, unstyled });

  const state: { label: string; tone: string; hint?: string } = loading
    ? { label: 'Checking…', tone: 'text-arvist-text-muted' }
    : error
      ? { label: 'Unavailable', tone: 'text-arvist-blocking', hint: error.message }
      : !resolved
        ? {
            label: 'Not configured',
            tone: 'text-arvist-blocking',
            hint: `No quality station named "${areaName}" exists at this site. Inspections sent here will be created but never opened.`,
          }
        : hasOpenInspection
          ? {
              label: 'Inspection open',
              tone: 'text-arvist-warning',
              hint: 'An inspection is already running at this station.',
            }
          : { label: 'Ready', tone: 'text-arvist-ok' };

  return (
    <div
      data-resolved={resolved}
      className={cn(
        slot(
          'root',
          'arvist-root rounded-[--radius-arvist] border border-arvist-border',
          'bg-arvist-surface px-4 py-3 text-arvist-text',
        ),
        className,
      )}
    >
      <div className={slot('header', 'flex items-center justify-between gap-3')}>
        <span className={slot('name', 'truncate font-mono text-sm font-semibold')}>
          {station?.area_name ?? station?.name ?? areaName}
        </span>
        <span className={slot('state', 'shrink-0 text-xs font-medium', state.tone)}>
          {state.label}
        </span>
      </div>
      {state.hint ? (
        <p className={slot('hint', 'mt-1 text-xs text-arvist-text-muted')}>{state.hint}</p>
      ) : null}
      {action && !resolved ? <div className={slot('action', 'mt-2')}>{action}</div> : null}
    </div>
  );
}
