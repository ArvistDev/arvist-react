import { ArvistClient, createSocketIoTransport, InspectionFeed, createErrorMessageResolver, ArvistError, reconcile, checkCompletion, createScanBuffer, parseScan, buildBarcodeIndex, sortMediaBySide, flattenMedia, getMediaExpiry } from './chunk-C3LOARKS.js';
export { ArvistClient, ArvistError, DEFAULT_ERROR_MESSAGES, DEFAULT_PRESIGNED_TTL_MS, InspectionFeed, PRESIGN_REFRESH_MARGIN_MS, buildBarcodeIndex, checkCompletion, createErrorMessageResolver, createScanBuffer, createSocketIoTransport, errorFromResponse, flattenMedia, getDisplayMessage, getLineItemBarcode, getMediaExpiry, isMediaUrlExpired, normalizeBarcode, parsePresignedExpiry, parseScan, reconcile, sortMediaBySide, topics, upcCoverage, validateGtinCheckDigit } from './chunk-C3LOARKS.js';
import { DEFAULT_EXCEPTION_COPY, mergeRealtimeIssues, deriveExceptions, isExceptionOpen, ISSUE_ACTION_BY_RESOLUTION } from './chunk-E5FMJVL7.js';
export { DEFAULT_EXCEPTION_COPY, ISSUE_ACTION_BY_RESOLUTION, PALLET_ONLY_EXCEPTIONS, SENTINEL_SKUS, collectIssues, deriveExceptions, isExceptionOpen, isSentinelLineItem, mergeRealtimeIssues, orderedLineItems, resolutionsFor } from './chunk-E5FMJVL7.js';
import * as React4 from 'react';
import { jsx } from 'react/jsx-runtime';

/**
 * @arvist/react
 * Copyright (c) 2026 Arvist, Inc.
 *
 * Licensed under the Business Source License 1.1 (the "License").
 * Production use is granted solely to develop, test, and operate
 * applications that interface with Arvist Services. Converts to the
 * Apache License 2.0 on 2030-03-01.
 *
 * SPDX-License-Identifier: BUSL-1.1
 * See the LICENSE file distributed with this package.
 */
