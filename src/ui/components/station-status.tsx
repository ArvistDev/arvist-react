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

type Tone = 'ok' | 'warning' | 'error' | 'pending';

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

  const state: { label: string; tone: Tone; hint?: string } = loading
    ? { label: 'Checking…', tone: 'pending' }
    : error
      ? { label: 'Unavailable', tone: 'error', hint: error.message }
      : !resolved
        ? {
            label: 'Not configured',
            tone: 'error',
            hint: `No quality station named "${areaName}" exists at this site. Inspections sent here will be created but never opened.`,
          }
        : hasOpenInspection
          ? {
              label: 'Inspection open',
              tone: 'warning',
              hint: 'An inspection is already running at this station.',
            }
          : { label: 'Ready', tone: 'ok' };

  return (
    <div
      data-resolved={resolved}
      data-tone={state.tone}
      className={cn(slot('root', 'arvist-root arvist-station'), className)}
    >
      <div className={slot('header', 'arvist-station__header')}>
        <span className={slot('name', 'arvist-station__name')}>
          {station?.area_name ?? station?.name ?? areaName}
        </span>
        <span
          className={slot('state', 'arvist-station__state', `arvist-station__state--${state.tone}`)}
        >
          {state.label}
        </span>
      </div>
      {state.hint ? <p className={slot('hint', 'arvist-station__hint')}>{state.hint}</p> : null}
      {action && !resolved ? (
        <div className={slot('action', 'arvist-station__action')}>{action}</div>
      ) : null}
    </div>
  );
}
