import { isSentinelLineItem, orderedLineItems, deriveExceptions, isExceptionOpen } from './chunk-E5FMJVL7.js';

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

// src/core/errors.ts
var ArvistError = class _ArvistError extends Error {
  code;
  status;
  detail;
  requestId;
  retryable;
  constructor(init) {
    super(init.message, init.cause ? { cause: init.cause } : void 0);
    this.name = "ArvistError";
    this.code = init.code;
    this.status = init.status;
    this.detail = init.detail;
    this.requestId = init.requestId;
    this.retryable = init.retryable ?? false;
  }
  static is(err) {
    return err instanceof _ArvistError;
  }
};
var DEFAULT_ERROR_MESSAGES = {
  network_error: "Cannot reach Arvist. Check the network connection and try again.",
  timeout: "Arvist did not respond in time. Try again.",
  edge_forbidden: "This device is not allowed to reach Arvist. Contact your administrator.",
  unauthorized: "Your session has expired. Sign in again.",
  forbidden: "You do not have permission to do that.",
  bad_request: "That request was not valid. Check the details and try again.",
  not_found: "That record no longer exists.",
  conflict: "Someone else changed this record. Refresh and try again.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  validation_failed: "Some required information is missing or incorrect.",
  station_not_found: "That station name is not configured in Arvist.",
  station_not_bound: "No screen is currently set to this station, so the inspection cannot open. Select the station in Shipment Inspection Settings.",
  shipment_not_found: "That shipment could not be found.",
  shipment_already_open: "An inspection is already open at this station.",
  completion_blocked: "This inspection cannot be completed while a shortage is unresolved.",
  issue_not_found: "That exception has already been closed.",
  server_error: "Arvist hit an unexpected error. Try again, and report it if it repeats.",
  unknown: "Something went wrong."
};
function createErrorMessageResolver(overrides) {
  return (code, fallback) => overrides?.[code] ?? DEFAULT_ERROR_MESSAGES[code] ?? fallback;
}
function getDisplayMessage(err, resolve) {
  const resolver = resolve ?? ((code, fallback) => DEFAULT_ERROR_MESSAGES[code] ?? fallback);
  if (ArvistError.is(err)) return resolver(err.code, err.message);
  return resolver("unknown", DEFAULT_ERROR_MESSAGES.unknown);
}
var STATUS_CODES = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  422: "validation_failed",
  429: "rate_limited"
};
var DOMAIN_HINTS = [
  [/quality ?station .*(not found|does not exist)|invalid area/i, "station_not_found"],
  [/no (browser|client|screen).*(station|selected)|station .*not (selected|bound|responding)/i, "station_not_bound"],
  [/shipment .*not found/i, "shipment_not_found"],
  [/already (in progress|started|open)/i, "shipment_already_open"],
  [/shortage|cannot complete|open issues/i, "completion_blocked"],
  [/issue .*not found/i, "issue_not_found"],
  [/required|must be|invalid/i, "validation_failed"]
];
function extractMessage(body) {
  if (typeof body === "string" && body.trim()) return body.trim();
  if (body && typeof body === "object") {
    const b = body;
    for (const key of ["error", "message", "detail"]) {
      const v = b[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return void 0;
}
function errorFromResponse(status, body, requestId) {
  const raw = extractMessage(body);
  let code = STATUS_CODES[status] ?? (status >= 500 ? "server_error" : "unknown");
  if (status === 403 && !raw) code = "edge_forbidden";
  if (raw && (status === 400 || status === 404 || status === 409)) {
    for (const [pattern, hinted] of DOMAIN_HINTS) {
      if (pattern.test(raw)) {
        code = hinted;
        break;
      }
    }
  }
  return new ArvistError({
    code,
    message: DEFAULT_ERROR_MESSAGES[code],
    status,
    detail: raw ?? body,
    requestId,
    retryable: status === 429 || status >= 500
  });
}

// src/core/client.ts
var API_PREFIX = "/v1/api";
var IDEMPOTENCY_WINDOW_MS = 1e4;
var ArvistClient = class {
  config;
  fetchImpl;
  inflight = /* @__PURE__ */ new Map();
  constructor(config) {
    if (!config.baseUrl) throw new Error("ArvistClient: baseUrl is required");
    this.config = config;
    this.fetchImpl = config.fetch ?? globalThis.fetch?.bind(globalThis);
    if (!this.fetchImpl) {
      throw new Error("ArvistClient: no fetch implementation available; pass one via config.fetch");
    }
  }
  // -------------------------------------------------------------------------
  // Quality stations
  // -------------------------------------------------------------------------
  /** Lists configured quality stations for the site. */
  listStations(params = {}, opts) {
    return this.request("GET", "/locations/quality-stations", {
      query: params,
      ...opts
    });
  }
  /**
   * Resolves a station name (e.g. `Z01-PS-001`) to its record.
   *
   * Upstream systems address stations by name while the realtime feed keys
   * per-unit topics on `area_id`, so most integrations need this lookup once at
   * startup.
   */
  async findStationByName(areaName, opts) {
    const stations = await this.listStations({}, opts);
    const needle = areaName.trim().toLowerCase();
    const match = stations.find(
      (s) => s.area_name?.trim().toLowerCase() === needle || s.name?.trim().toLowerCase() === needle
    );
    if (!match) {
      throw new ArvistError({
        code: "station_not_found",
        message: `No quality station is configured with the name "${areaName}".`,
        detail: { areaName, known: stations.map((s) => s.area_name ?? s.name) }
      });
    }
    return match;
  }
  // -------------------------------------------------------------------------
  // Shipments
  // -------------------------------------------------------------------------
  listShipments(query = {}, opts) {
    return this.request("GET", "/quality/inspection/shipment", {
      query,
      ...opts
    });
  }
  /**
   * A single shipment.
   *
   * The response is the shipment object itself — not wrapped — with live
   * `progress` and `inspection_state` folded in.
   */
  getShipment(id, opts) {
    return this.request("GET", `/quality/inspection/shipment/${id}`, opts);
  }
  /**
   * Starts an inspection at a station.
   *
   * Address the station by `area_name` when the caller is an upstream system —
   * it is the stable identifier operators and WMS records share. The inspection
   * opens on whichever screen currently has that station selected, so a start
   * that succeeds here can still go unseen if no screen is bound; see
   * {@link ArvistClient.checkStationBinding}.
   *
   * Pass `idempotencyKey` (the tote or order number is a good choice) so a
   * repeated scan does not create a second inspection.
   */
  async startInspection(input, opts) {
    const body = await this.request("POST", "/quality/inspection/shipment", {
      body: input,
      ...opts
    });
    const shipment = pickShipment(body);
    if (!shipment) {
      throw new ArvistError({
        code: "server_error",
        message: "The inspection was started but the API did not return it.",
        detail: body
      });
    }
    return shipment;
  }
  /** Marks an inspection finished — no further units are expected. */
  finishInspection(shipmentId, opts) {
    return this.action("POST", "/quality/inspection/shipment/finished", shipmentId, opts);
  }
  /**
   * Submits the inspection results. Call after {@link finishInspection}.
   *
   * Manual count corrections ride along here rather than being written as they
   * are made — there is no live endpoint for editing a line item's count. Pass
   * them as `line_items`, each with the existing line item's `id`.
   */
  async submitInspection(shipmentId, input = {}, opts) {
    const body = await this.request("POST", "/quality/inspection/shipment/submit", {
      body: { shipment_id: shipmentId, ...input },
      ...opts
    });
    return toActionResult(body);
  }
  cancelShipment(shipmentId, opts) {
    return this.action("POST", "/quality/inspection/shipment/cancel-shipment", shipmentId, opts);
  }
  async cancelUnit(shipmentId, unitId, opts) {
    const body = await this.request("POST", "/quality/inspection/shipment/cancel-unit", {
      body: { shipment_id: shipmentId, unit_id: unitId },
      ...opts
    });
    return toActionResult(body);
  }
  pauseShipment(shipmentId, opts) {
    return this.action("POST", "/quality/inspection/shipment/pause-shipment", shipmentId, opts);
  }
  resumeShipment(shipmentId, opts) {
    return this.action("POST", "/quality/inspection/shipment/resume-shipment", shipmentId, opts);
  }
  async action(method, path, shipmentId, opts) {
    const body = await this.request(method, path, {
      body: { shipment_id: shipmentId },
      ...opts
    });
    return toActionResult(body);
  }
  // -------------------------------------------------------------------------
  // Exceptions
  // -------------------------------------------------------------------------
  listIssues(unitSessionId, opts) {
    return this.request(
      "GET",
      `/quality/inspection/shipment-issue/unit/${unitSessionId}`,
      opts
    );
  }
  /**
   * Sets the status of a session-scoped exception by unit session and type.
   *
   * `damage`/`wrong_load`/`no_identifiers` only — those are one-per-session, so
   * `(unit_session_id, issue_type)` identifies a single row. `status` is what
   * actually closes it: `resolved`, `canceled` (the unit leaves the
   * inspection), `false_positive`, or `unresolved` with a `reason` when it has
   * to be escalated. `unidentified_product`/`wrong_product`/`overage`/
   * `shortage` are per-instance or session-less and resolve through
   * {@link ArvistClient.resolveIssueById} instead.
   */
  async resolveIssue(input, opts) {
    const { unit_session_id, ...body } = input;
    const result = await this.request(
      "PUT",
      `/quality/inspection/shipment-issue/unit/${unit_session_id}`,
      { body, ...opts }
    );
    return toActionResult(result);
  }
  /**
   * Resolves one issue by id via a keyword `action`.
   *
   * The modern per-instance resolve path for `unidentified_product`,
   * `wrong_product`, `overage`, and `shortage` issues. Each action is valid
   * for a specific set of issue types and origin statuses — the API 400s if
   * the pairing doesn't match; see {@link IssueResolveAction}.
   */
  async resolveIssueById(input, opts) {
    const { issue_id, ...body } = input;
    const result = await this.request(
      "PATCH",
      `/quality/inspection/shipment-issue/${issue_id}/resolve`,
      { body, ...opts }
    );
    return toActionResult(result);
  }
  /**
   * Reclassifies an item that could not be identified.
   *
   * This works on a *detection annotation*, not on a line item — the count
   * moves out of the shipment's `unknown` bucket and onto whatever the
   * annotation says the item really is. Which of three things happens is
   * inferred from the annotation you send:
   *
   * - `category_id: 'remove'` — drop the item from the count.
   * - any non-quantity value in `identifiers` — the item belongs to another
   *   order; it moves to the `wrong` bucket.
   * - otherwise — `category_id` is the id of the line item it really is, and
   *   `identifiers.items_quantity` (default 1) moves onto that line.
   *
   * The call fails if the `unknown` bucket is already empty.
   */
  async updateUnknownProduct(input, opts) {
    const result = await this.request(
      "PUT",
      "/quality/inspection/shipment/unknown-product/update",
      { body: input, ...opts }
    );
    return toActionResult(result);
  }
  /** Supplies pallet identifiers that could not be read from the label. */
  async updatePalletIdentifier(body, opts) {
    const result = await this.request(
      "PUT",
      "/quality/inspection/shipment/pallet-identifier",
      { body, ...opts }
    );
    return toActionResult(result);
  }
  // -------------------------------------------------------------------------
  // Media
  // -------------------------------------------------------------------------
  /**
   * Images for a shipment, as presigned URLs.
   *
   * The URLs are short-lived — copy anything you need to retain to your own
   * storage on receipt rather than storing the URL.
   */
  async getShipmentMedia(shipmentId, opts) {
    const shipment = await this.getShipment(shipmentId, opts);
    return (shipment.units ?? []).flatMap(
      (u) => (u.quality_sessions?.[0]?.images ?? []).map((img) => ({ ...img }))
    );
  }
  /** Presigned URL for a captured video clip. */
  getVideoUrl(contentId, opts) {
    return this.request(
      "GET",
      `/quality/inspection/shipment/video/presigned/${contentId}`,
      opts
    );
  }
  // -------------------------------------------------------------------------
  // Diagnostics
  // -------------------------------------------------------------------------
  /**
   * Checks that a station exists and that something is listening on it.
   *
   * An inspection opens on whichever screen has the station selected. If none
   * does, `startInspection` still returns 200 and the inspection sits unopened
   * — the most common "station not responding" report. Call this before or
   * alongside a start to surface that as a real condition rather than silence.
   */
  async checkStationBinding(areaName, opts) {
    const station = await this.findStationByName(areaName, opts);
    const open = await this.listShipments(
      { areaName, status: "in_progress", limit: 1 },
      opts
    );
    return {
      station,
      hasOpenInspection: open.data.length > 0,
      warning: open.data.length > 0 ? "shipment_already_open" : void 0
    };
  }
  // -------------------------------------------------------------------------
  // Transport
  // -------------------------------------------------------------------------
  async buildHeaders(hasBody) {
    const headers = new Headers(this.config.headers);
    if (hasBody) headers.set("content-type", "application/json");
    headers.set("accept", "application/json");
    const rawToken = this.config.token;
    const token = typeof rawToken === "function" ? await rawToken() : rawToken;
    if (token) headers.set("authorization", `Bearer ${token}`);
    const cf = this.config.cloudflareAccess;
    if (cf) {
      headers.set("CF-Access-Client-Id", cf.clientId);
      headers.set("CF-Access-Client-Secret", cf.clientSecret);
    }
    return headers;
  }
  buildUrl(path, query) {
    const base = this.config.baseUrl.replace(/\/+$/, "");
    const url = new URL(`${base}${API_PREFIX}${path}`);
    const merged = { ...query };
    if (this.config.siteId != null && merged["site_id"] == null) {
      merged["site_id"] = this.config.siteId;
    }
    for (const [key, value] of Object.entries(merged)) {
      if (value == null || value === "") continue;
      if (Array.isArray(value)) {
        for (const v of value) url.searchParams.append(key, String(v));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }
  /** Escape hatch for endpoints the SDK does not wrap yet. */
  async request(method, path, options = {}) {
    const { idempotencyKey } = options;
    if (idempotencyKey) {
      const cached = this.inflight.get(idempotencyKey);
      if (cached && Date.now() - cached.at < IDEMPOTENCY_WINDOW_MS) {
        return cached.promise;
      }
    }
    const promise = this.execute(method, path, options);
    if (idempotencyKey) {
      this.inflight.set(idempotencyKey, { at: Date.now(), promise });
      promise.catch(() => this.inflight.delete(idempotencyKey));
    }
    return promise;
  }
  async execute(method, path, options) {
    const maxRetries = options.retries ?? this.config.retries ?? 2;
    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs ?? 3e4;
    const url = this.buildUrl(path, options.query);
    const hasBody = options.body !== void 0;
    let body = options.body;
    if (hasBody && this.config.siteId != null && isPlainObject(body) && body["site_id"] == null) {
      body = { ...body, site_id: this.config.siteId };
    }
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const startedAt = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const onAbort = () => controller.abort();
      options.signal?.addEventListener("abort", onAbort, { once: true });
      try {
        const response = await this.fetchImpl(url, {
          method,
          headers: await this.buildHeaders(hasBody),
          body: hasBody ? JSON.stringify(body) : void 0,
          credentials: this.config.credentials,
          signal: controller.signal
        });
        const requestId = response.headers.get("x-request-id") ?? void 0;
        const payload = await parseBody(response);
        if (!response.ok) {
          const error = errorFromResponse(response.status, payload, requestId);
          this.config.onRequest?.({
            method,
            path,
            status: response.status,
            durationMs: Date.now() - startedAt,
            attempt,
            error
          });
          if (error.retryable && attempt < maxRetries) {
            lastError = error;
            await backoff(attempt);
            continue;
          }
          throw error;
        }
        this.config.onRequest?.({
          method,
          path,
          status: response.status,
          durationMs: Date.now() - startedAt,
          attempt
        });
        return payload;
      } catch (err) {
        if (ArvistError.is(err)) throw err;
        const aborted = options.signal?.aborted === true;
        const error = new ArvistError({
          code: aborted ? "unknown" : controller.signal.aborted ? "timeout" : "network_error",
          message: aborted ? "Request cancelled." : "Could not reach Arvist.",
          retryable: !aborted,
          cause: err
        });
        this.config.onRequest?.({
          method,
          path,
          durationMs: Date.now() - startedAt,
          attempt,
          error
        });
        if (error.retryable && attempt < maxRetries) {
          lastError = error;
          await backoff(attempt);
          continue;
        }
        throw error;
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
      }
    }
    throw lastError ?? new ArvistError({ code: "unknown", message: "Request failed." });
  }
};
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
async function parseBody(response) {
  const type = response.headers.get("content-type") ?? "";
  if (response.status === 204) return void 0;
  if (type.includes("application/json")) {
    return response.json().catch(() => void 0);
  }
  return response.text().catch(() => void 0);
}
function pickShipment(body) {
  if (!isPlainObject(body)) return void 0;
  for (const key of ["shipment", "data"]) {
    const value = body[key];
    if (isPlainObject(value) && typeof value["id"] === "number") return value;
  }
  return typeof body["id"] === "number" ? body : void 0;
}
function toActionResult(body) {
  if (typeof body === "string") return { message: body, raw: body };
  if (isPlainObject(body)) {
    const message = typeof body["message"] === "string" ? body["message"] : "OK";
    const shipment = pickShipment(body);
    const blocked_by = body["blocked_by"] === "shortage" ? "shortage" : void 0;
    const shortage_issues = Array.isArray(body["shortage_issues"]) ? body["shortage_issues"] : void 0;
    return {
      message,
      ...shipment ? { shipment } : {},
      ...blocked_by ? { blocked_by } : {},
      ...shortage_issues ? { shortage_issues } : {},
      raw: body
    };
  }
  return { message: "OK", raw: body };
}
function backoff(attempt) {
  const base = Math.min(1e3 * 2 ** attempt, 8e3);
  const jitter = Math.random() * 250;
  return new Promise((resolve) => setTimeout(resolve, base + jitter));
}

// src/core/realtime.ts
function createSocketIoTransport(config) {
  let socket = null;
  let state = "idle";
  const stateHandlers = /* @__PURE__ */ new Set();
  const topicHandlers = /* @__PURE__ */ new Map();
  const setState = (next, error) => {
    state = next;
    for (const h of stateHandlers) h(next, error);
  };
  const bind = (topic) => {
    socket?.on(topic, (...args) => {
      const payload = args[0];
      for (const h of topicHandlers.get(topic) ?? []) h(payload);
    });
  };
  return {
    get state() {
      return state;
    },
    connect() {
      if (socket) {
        if (!socket.connected) socket.connect();
        return;
      }
      setState("connecting");
      socket = config.io(config.url, {
        path: config.path ?? "/socket.io",
        transports: ["websocket", "polling"],
        withCredentials: config.withCredentials ?? true,
        auth: config.auth,
        extraHeaders: config.extraHeaders
      });
      socket.on("connect", () => setState("connected"));
      socket.on("disconnect", () => setState("reconnecting"));
      socket.on(
        "connect_error",
        (err) => setState("reconnecting", err instanceof Error ? err : new Error(String(err)))
      );
      for (const topic of topicHandlers.keys()) bind(topic);
    },
    close() {
      socket?.disconnect();
      socket = null;
      topicHandlers.clear();
      setState("closed");
    },
    on(topic, handler) {
      const existing = topicHandlers.get(topic);
      if (existing) {
        existing.add(handler);
        return;
      }
      topicHandlers.set(topic, /* @__PURE__ */ new Set([handler]));
      if (socket) bind(topic);
    },
    off(topic, handler) {
      if (!handler) {
        topicHandlers.delete(topic);
        socket?.off(topic);
        return;
      }
      const set = topicHandlers.get(topic);
      set?.delete(handler);
      if (set && set.size === 0) {
        topicHandlers.delete(topic);
        socket?.off(topic);
      }
    },
    onStateChange(handler) {
      stateHandlers.add(handler);
      return () => stateHandlers.delete(handler);
    }
  };
}
var topics = {
  /** Global. Every shipment lifecycle transition. */
  update: () => "shipment-status/update",
  /** Keyed by station *name*, because that is what upstream systems address. */
  start: (areaName) => `shipment-status/start/${areaName}`,
  /** Keyed by station *id*. */
  unitProcessing: (areaId) => `shipment-status/unit-processing/${areaId}`,
  unitCompleted: (areaId) => `shipment-status/unit-completed/${areaId}`,
  damagesDetected: (areaId) => `shipment-status/damages-detected/${areaId}`,
  stationStateChange: (areaId) => `shipment-status/state-change/station/${areaId}`,
  /** Keyed by shipment id. */
  shipmentStateChange: (shipmentId) => `shipment-status/state-change/shipment/${shipmentId}`,
  error: (shipmentId) => `shipment-status/error/${shipmentId}`,
  complete: (shipmentId) => `shipment-status/complete/${shipmentId}`
};
var InspectionFeed = class {
  transport;
  listeners = /* @__PURE__ */ new Set();
  bound = /* @__PURE__ */ new Map();
  buffer = [];
  bufferSize;
  onError;
  binding = {};
  constructor(options) {
    this.transport = options.transport;
    this.bufferSize = options.bufferSize ?? 50;
    this.onError = options.onError;
  }
  get state() {
    return this.transport.state;
  }
  get currentBinding() {
    return this.binding;
  }
  connect() {
    this.transport.connect();
  }
  onStateChange(handler) {
    return this.transport.onStateChange(handler);
  }
  /** Points the feed at a station and, optionally, the shipment in progress. */
  bind(binding) {
    this.binding = binding;
    const wanted = /* @__PURE__ */ new Map();
    wanted.set(topics.update(), "update");
    if (binding.areaName) wanted.set(topics.start(binding.areaName), "started");
    if (binding.areaId != null) {
      wanted.set(topics.unitProcessing(binding.areaId), "unit-processing");
      wanted.set(topics.unitCompleted(binding.areaId), "unit-completed");
      wanted.set(topics.damagesDetected(binding.areaId), "damages-detected");
      wanted.set(topics.stationStateChange(binding.areaId), "state-change");
    }
    if (binding.shipmentId != null) {
      wanted.set(topics.shipmentStateChange(binding.shipmentId), "state-change");
      wanted.set(topics.error(binding.shipmentId), "error");
      wanted.set(topics.complete(binding.shipmentId), "completed");
    }
    for (const topic of [...this.bound.keys()]) {
      if (!wanted.has(topic)) this.unbindTopic(topic);
    }
    for (const [topic, kind] of wanted) {
      if (!this.bound.has(topic)) this.bindTopic(topic, kind);
    }
  }
  subscribe(listener) {
    this.listeners.add(listener);
    if (this.buffer.length) {
      const replay = this.buffer.splice(0, this.buffer.length);
      for (const event of replay) listener(event);
    }
    return () => this.listeners.delete(listener);
  }
  close() {
    for (const topic of [...this.bound.keys()]) this.unbindTopic(topic);
    this.listeners.clear();
    this.buffer.length = 0;
    this.transport.close();
  }
  bindTopic(topic, kind) {
    const handler = (payload) => {
      try {
        const event = normalize(kind, payload, topic);
        if (event) this.emit(event);
      } catch (err) {
        this.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    };
    this.bound.set(topic, handler);
    this.transport.on(topic, handler);
  }
  unbindTopic(topic) {
    const handler = this.bound.get(topic);
    if (handler) this.transport.off(topic, handler);
    this.bound.delete(topic);
  }
  emit(event) {
    if (this.listeners.size === 0) {
      if (this.bufferSize > 0) {
        this.buffer.push(event);
        if (this.buffer.length > this.bufferSize) this.buffer.shift();
      }
      return;
    }
    for (const listener of this.listeners) listener(event);
  }
};
var CANCEL_STATUSES = /* @__PURE__ */ new Set(["canceled", "cancelled", "deleted"]);
function normalize(kind, raw, topic) {
  const payload = raw ?? {};
  switch (kind) {
    case "started": {
      const shipment = payload["shipment"] ?? payload;
      return shipment?.id ? { kind: "started", shipment, raw } : null;
    }
    case "update": {
      const shipmentId = Number(payload["shipment_id"]);
      if (!Number.isFinite(shipmentId)) return null;
      const status = String(payload["status"] ?? "");
      const progressRaw = payload["progress"];
      const progress = typeof progressRaw === "number" ? progressRaw : null;
      if (status === "completed") return { kind: "completed", shipmentId, raw };
      if (CANCEL_STATUSES.has(status)) return { kind: "canceled", shipmentId, raw };
      return { kind: "status", shipmentId, status, progress, raw };
    }
    case "unit-processing":
      return { kind: "unit-processing", payload, raw };
    case "unit-completed": {
      const issues = Array.isArray(payload["issues"]) ? payload["issues"] : [];
      return { kind: "unit-completed", payload, issues, raw };
    }
    case "damages-detected":
      return { kind: "damages-detected", payload, raw };
    case "state-change":
      return {
        kind: "state-change",
        scope: topic.includes("/station/") ? "station" : "shipment",
        payload,
        raw
      };
    case "completed": {
      const shipmentId = Number(payload["shipment_id"]);
      return Number.isFinite(shipmentId) ? { kind: "completed", shipmentId, raw } : null;
    }
    case "error": {
      const shipmentId = Number(payload["shipment_id"]);
      const message = typeof payload["message"] === "string" ? payload["message"] : void 0;
      return { kind: "error", shipmentId, message, raw };
    }
    default:
      return null;
  }
}

// src/core/reconcile.ts
function getLineItemBarcode(item) {
  const upc = item.additional_data?.["upc"];
  if (typeof upc === "string" && upc.trim()) return upc.trim();
  if (typeof upc === "number") return String(upc);
  return item.sku?.trim() || void 0;
}
function buildBarcodeIndex(items) {
  const index = /* @__PURE__ */ new Map();
  for (const item of items ?? []) {
    if (isSentinelLineItem(item)) continue;
    const code = getLineItemBarcode(item);
    if (code) index.set(normalizeBarcode(code), item);
    if (item.sku) index.set(normalizeBarcode(item.sku), item);
  }
  return index;
}
function normalizeBarcode(code) {
  const trimmed = code.trim().toUpperCase();
  return /^\d+$/.test(trimmed) ? trimmed.replace(/^0+(?=\d)/, "") : trimmed;
}
function upcCoverage(items) {
  const ordered = orderedLineItems(items);
  const missing = ordered.filter((i) => {
    const upc = i.additional_data?.["upc"];
    return !(typeof upc === "string" && upc.trim()) && typeof upc !== "number";
  });
  const withUpc = ordered.length - missing.length;
  return {
    total: ordered.length,
    withUpc,
    ratio: ordered.length === 0 ? 1 : withUpc / ordered.length,
    missing
  };
}
function reconcile(shipment) {
  const all = shipment?.line_items ?? [];
  const lines = orderedLineItems(all).map((item) => {
    const expected = item.expected_quantity ?? 0;
    const actual = item.actual_quantity ?? 0;
    const delta = actual - expected;
    return {
      item,
      expected,
      actual,
      delta,
      variance: delta === 0 ? "match" : delta > 0 ? "over" : "short",
      manuallyCorrected: item.is_edited === true,
      barcode: getLineItemBarcode(item)
    };
  });
  const offOrder = all.filter((i) => isSentinelLineItem(i) && (i.actual_quantity ?? 0) > 0).map((item) => ({
    sku: item.sku.toLowerCase().trim(),
    item,
    quantity: item.actual_quantity ?? 0
  }));
  const totals = lines.reduce(
    (acc, l) => ({
      expected: acc.expected + l.expected,
      actual: acc.actual + l.actual,
      delta: acc.delta + l.delta
    }),
    { expected: 0, actual: 0, delta: 0 }
  );
  const counts = {
    matched: lines.filter((l) => l.variance === "match").length,
    over: lines.filter((l) => l.variance === "over").length,
    short: lines.filter((l) => l.variance === "short").length,
    manuallyCorrected: lines.filter((l) => l.manuallyCorrected).length
  };
  return {
    lines,
    offOrder,
    totals,
    counts,
    isClean: counts.over === 0 && counts.short === 0 && offOrder.length === 0
  };
}
function checkCompletion(shipment, options = {}) {
  const open = deriveExceptions(shipment, options).filter(isExceptionOpen);
  const blockers = open.filter((e) => e.blocksCompletion);
  const warnings = open.filter((e) => !e.blocksCompletion);
  return {
    canComplete: blockers.length === 0,
    blockers,
    warnings,
    reason: blockers.length ? `${blockers.length} exception(s) must be resolved before completing.` : void 0
  };
}

// src/core/media.ts
var DEFAULT_PRESIGNED_TTL_MS = 30 * 60 * 1e3;
var PRESIGN_REFRESH_MARGIN_MS = 2 * 60 * 1e3;
function parsePresignedExpiry(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return void 0;
  }
  const params = parsed.searchParams;
  const amzDate = params.get("X-Amz-Date");
  const amzExpires = params.get("X-Amz-Expires");
  if (amzDate && amzExpires) {
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(amzDate);
    if (m) {
      const [, y, mo, d, h, mi, s] = m;
      const start = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
      const ttl = Number(amzExpires);
      if (Number.isFinite(ttl)) return new Date(start + ttl * 1e3);
    }
  }
  const expires = params.get("Expires");
  if (expires && /^\d+$/.test(expires)) return new Date(Number(expires) * 1e3);
  return void 0;
}
function getMediaExpiry(media, receivedAt, now = /* @__PURE__ */ new Date()) {
  if (!media?.url) return { expired: true, stale: true };
  const explicit = media.expires_at ? new Date(media.expires_at) : void 0;
  const parsed = explicit ?? parsePresignedExpiry(media.url);
  const assumed = receivedAt ? new Date(receivedAt.getTime() + DEFAULT_PRESIGNED_TTL_MS) : void 0;
  const expiresAt = parsed ?? assumed;
  if (!expiresAt || Number.isNaN(expiresAt.getTime())) {
    return { expired: false, stale: false };
  }
  const msRemaining = expiresAt.getTime() - now.getTime();
  return {
    expiresAt,
    msRemaining,
    expired: msRemaining <= 0,
    stale: msRemaining <= PRESIGN_REFRESH_MARGIN_MS
  };
}
function isMediaUrlExpired(media, receivedAt) {
  return getMediaExpiry(media, receivedAt).expired;
}
function flattenMedia(images) {
  return (images ?? []).map((image) => ({
    id: image.id,
    side: String(image.side),
    url: image.media?.url,
    filename: image.media?.filename ?? image.filepath,
    contentId: image.media?.content_id,
    mimeType: image.media?.mime_type,
    unitSessionId: image.shipment_unit_session_id,
    damageCount: image.damages?.length ?? 0
  }));
}
var SIDE_ORDER = [
  "front",
  "front_low",
  "front_high",
  "right",
  "right_low",
  "right_high",
  "back",
  "left",
  "left_low",
  "left_high",
  "top",
  "all"
];
function sortMediaBySide(items) {
  return [...items].sort((a, b) => {
    const ai = SIDE_ORDER.indexOf(a.side);
    const bi = SIDE_ORDER.indexOf(b.side);
    return (ai === -1 ? SIDE_ORDER.length : ai) - (bi === -1 ? SIDE_ORDER.length : bi);
  });
}

// src/core/barcode.ts
function createScanBuffer(options) {
  const gap = options.maxKeystrokeGapMs ?? 40;
  const minLength = options.minLength ?? 4;
  const terminator = options.terminator ?? "Enter";
  let chars = [];
  let lastAt = 0;
  const reset = () => {
    chars = [];
    lastAt = 0;
  };
  return {
    reset,
    handleKey(event) {
      const now = event.timeStamp || performance.now();
      const elapsed = now - lastAt;
      if (event.key === terminator) {
        const code = chars.join("");
        reset();
        if (code.length >= minLength) {
          options.onScan(code);
          return true;
        }
        return false;
      }
      if (event.key.length !== 1) {
        reset();
        return false;
      }
      if (lastAt !== 0 && elapsed > gap) chars = [];
      chars.push(event.key);
      lastAt = now;
      return chars.length > 1;
    }
  };
}
function parseScan(raw) {
  const trimmed = raw.trim();
  const upper = trimmed.toUpperCase();
  const digitsOnly = /^\d+$/.test(trimmed);
  const value = digitsOnly ? trimmed.replace(/^0+(?=\d)/, "") : upper;
  if (digitsOnly && (trimmed.length === 12 || trimmed.length === 13 || trimmed.length === 8)) {
    return {
      raw,
      value,
      kind: trimmed.length === 12 ? "upc" : "ean",
      checkDigitValid: validateGtinCheckDigit(trimmed)
    };
  }
  return { raw, value, kind: digitsOnly ? "unknown" : "code128" };
}
function validateGtinCheckDigit(code) {
  if (!/^\d+$/.test(code) || code.length < 8) return false;
  const digits = code.split("").map(Number);
  const check = digits.pop();
  const sum = digits.reverse().reduce((acc, digit, i) => acc + digit * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - sum % 10) % 10 === check;
}

export { ArvistClient, ArvistError, DEFAULT_ERROR_MESSAGES, DEFAULT_PRESIGNED_TTL_MS, InspectionFeed, PRESIGN_REFRESH_MARGIN_MS, buildBarcodeIndex, checkCompletion, createErrorMessageResolver, createScanBuffer, createSocketIoTransport, errorFromResponse, flattenMedia, getDisplayMessage, getLineItemBarcode, getMediaExpiry, isMediaUrlExpired, normalizeBarcode, parsePresignedExpiry, parseScan, reconcile, sortMediaBySide, topics, upcCoverage, validateGtinCheckDigit };
//# sourceMappingURL=chunk-C3LOARKS.js.map
//# sourceMappingURL=chunk-C3LOARKS.js.map