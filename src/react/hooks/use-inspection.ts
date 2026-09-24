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
      // Re-check after the await: `refresh` is triggered from several places
      // (the unit-completed/completed event handler, `submit`, `finish`) and
      // is a real network round trip. If the tracked shipment changed while
      // this was in flight — stop this one, immediately start a different
      // one, a completely normal fast-testing sequence — applying this
      // response unconditionally would silently overwrite the new shipment's
      // state with the old one's, issues and all. Without this guard, a slow
      // stale response for shipment A can land after shipment B is already
      // bound and make B's screen show A's exceptions.
      if (shipmentIdRef.current !== id) return;
      setShipment(fresh);
      setPhase(phaseFromStatus(fresh.status));
    } catch (err) {
      if (shipmentIdRef.current === id) setError(toArvistError(err));
    }
  }, [client]);

  const adoptingStationShipmentRef = React.useRef(false);

  /**
   * `status` (`shipment-status/update`) is the one topic with no scoping at
   * all — surviving the filters above only proves *some* shipment changed
   * somewhere, never that it's this station's. `started`, the topic that
   * would normally identify it, is only ever emitted for an M2M-initiated
   * start (the API deliberately skips it for a dashboard/user-authenticated
   * one — see `startShipmentProcessing`'s own comment on that emit); without
   * this, a start triggered any other way would never populate `shipment` at
   * all, no matter how correctly everything else here is wired.
   *
   * Confirms it the safe way instead of trusting the event: ask the API which
   * shipment, if any, is actually in progress at *this* station right now,
   * and only ever adopt what that authoritative, station-scoped lookup
   * returns — never the raw event payload, which carries no station
   * information to verify against in the first place.
   */
  const adoptStationShipment = React.useCallback(async () => {
    if (!areaName || explicitShipmentId != null || adoptingStationShipmentRef.current) return;
    adoptingStationShipmentRef.current = true;
    try {
      const open = await client.listShipments({ areaName, status: 'in_progress', limit: 1 });
      const match = open.data[0];
      // Re-check after the await: a `started` event (or a previous call to
      // this) may have already bound a shipment while this was in flight.
      if (!match || shipmentIdRef.current != null) return;
      const fresh = await client.getShipment(match.id);
      // And again after this second await, for the same reason — a shipment
      // may have been bound (by `started`, or another concurrent call to this
      // function) while this fetch was in flight. Skipping this check would
      // let a stale lookup for one station's earlier shipment overwrite
      // whatever's actually bound now.
      if (shipmentIdRef.current != null) return;
      setShipment(fresh);
      setPhase(phaseFromStatus(fresh.status));
    } catch {
      // Best-effort — the next `status` event tries again.
    } finally {
      adoptingStationShipmentRef.current = false;
    }
  }, [client, areaName, explicitShipmentId]);

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

      // `status`/`completed`/`canceled` are the three shapes `normalize()` produces
      // from the *global* `shipment-status/update` topic (`realtime.ts`'s `topics.update`)
      // — every shipment's lifecycle in the whole deployment, with no per-station or
      // per-shipment scoping at all, unlike every other topic here (keyed by area id,
      // or only subscribed once a shipment id is already known). The check above only
      // filters once `current` is set, so before a shipment is ever bound — no
      // `started` event has matched this station yet — these three would otherwise
      // apply *any* shipment's activity anywhere in the org: phase/progress would
      // look like a live inspection while `shipment` itself stays unset, since only
      // `started` populates it. Dropped here for the same reason; `completed`/
      // `canceled` also arrive via their own per-shipment topics, which are never
      // subscribed until `current` is already set, so this only ever blocks the
      // unscoped path. `status` gets one more chance first, below, since it's the
      // only one of the three that a legitimate, still-unbound inspection actually
      // relies on (see `adoptStationShipment`).
      if (current == null && (event.kind === 'status' || event.kind === 'completed' || event.kind === 'canceled')) {
        if (event.kind === 'status') void adoptStationShipment();
        return;
      }

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
  }, [feed, refresh, adoptStationShipment, ...refetchOn]);

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
    const result = await act(() => client.finishInspection(requireShipment()));
    if (result.blocked_by === 'shortage') {
      // The API's shortage check (`detectShortages`) runs exactly here, at the
      // finish attempt — this is the moment those issue rows actually get
      // created, not something a client-side quantity check could have known
      // in advance. Refresh so they land in `shipment.line_items[].issue` and
      // show up as real, resolvable exceptions instead of just this message.
      await refresh();
      const blocked = new ArvistError({
        code: 'completion_blocked',
        message: result.message,
        detail: result.shortage_issues,
      });
      setError(blocked);
      throw blocked;
    }
    adopt(result);
  }, [act, adopt, client, refresh, requireShipment]);

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