var ArvistContext = React4.createContext(null);
function ArvistProvider({
  children,
  config,
  client: providedClient,
  realtime,
  errorMessages,
  copy,
  autoCompleted = false
}) {
  if (!providedClient && !config) {
    throw new Error("ArvistProvider: pass either `config` or `client`.");
  }
  const client = React4.useMemo(
    () => providedClient ?? new ArvistClient(config),
    // A new client per config identity; memoise `config` upstream to keep it stable.
    [providedClient, config]
  );
  const feed = React4.useMemo(() => {
    if (!realtime) return null;
    const transport = "transport" in realtime ? realtime.transport : createSocketIoTransport({
      url: realtime.url ?? config?.baseUrl ?? "",
      path: realtime.path,
      auth: realtime.auth,
      withCredentials: realtime.withCredentials ?? true,
      io: realtime.io
    });
    return new InspectionFeed({ transport });
  }, [realtime, config?.baseUrl]);
  React4.useEffect(() => {
    if (!feed) return;
    feed.connect();
    return () => feed.close();
  }, [feed]);
  const value = React4.useMemo(
    () => ({
      client,
      feed,
      realtimeAvailable: feed !== null,
      resolveErrorMessage: createErrorMessageResolver(errorMessages),
      copy: {
        titles: { ...DEFAULT_EXCEPTION_COPY.titles, ...copy?.titles },
        actions: { ...DEFAULT_EXCEPTION_COPY.actions, ...copy?.actions }
      },
      autoCompleted
    }),
    [client, feed, errorMessages, copy, autoCompleted]
  );
  return /* @__PURE__ */ jsx(ArvistContext.Provider, { value, children });
}
function useArvist() {
  const ctx = React4.useContext(ArvistContext);
  if (!ctx) throw new Error("useArvist must be used inside <ArvistProvider>.");
  return ctx;
}
function useArvistClient() {
  return useArvist().client;
}
function useAsync(fn, deps, options = {}) {
  const enabled = options.enabled ?? true;
  const [state, setState] = React4.useState({
    data: void 0,
    error: void 0,
    loading: enabled
  });
  const fnRef = React4.useRef(fn);
  fnRef.current = fn;
  const run = React4.useCallback(
    async (signal) => {
      setState((s) => ({ ...s, loading: true, error: void 0 }));
      try {
        const data = await fnRef.current(signal);
        if (!signal.aborted) setState({ data, error: void 0, loading: false });
      } catch (err) {
        if (signal.aborted) return;
        setState({
          data: void 0,
          loading: false,
          error: ArvistError.is(err) ? err : new ArvistError({ code: "unknown", message: "Something went wrong.", cause: err })
        });
      }
    },
    []
  );
  React4.useEffect(() => {
    if (!enabled) {
      setState({ data: void 0, error: void 0, loading: false });
      return;
    }
    const controller = new AbortController();
    void run(controller.signal);
    return () => controller.abort();
  }, [enabled, run, ...deps]);
  const refresh = React4.useCallback(async () => {
    const controller = new AbortController();
    await run(controller.signal);
  }, [run]);
  return {
    ...state,
    refresh,
    setData: (update) => setState((s) => ({
      ...s,
      data: typeof update === "function" ? update(s.data) : update
    }))
  };
}
function useStations(params = {}) {
  const { client } = useArvist();
  const { siteId } = params;
  const result = useAsync(
    (signal) => client.listStations(siteId != null ? { site_id: siteId } : {}, { signal }),
    [client, siteId]
  );
  return { ...result, stations: result.data ?? [] };
}
function useStationBinding(areaName, options = {}) {
  const { client } = useArvist();
  const { pollMs } = options;
  const result = useAsync(
    (signal) => client.checkStationBinding(areaName, { signal }),
    [client, areaName],
    { enabled: Boolean(areaName) }
  );
  const { refresh } = result;
  React4.useEffect(() => {
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
    refresh: result.refresh
  };
}
var DEFAULT_REFETCH_ON = ["unit-completed", "completed"];
function useInspection(options = {}) {
  const { client, feed, realtimeAvailable, autoCompleted } = useArvist();
  const { areaName, onEvent, onCompleted } = options;
  const refetchOn = options.refetchOn ?? DEFAULT_REFETCH_ON;
  const [shipment, setShipment] = React4.useState();
  const [phase, setPhase] = React4.useState("idle");
  const [progress, setProgress] = React4.useState(null);
  const [connection, setConnection] = React4.useState(feed?.state ?? "idle");
  const [error, setError] = React4.useState();
  const [loading, setLoading] = React4.useState(false);
  const [lastEvent, setLastEvent] = React4.useState();
  const [resolvedAreaId, setResolvedAreaId] = React4.useState(options.areaId);
  const [corrections, setCorrections] = React4.useState([]);
  const shipmentIdRef = React4.useRef(options.shipmentId);
  shipmentIdRef.current = shipment?.id ?? options.shipmentId;
  const onEventRef = React4.useRef(onEvent);
  onEventRef.current = onEvent;
  const onCompletedRef = React4.useRef(onCompleted);
  onCompletedRef.current = onCompleted;
  React4.useEffect(() => {
    if (options.areaId != null) {
      setResolvedAreaId(options.areaId);
      return;
    }
    if (!areaName) return;
    let cancelled = false;
    client.findStationByName(areaName).then((station) => {
      if (!cancelled) setResolvedAreaId(station.area_id);
    }).catch((err) => {
      if (!cancelled && ArvistError.is(err)) setError(err);
    });
    return () => {
      cancelled = true;
    };
  }, [client, areaName, options.areaId]);
  const explicitShipmentId = options.shipmentId;
  React4.useEffect(() => {
    if (explicitShipmentId == null) return;
    let cancelled = false;
    setLoading(true);
    client.getShipment(explicitShipmentId).then((s) => {
      if (cancelled) return;
      setShipment(s);
      setPhase(phaseFromStatus(s.status));
    }).catch((err) => !cancelled && setError(toArvistError(err))).finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [client, explicitShipmentId]);
  React4.useEffect(() => {
    if (!feed) return;
    feed.bind({ areaName, areaId: resolvedAreaId, shipmentId: shipmentIdRef.current });
  }, [feed, areaName, resolvedAreaId, shipment?.id]);
  React4.useEffect(() => {
    if (!feed) return;
    setConnection(feed.state);
    return feed.onStateChange((state) => setConnection(state));
  }, [feed]);
  const refresh = React4.useCallback(async () => {
    const id = shipmentIdRef.current;
    if (id == null) return;
    try {
      const fresh = await client.getShipment(id);
      if (shipmentIdRef.current !== id) return;
      setShipment(fresh);
      setPhase(phaseFromStatus(fresh.status));
    } catch (err) {
      if (shipmentIdRef.current === id) setError(toArvistError(err));
    }
  }, [client]);
  const adoptingStationShipmentRef = React4.useRef(false);
  const adoptStationShipment = React4.useCallback(async () => {
    if (!areaName || explicitShipmentId != null || adoptingStationShipmentRef.current) return;
    adoptingStationShipmentRef.current = true;
    try {
      const open = await client.listShipments({ areaName, status: "in_progress", limit: 1 });
      const match = open.data[0];
      if (!match || shipmentIdRef.current != null) return;
      const fresh = await client.getShipment(match.id);
      if (shipmentIdRef.current != null) return;
      setShipment(fresh);
      setPhase(phaseFromStatus(fresh.status));
    } catch {
    } finally {
      adoptingStationShipmentRef.current = false;
    }
  }, [client, areaName, explicitShipmentId]);
  React4.useEffect(() => {
    if (!feed) return;
    return feed.subscribe((event) => {
      setLastEvent(event);
      onEventRef.current?.(event);
      const current = shipmentIdRef.current;
      const eventShipmentId = getEventShipmentId(event);
      if (current != null && eventShipmentId != null && eventShipmentId !== current) return;
      if (current == null && (event.kind === "status" || event.kind === "completed" || event.kind === "canceled")) {
        if (event.kind === "status") void adoptStationShipment();
        return;
      }
      switch (event.kind) {
        case "started":
          setShipment(event.shipment);
          setPhase("in_progress");
          setProgress(null);
          setError(void 0);
          break;
        case "unit-completed":
          setShipment(
            (prev) => prev ? mergeRealtimeIssues(prev, event.payload) : prev
          );
          break;
        case "status":
          setProgress(event.progress);
          setPhase(phaseFromStatus(event.status));
          break;
        case "state-change": {
          const state = String(event.payload["inspection_state"] ?? "");
          if (state.includes("pause")) setPhase("paused");
          else if (state.includes("resume")) setPhase("in_progress");
          break;
        }
        case "completed":
          setPhase("completed");
          setProgress(1);
          break;
        case "canceled":
          setPhase("canceled");
          break;
        case "error":
          setPhase("error");
          setError(
            new ArvistError({
              code: "server_error",
              message: event.message ?? "The inspection reported an error.",
              detail: event.raw
            })
          );
          break;
      }
      if (refetchOn.includes(event.kind)) void refresh();
    });
  }, [feed, refresh, adoptStationShipment, ...refetchOn]);
  const completedFiredFor = React4.useRef(void 0);
  React4.useEffect(() => {
    if (phase !== "completed" || !shipment) return;
    if (completedFiredFor.current === shipment.id) return;
    completedFiredFor.current = shipment.id;
    onCompletedRef.current?.(shipment, reconcile(shipment));
  }, [phase, shipment]);
  const act = React4.useCallback(
    async (fn) => {
      setLoading(true);
      setError(void 0);
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
    []
  );
  const start = React4.useCallback(
    async (input) => {
      setPhase("starting");
      const payload = {
        area_name: areaName,
        ...input
      };
      const idempotencyKey = payload.shipment_key ?? payload.order_numbers?.join(",");
      const started = await act(
        () => client.startInspection(payload, idempotencyKey ? { idempotencyKey } : void 0)
      ).catch((err) => {
        setPhase("error");
        throw err;
      });
      setShipment(started);
      setPhase(phaseFromStatus(started.status));
      return started;
    },
    [act, client, areaName]
  );
  const requireShipment = React4.useCallback(() => {
    const id = shipmentIdRef.current;
    if (id == null) {
      throw new ArvistError({ code: "shipment_not_found", message: "No inspection is open." });
    }
    return id;
  }, []);
  const adopt = React4.useCallback((result) => {
    if (result.shipment) setShipment(result.shipment);
  }, []);
  const finish = React4.useCallback(async () => {
    const result = await act(() => client.finishInspection(requireShipment()));
    if (result.blocked_by === "shortage") {
      await refresh();
      const blocked = new ArvistError({
        code: "completion_blocked",
        message: result.message,
        detail: result.shortage_issues
      });
      setError(blocked);
      throw blocked;
    }
    adopt(result);
  }, [act, adopt, client, refresh, requireShipment]);
  const stageCorrection = React4.useCallback((lineItem, quantity) => {
    if (lineItem.id == null) {
      throw new ArvistError({
        code: "validation_failed",
        message: "That line item has no id, so its count cannot be corrected."
      });
    }
    const id = lineItem.id;
    setCorrections((prev) => [
      ...prev.filter((c) => c.id !== id),
      { id, actual_quantity: quantity, is_edited: true }
    ]);
  }, []);
  const clearCorrections = React4.useCallback(() => setCorrections([]), []);
  const submit = React4.useCallback(async () => {
    const staged = corrections;
    adopt(
      await act(
        () => client.submitInspection(
          requireShipment(),
          staged.length ? { line_items: staged } : {}
        )
      )
    );
    setCorrections([]);
    await refresh();
  }, [act, adopt, client, corrections, requireShipment, refresh]);
  const cancel = React4.useCallback(async () => {
    adopt(await act(() => client.cancelShipment(requireShipment())));
    setPhase("canceled");
  }, [act, adopt, client, requireShipment]);
  const pause = React4.useCallback(async () => {
    adopt(await act(() => client.pauseShipment(requireShipment())));
    setPhase("paused");
  }, [act, adopt, client, requireShipment]);
  const resume = React4.useCallback(async () => {
    adopt(await act(() => client.resumeShipment(requireShipment())));
    setPhase("in_progress");
  }, [act, adopt, client, requireShipment]);
  const clear = React4.useCallback(() => {
    setShipment(void 0);
    setPhase("idle");
    setProgress(null);
    setError(void 0);
    setLastEvent(void 0);
    setCorrections([]);
    completedFiredFor.current = void 0;
  }, []);
  const effectiveShipment = React4.useMemo(() => {
    if (!shipment || corrections.length === 0) return shipment;
    const byId = new Map(corrections.map((c) => [c.id, c]));
    return {
      ...shipment,
      line_items: shipment.line_items.map((item) => {
        const correction = item.id != null ? byId.get(item.id) : void 0;
        return correction ? { ...item, actual_quantity: correction.actual_quantity, is_edited: true } : item;
      })
    };
  }, [shipment, corrections]);
  const reconciliation = React4.useMemo(() => reconcile(effectiveShipment), [effectiveShipment]);
  const completion = React4.useMemo(
    () => checkCompletion(effectiveShipment, { autoCompleted }),
    [effectiveShipment, autoCompleted]
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
    clear
  };
}
function getEventShipmentId(event) {
  if ("shipmentId" in event) return event.shipmentId;
  if ("shipment" in event) return event.shipment.id;
  if ("payload" in event) {
    const id = event.payload.shipment_id;
    return typeof id === "number" ? id : void 0;
  }
  return void 0;
}
function phaseFromStatus(status) {
  switch (status) {
    case "in_progress":
    case "processing":
      return "in_progress";
    case "review":
      return "review";
    case "completed":
      return "completed";
    case "canceled":
    case "cancelled":
    case "deleted":
      return "canceled";
    case "pending":
      return "idle";
    default:
      return "in_progress";
  }
}
function toArvistError(err) {
  return ArvistError.is(err) ? err : new ArvistError({ code: "unknown", message: "Something went wrong.", cause: err });
}
var EMPTY_BY_TYPE = {
  unidentified_product: [],
  wrong_product: [],
  overage: [],
  shortage: [],
  manual_count_correction: [],
  wrong_load: [],
  missing_identifiers: [],
  unit_removed: [],
  damage: []
};
function useExceptions(shipment, options = {}) {
  const { client, copy, autoCompleted } = useArvist();
  const [resolving, setResolving] = React4.useState(null);
  const [error, setError] = React4.useState();
  const onResolvedRef = React4.useRef(options.onResolved);
  onResolvedRef.current = options.onResolved;
  const exceptions = React4.useMemo(
    () => deriveExceptions(shipment, { copy, autoCompleted }),
    [shipment, copy, autoCompleted]
  );
  const open = React4.useMemo(() => exceptions.filter(isExceptionOpen), [exceptions]);
  const blocking = React4.useMemo(() => open.filter((e) => e.blocksCompletion), [open]);
  const byType = React4.useMemo(() => {
    const grouped = {
      ...EMPTY_BY_TYPE,
      unidentified_product: [],
      wrong_product: [],
      overage: [],
      shortage: [],
      manual_count_correction: [],
      wrong_load: [],
      missing_identifiers: [],
      unit_removed: [],
      damage: []
    };
    for (const e of exceptions) grouped[e.type].push(e);
    return grouped;
  }, [exceptions]);
  const resolve = React4.useCallback(
    async (args) => {
      const { exception, resolution } = args;
      if (resolution.requiresReason && !args.reason?.trim()) {
        throw new ArvistError({
          code: "validation_failed",
          message: "A reason is required to record this as unresolved."
        });
      }
      if (!shipment) {
        throw new ArvistError({ code: "shipment_not_found", message: "No inspection is open." });
      }
      setResolving(exception.key);
      setError(void 0);
      try {
        await applyResolution(client, shipment, args);
        await onResolvedRef.current?.();
      } catch (err) {
        const normalized = ArvistError.is(err) ? err : new ArvistError({ code: "unknown", message: "Could not resolve.", cause: err });
        setError(normalized);
        throw normalized;
      } finally {
        setResolving(null);
      }
    },
    [client, shipment]
  );
  return {
    exceptions,
    open,
    blocking,
    byType,
    hasBlockers: blocking.length > 0,
    resolving,
    error,
    resolve
  };
}
async function applyResolution(client, shipment, args) {
  const { exception, resolution, reason, metadata, identifier, quantity, sku, targetSku, annotationId } = args;
  const action = resolution.action;
  if (action === "submit_identifiers") {
    if (!identifier?.trim()) {
      throw new ArvistError({
        code: "validation_failed",
        message: "Enter the pallet identifier before confirming."
      });
    }
    await client.updatePalletIdentifier({
      shipment_id: shipment.id,
      shipment_unit_id: exception.unitId,
      identifier: identifier.trim(),
      metadata
    });
    return;
  }
  if (action === "cancel_unit") {
    if (!exception.unitId) {
      throw new ArvistError({
        code: "validation_failed",
        message: "This exception is not attached to a unit."
      });
    }
    await client.cancelUnit(shipment.id, exception.unitId);
    return;
  }
  const backendAction = ISSUE_ACTION_BY_RESOLUTION[exception.type]?.[action];
  if (backendAction) {
    if (!exception.issue) {
      throw new ArvistError({
        code: "validation_failed",
        message: "This exception has no issue row to resolve."
      });
    }
    await client.resolveIssueById(
      buildIssueResolveInput(exception.issue.id, backendAction, exception.issue.metadata, {
        sku,
        targetSku,
        annotationId,
        quantity
      })
    );
    return;
  }
  if (exception.unitSessionId == null || !exception.issue) return;
  await client.resolveIssue({
    unit_session_id: exception.unitSessionId,
    issue_type: exception.issue.issue_type,
    status: resolution.status ?? "resolved",
    reason,
    metadata: { ...metadata, resolution_action: action }
  });
}
function buildIssueResolveInput(issueId, backendAction, issueMetadata, input) {
  const pinnedAnnotationId = issueMetadata?.["annotation_id"];
  const must = (value, message) => {
    if (value == null) throw new ArvistError({ code: "validation_failed", message });
    return value;
  };
  switch (backendAction) {
    case "assign":
      return {
        issue_id: issueId,
        action: "assign",
        annotation_id: must(pinnedAnnotationId, "This issue has no annotation to resolve against."),
        sku: must(input.sku?.trim(), "Pick the product this item should be before confirming.")
      };
    case "invalid":
      return {
        issue_id: issueId,
        action: "invalid",
        annotation_id: must(pinnedAnnotationId, "This issue has no annotation to resolve against.")
      };
    case "keep_in_order":
      return {
        issue_id: issueId,
        action: "keep_in_order",
        annotation_id: must(pinnedAnnotationId, "This issue has no annotation to resolve against."),
        ...input.sku?.trim() ? { sku: input.sku.trim() } : {}
      };
    case "correct_product":
      return {
        issue_id: issueId,
        action: "correct_product",
        annotation_id: must(pinnedAnnotationId, "This issue has no annotation to resolve against."),
        sku: must(input.sku?.trim(), "Pick the correct product before confirming.")
      };
    case "remove_product":
      return {
        issue_id: issueId,
        action: "remove_product",
        annotation_id: must(pinnedAnnotationId, "This issue has no annotation to resolve against."),
        ...input.sku?.trim() ? { sku: input.sku.trim() } : {}
      };
    case "remove_extra":
      return { issue_id: issueId, action: "remove_extra" };
    case "reassign":
      return {
        issue_id: issueId,
        action: "reassign",
        annotation_id: must(input.annotationId, "Pick the detected item being reassigned before confirming."),
        target_sku: must(input.targetSku?.trim(), "Pick the product the extra units belong to before confirming.")
      };
    case "missing_added":
      return { issue_id: issueId, action: "missing_added" };
    case "wrong_counting":
      return {
        issue_id: issueId,
        action: "wrong_counting",
        corrected_quantity: must(input.quantity, "Enter the corrected quantity before confirming.")
      };
    default:
      throw new ArvistError({ code: "unknown", message: `Unhandled issue action "${backendAction}".` });
  }
}
function useBarcodeScanner(options) {
  const {
    enabled = true,
    preventDefault = true,
    captureInInputs = false,
    maxKeystrokeGapMs,
    minLength,
    onScan,
    target
  } = options;
  const onScanRef = React4.useRef(onScan);
  onScanRef.current = onScan;
  React4.useEffect(() => {
    if (!enabled || typeof document === "undefined") return;
    const element = (target && "current" in target ? target.current : target) ?? document;
    const buffer = createScanBuffer({
      maxKeystrokeGapMs,
      minLength,
      onScan: (code) => onScanRef.current(parseScan(code))
    });
    const handler = (event) => {
      const keyEvent = event;
      if (!captureInInputs && isEditable(keyEvent.target)) return;
      const consumed = buffer.handleKey(keyEvent);
      if (consumed && preventDefault) keyEvent.preventDefault();
    };
    element.addEventListener("keydown", handler);
    return () => {
      element.removeEventListener("keydown", handler);
      buffer.reset();
    };
  }, [enabled, target, preventDefault, captureInInputs, maxKeystrokeGapMs, minLength]);
}
function useScanMatch(lineItems, options = {}) {
  const { onMatch, onUnmatched, ...scannerOptions } = options;
  const [lastScan, setLastScan] = React4.useState();
  const [matched, setMatched] = React4.useState();
  const index = React4.useMemo(() => buildBarcodeIndex(lineItems), [lineItems]);
  const callbacks = React4.useRef({ onMatch, onUnmatched });
  callbacks.current = { onMatch, onUnmatched };
  useBarcodeScanner({
    ...scannerOptions,
    onScan: (scan) => {
      setLastScan(scan);
      const hit = index.get(scan.value);
      setMatched(hit);
      if (hit) callbacks.current.onMatch?.(hit, scan);
      else callbacks.current.onUnmatched?.(scan);
    }
  });
  return {
    lastScan,
    matched,
    unmatched: lastScan !== void 0 && matched === void 0,
    clear: React4.useCallback(() => {
      setLastScan(void 0);
      setMatched(void 0);
    }, [])
  };
}
function isEditable(target) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}
function useShipmentMedia(source, options = {}) {
  const { client } = useArvist();
  const autoRefresh = options.autoRefresh ?? true;
  const [stale, setStale] = React4.useState(false);
  const receivedAt = React4.useRef(void 0);
  const shipmentId = typeof source === "number" ? source : source?.id;
  const revision = typeof source === "number" || !source ? "" : (source.units ?? []).map((u) => `${u.id}:${u.quality_sessions?.[0]?.id ?? ""}`).join("|");
  const result = useAsync(
    async (signal) => {
      const images2 = await client.getShipmentMedia(shipmentId, { signal });
      receivedAt.current = /* @__PURE__ */ new Date();
      setStale(false);
      return images2;
    },
    [client, shipmentId, revision],
    { enabled: shipmentId != null }
  );
  const images = React4.useMemo(() => result.data ?? [], [result.data]);
  const items = React4.useMemo(() => sortMediaBySide(flattenMedia(images)), [images]);
  const { refresh } = result;
  React4.useEffect(() => {
    if (!images.length) return;
    const check = () => {
      const soonest = images.map((img) => getMediaExpiry(img.media, receivedAt.current)).filter((e) => e.msRemaining != null).sort((a, b) => (a.msRemaining ?? 0) - (b.msRemaining ?? 0))[0];
      if (!soonest) return;
      if (soonest.stale) {
        setStale(true);
        if (autoRefresh) void refresh();
      }
    };
    check();
    const timer = setInterval(check, 3e4);
    return () => clearInterval(timer);
  }, [images, autoRefresh, refresh]);
  return {
    images,
    items,
    loading: result.loading,
    error: result.error,
    stale,
    refresh: result.refresh
  };
}

export { ArvistProvider, useArvist, useArvistClient, useAsync, useBarcodeScanner, useExceptions, useInspection, useScanMatch, useShipmentMedia, useStationBinding, useStations };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map