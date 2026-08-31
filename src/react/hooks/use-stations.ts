'use client';

import * as React from 'react';
import type { QualityStation } from '../../core/types';
import { useArvist } from '../provider';
import { useAsync } from './use-async';

/** Quality stations configured for the site. */
export function useStations(params: { siteId?: number } = {}) {
  const { client } = useArvist();
  const { siteId } = params;

  const result = useAsync<QualityStation[]>(
    (signal) => client.listStations(siteId != null ? { site_id: siteId } : {}, { signal }),
    [client, siteId],
  );

  return { ...result, stations: result.data ?? [] };
}

export interface StationBindingState {
  station: QualityStation | undefined;
  /** `true` once the named station has been found in the site's configuration. */
  resolved: boolean;
  /** An inspection is already open at this station. */
  hasOpenInspection: boolean;
  loading: boolean;
  error: ReturnType<typeof useAsync>['error'];
  refresh: () => Promise<void>;
}

/**
 * Resolves a station by name and reports whether it is ready to receive work.
 *
 * Starting an inspection succeeds whether or not a screen has the station
 * selected — the inspection is created either way, it just never opens for an
 * operator. Checking the binding first turns that silent case into something
 * you can show. Poll it on the packstation screen so a station that drops out
 * of configuration is noticed before the next tote arrives.
 */
export function useStationBinding(
  areaName: string | undefined,
  options: { pollMs?: number } = {},
): StationBindingState {
  const { client } = useArvist();
  const { pollMs } = options;

  const result = useAsync(
    (signal) => client.checkStationBinding(areaName!, { signal }),
    [client, areaName],
    { enabled: Boolean(areaName) },
  );

  const { refresh } = result;
  React.useEffect(() => {
    if (!pollMs || !areaName) return;
    const timer = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(timer);
  }, [pollMs, areaName, refresh]);

  return {
    station: result.data?.station,
    resolved: Boolean(result.data?.station),
    hasOpenInspection: result.data?.hasOpenInspection ?? false,
    loading: result.loading,
    error: result.error,
    refresh: result.refresh,
  };
}
