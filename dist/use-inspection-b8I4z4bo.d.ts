import { A as ArvistError, Q as QualityStation, I as InspectionEvent, S as Shipment, R as Reconciliation, C as ConnectionState, a as CompletionCheck, L as LineItemCorrection, b as LineItem, c as StartInspectionInput } from './media-DnQFgvEV.js';
import * as React from 'react';

interface AsyncState<T> {
    data: T | undefined;
    error: ArvistError | undefined;
    loading: boolean;
}
interface AsyncResult<T> extends AsyncState<T> {
    refresh: () => Promise<void>;
    setData: React.Dispatch<React.SetStateAction<T | undefined>>;
}
/**
 * Minimal fetch-on-mount helper.
 *
 * Deliberately not a cache: the SDK does not want an opinion about your data
 * layer. If you already run TanStack Query or SWR, call the client directly and
 * keep your own caching — every hook here exposes the underlying client.
 */
declare function useAsync<T>(fn: (signal: AbortSignal) => Promise<T>, deps: React.DependencyList, options?: {
    enabled?: boolean;
}): AsyncResult<T>;

/** Quality stations configured for the site. */
declare function useStations(params?: {
    siteId?: number;
}): {
    stations: QualityStation[];
    refresh: () => Promise<void>;
    setData: React.Dispatch<React.SetStateAction<QualityStation[] | undefined>>;
    data: QualityStation[] | undefined;
    error: ArvistError | undefined;
    loading: boolean;
};
interface StationBindingState {
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
declare function useStationBinding(areaName: string | undefined, options?: {
    pollMs?: number;
}): StationBindingState;

type InspectionPhase = 'idle' | 'starting' | 'in_progress' | 'paused' | 'review' | 'completed' | 'canceled' | 'error';
interface UseInspectionOptions {
    /**
     * Station name, e.g. `Z01-PS-001`. Required to receive `started` events, and
     * to adopt a shipment via the `status`-triggered station lookup (see
     * {@link UseInspectionResult.shipment}) for a dashboard/M2M-authenticated
     * start, which never emits `started` at all.
     */
    areaName?: string;
    /**
     * Station id. Required to receive per-unit events. Resolved from `areaName`
     * automatically when omitted.
     */
    areaId?: number;
    /** Adopt an inspection already in progress instead of waiting for a start. */
    shipmentId?: number;
    /** Called for every normalised event, before the hook applies it. */
    onEvent?: (event: InspectionEvent) => void;
    /**
     * Called once final counts are in. This is the reconciliation point — earlier
     * counts are provisional and can still change.
     */
    onCompleted?: (shipment: Shipment, reconciliation: Reconciliation) => void;
    /**
     * Re-fetch the shipment after these events so derived state matches the
     * server. Defaults to `['unit-completed', 'completed']`, which is the
     * cheapest set that keeps counts honest.
     */
    refetchOn?: InspectionEvent['kind'][];
}
interface UseInspectionResult {
    shipment: Shipment | undefined;
    phase: InspectionPhase;
    /** 0–1, or null when the total is not yet known. */
    progress: number | null;
    connection: ConnectionState;
    realtimeAvailable: boolean;
    loading: boolean;
    error: ArvistError | undefined;
    /** Live reconciliation. Only trustworthy once `phase` is `completed`. */
    reconciliation: Reconciliation;
    completion: CompletionCheck;
    /** Most recent event, useful for logging or a debug panel. */
    lastEvent: InspectionEvent | undefined;
    /**
     * Count corrections staged but not yet written.
     *
     * There is no endpoint for editing a line item's count on its own — the API
     * applies corrections as part of submission. They are held here until
     * {@link UseInspectionResult.submit} flushes them.
     */
    corrections: LineItemCorrection[];
    /**
     * Stages a corrected count for a real order line. This is a general,
     * submit-time edit — independent of exception resolution. A `shortage`
     * exception's own `correct_count` resolution writes immediately through
     * `useExceptions().resolve` instead (`PATCH .../shipment-issue/:id/resolve`,
     * action `wrong_counting`); reach for this only when the host wants a
     * standalone "edit this line's count" control outside that flow.
     */
    stageCorrection: (lineItem: LineItem, quantity: number) => void;
    clearCorrections: () => void;
    start: (input: StartInspectionInput) => Promise<Shipment>;
    /**
     * Marks an inspection finished — no further units are expected.
     *
     * Throws an `ArvistError` with code `completion_blocked` if the API finds
     * open shortages at this exact moment (`detectShortages`, its own real
     * check — not something predictable client-side beforehand). `shipment` is
     * refreshed before the throw, so those now-real issue rows already show up
     * as resolvable exceptions by the time the caller catches it.
     */
    finish: () => Promise<void>;
    submit: () => Promise<void>;
    cancel: () => Promise<void>;
    pause: () => Promise<void>;
    resume: () => Promise<void>;
    refresh: () => Promise<void>;
    /** Drops the local inspection without touching the server. */
    clear: () => void;
}
/**
 * Live inspection state for one station.
 *
 * Subscribes to the station's realtime topics, keeps a local shipment in sync
 * as units complete, and exposes the actions a packstation screen needs. The
 * derived reconciliation and completion gating come from the same functions the
 * headless core exports, so a server-side consumer of the same events reaches
 * identical conclusions.
 */
declare function useInspection(options?: UseInspectionOptions): UseInspectionResult;

export { type AsyncResult as A, type InspectionPhase as I, type StationBindingState as S, type UseInspectionOptions as U, type AsyncState as a, type UseInspectionResult as b, useInspection as c, useStationBinding as d, useStations as e, useAsync as u };
