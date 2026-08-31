'use client';

import * as React from 'react';
import { ArvistError } from '../../core/errors';
import { mergeRealtimeIssues } from '../../core/exceptions';
import type { ConnectionState, InspectionEvent } from '../../core/realtime';
import { checkCompletion, reconcile, type CompletionCheck, type Reconciliation } from '../../core/reconcile';
import type {
  ActionResult,
  LineItem,
  LineItemCorrection,
  Shipment,
  StartInspectionInput,
} from '../../core/types';
import { useArvist } from '../provider';

export type InspectionPhase =
  | 'idle'
  | 'starting'
  | 'in_progress'
  | 'paused'
  | 'review'
  | 'completed'
  | 'canceled'
  | 'error';

export interface UseInspectionOptions {
  /** Station name, e.g. `Z01-PS-001`. Required to receive `started` events. */
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

export interface UseInspectionResult {
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
  /** Stages a corrected count. Wire this to `useExceptions`' `onCorrectCount`. */
  stageCorrection: (lineItem: LineItem, quantity: number) => void;
  clearCorrections: () => void;

  start: (input: StartInspectionInput) => Promise<Shipment>;
  finish: () => Promise<void>;
  submit: () => Promise<void>;
  cancel: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Drops the local inspection without touching the server. */
  clear: () => void;
}

const DEFAULT_REFETCH_ON: InspectionEvent['kind'][] = ['unit-completed', 'completed'];

/**
 * Live inspection state for one station.
 *
 * Subscribes to the station's realtime topics, keeps a local shipment in sync
 * as units complete, and exposes the actions a packstation screen needs. The
 * derived reconciliation and completion gating come from the same functions the
 * headless core exports, so a server-side consumer of the same events reaches
 * identical conclusions.
 */
export function useInspection(options: UseInspectionOptions = {}): UseInspectionResult {
  const { client, feed, realtimeAvailable, autoCompleted } = useArvist();
  const { areaName, onEvent, onCompleted } = options;
  const refetchOn = options.refetchOn ?? DEFAULT_REFETCH_ON;

  const [shipment, setShipment] = React.useState<Shipment | undefined>();
  const [phase, setPhase] = React.useState<InspectionPhase>('idle');
  const [progress, setProgress] = React.useState<number | null>(null);
  const [connection, setConnection] = React.useState<ConnectionState>(feed?.state ?? 'idle');
  const [error, setError] = React.useState<ArvistError | undefined>();
  const [loading, setLoading] = React.useState(false);
  const [lastEvent, setLastEvent] = React.useState<InspectionEvent | undefined>();
  const [resolvedAreaId, setResolvedAreaId] = React.useState<number | undefined>(options.areaId);
  const [corrections, setCorrections] = React.useState<LineItemCorrection[]>([]);

  const shipmentIdRef = React.useRef<number | undefined>(options.shipmentId);
  shipmentIdRef.current = shipment?.id ?? options.shipmentId;

  const onEventRef = React.useRef(onEvent);
  onEventRef.current = onEvent;
  const onCompletedRef = React.useRef(onCompleted);
  onCompletedRef.current = onCompleted;

  // --- station id resolution ------------------------------------------------
  React.useEffect(() => {
    if (options.areaId != null) {
      setResolvedAreaId(options.areaId);
      return;
    }
    if (!areaName) return;
    let cancelled = false;
    client
      .findStationByName(areaName)
      .then((station) => {
        if (!cancelled) setResolvedAreaId(station.area_id);
      })
      .catch((err) => {
        if (!cancelled && ArvistError.is(err)) setError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [client, areaName, options.areaId]);

  // --- adopt an in-flight inspection ---------------------------------------
  const explicitShipmentId = options.shipmentId;
  React.useEffect(() => {
    if (explicitShipmentId == null) return;
    let cancelled = false;
    setLoading(true);
    client
      .getShipment(explicitShipmentId)
      .then((s) => {
        if (cancelled) return;
        setShipment(s);
        setPhase(phaseFromStatus(s.status));
      })
      .catch((err) => !cancelled && setError(toArvistError(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [client, explicitShipmentId]);

  // --- realtime binding -----------------------------------------------------
  React.useEffect(() => {
    if (!feed) return;
    feed.bind({ areaName, areaId: resolvedAreaId, shipmentId: shipmentIdRef.current });
  }, [feed, areaName, resolvedAreaId, shipment?.id]);

  React.useEffect(() => {
    if (!feed) return;
    setConnection(feed.state);
    return feed.onStateChange((state) => setConnection(state));
  }, [feed]);

  const refresh = React.useCallback(async () => {
    const id = shipmentIdRef.current;
    if (id == null) return;
    try {
      const fresh = await client.getShipment(id);
      setShipment(fresh);
      setPhase(phaseFromStatus(fresh.status));
    } catch (err) {
      setError(toArvistError(err));
    }
  }, [client]);

  React.useEffect(() => {
    if (!feed) return;

    return feed.subscribe((event) => {
      setLastEvent(event);
      onEventRef.current?.(event);

      // Ignore per-shipment events for a shipment we are not tracking. Station
      // topics are shared, so a stale event can arrive mid-handover.
      const current = shipmentIdRef.current;
      const eventShipmentId = getEventShipmentId(event);
      if (current != null && eventShipmentId != null && eventShipmentId !== current) return;

      switch (event.kind) {
        case 'started':
          setShipment(event.shipment);
          setPhase('in_progress');
          setProgress(null);
          setError(undefined);
          break;

        case 'unit-completed':
          // Fold issues in immediately so the UI reacts before the refetch,
          // then reconcile against the server.
          setShipment((prev) =>
            prev ? mergeRealtimeIssues(prev, event.payload) : prev,
          );
          break;

        case 'status':
          setProgress(event.progress);
          setPhase(phaseFromStatus(event.status));
          break;

        case 'state-change': {
          const state = String(event.payload['inspection_state'] ?? '');
          if (state.includes('pause')) setPhase('paused');
          else if (state.includes('resume')) setPhase('in_progress');
          break;
        }

        case 'completed':
          setPhase('completed');
          setProgress(1);
          break;

        case 'canceled':
          setPhase('canceled');
          break;

        case 'error':
          setPhase('error');
          setError(
            new ArvistError({
              code: 'server_error',
              message: event.message ?? 'The inspection reported an error.',
              detail: event.raw,
            }),
          );
          break;

        default:
          break;
      }

      if (refetchOn.includes(event.kind)) void refresh();
    });
    // `refetchOn` is spread so a fresh array literal does not resubscribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed, refresh, ...refetchOn]);

  // --- completion callback --------------------------------------------------
  const completedFiredFor = React.useRef<number | undefined>(undefined);
  React.useEffect(() => {
    if (phase !== 'completed' || !shipment) return;
    if (completedFiredFor.current === shipment.id) return;
    completedFiredFor.current = shipment.id;
    onCompletedRef.current?.(shipment, reconcile(shipment));
  }, [phase, shipment]);


  // --- actions --------------------------------------------------------------
  const act = React.useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      setLoading(true);
      setError(undefined);
      try {
        return await fn();
      } catch (err) {
        const normalized = toArvistError(err);
        setError(normalized);
        throw normalized;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const start = React.useCallback(
    async (input: StartInspectionInput) => {
      setPhase('starting');
      const payload: StartInspectionInput = {
        area_name: areaName,
        ...input,
      };
      // Keying on the order numbers makes a double tote scan idempotent.
      const idempotencyKey = payload.shipment_key ?? payload.order_numbers?.join(',');
      const started = await act(() =>
        client.startInspection(payload, idempotencyKey ? { idempotencyKey } : undefined),
      ).catch((err) => {
        setPhase('error');
        throw err;
      });
      setShipment(started);
      setPhase(phaseFromStatus(started.status));
      return started;
    },
    [act, client, areaName],
  );

  const requireShipment = React.useCallback(() => {
    const id = shipmentIdRef.current;
    if (id == null) {
      throw new ArvistError({ code: 'shipment_not_found', message: 'No inspection is open.' });
    }
    return id;
  }, []);

  /** Several write endpoints return the updated shipment; adopt it if present. */
  const adopt = React.useCallback((result: ActionResult) => {
    if (result.shipment) setShipment(result.shipment);
  }, []);

  const finish = React.useCallback(async () => {
    adopt(await act(() => client.finishInspection(requireShipment())));
  }, [act, adopt, client, requireShipment]);

  const stageCorrection = React.useCallback((lineItem: LineItem, quantity: number) => {
    if (lineItem.id == null) {
      throw new ArvistError({
        code: 'validation_failed',
        message: 'That line item has no id, so its count cannot be corrected.',
      });
    }
    const id = lineItem.id;
    setCorrections((prev) => [
      ...prev.filter((c) => c.id !== id),
      { id, actual_quantity: quantity, is_edited: true },
    ]);
  }, []);

  const clearCorrections = React.useCallback(() => setCorrections([]), []);

  const submit = React.useCallback(async () => {
    const staged = corrections;
    adopt(
      await act(() =>
        client.submitInspection(
          requireShipment(),
          staged.length ? { line_items: staged } : {},
        ),
      ),
    );
    setCorrections([]);
    await refresh();
  }, [act, adopt, client, corrections, requireShipment, refresh]);

  const cancel = React.useCallback(async () => {
    adopt(await act(() => client.cancelShipment(requireShipment())));
    setPhase('canceled');
  }, [act, adopt, client, requireShipment]);

  const pause = React.useCallback(async () => {
    adopt(await act(() => client.pauseShipment(requireShipment())));
    setPhase('paused');
  }, [act, adopt, client, requireShipment]);

  const resume = React.useCallback(async () => {
    adopt(await act(() => client.resumeShipment(requireShipment())));
    setPhase('in_progress');
  }, [act, adopt, client, requireShipment]);

  const clear = React.useCallback(() => {
    setShipment(undefined);
    setPhase('idle');
    setProgress(null);
    setError(undefined);
    setLastEvent(undefined);
    setCorrections([]);
    completedFiredFor.current = undefined;
  }, []);

  /**
   * The shipment with staged corrections laid over it.
   *
   * Corrections are held separately rather than written into the fetched
   * shipment, because every refetch would otherwise discard them — leaving the
   * operator with a correction that appears to have vanished and a blocker that
   * will not clear. Layering them keeps the screen honest across refreshes and
   * still sends only the server's own data back on submit.
   */
  const effectiveShipment = React.useMemo(() => {
    if (!shipment || corrections.length === 0) return shipment;
    const byId = new Map(corrections.map((c) => [c.id, c] as const));
    return {
      ...shipment,
      line_items: shipment.line_items.map((item) => {
        const correction = item.id != null ? byId.get(item.id) : undefined;
        return correction
          ? { ...item, actual_quantity: correction.actual_quantity, is_edited: true }
          : item;
      }),
    };
  }, [shipment, corrections]);

  const reconciliation = React.useMemo(() => reconcile(effectiveShipment), [effectiveShipment]);
  const completion = React.useMemo(
    () => checkCompletion(effectiveShipment, { autoCompleted }),
    [effectiveShipment, autoCompleted],
  );

  return {
    shipment: effectiveShipment,
    phase,
    progress,
    connection,
    realtimeAvailable,
    loading,
    error,
    reconciliation,
    completion,
    lastEvent,
    corrections,
    stageCorrection,
    clearCorrections,
    start,
    finish,
    submit,
    cancel,
    pause,
    resume,
    refresh,
    clear,
  };
}

function getEventShipmentId(event: InspectionEvent): number | undefined {
  if ('shipmentId' in event) return event.shipmentId;
  if ('shipment' in event) return event.shipment.id;
  if ('payload' in event) {
    const id = event.payload.shipment_id;
    return typeof id === 'number' ? id : undefined;
  }
  return undefined;
}

function phaseFromStatus(status: string): InspectionPhase {
  switch (status) {
    case 'in_progress':
    case 'processing':
      return 'in_progress';
    case 'review':
      return 'review';
    case 'completed':
      return 'completed';
    case 'canceled':
    case 'cancelled':
    case 'deleted':
      return 'canceled';
    case 'pending':
      return 'idle';
    default:
      return 'in_progress';
  }
}

function toArvistError(err: unknown): ArvistError {
  return ArvistError.is(err)
    ? err
    : new ArvistError({ code: 'unknown', message: 'Something went wrong.', cause: err });
}
