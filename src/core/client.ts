/**
 * REST client for the Arvist API.
 *
 * Built on `fetch` with no HTTP dependency, so it works in the browser, in
 * React Native, and on the server. Every failure is normalised to an
 * {@link ArvistError}.
 */

import { ArvistError, errorFromResponse, type ArvistErrorCode } from './errors';
import type {
  ActionResult,
  ListShipmentsQuery,
  Paginated,
  QualityStation,
  ResolveIssueByIdInput,
  ResolveIssueInput,
  Shipment,
  SubmitInspectionInput,
  ShipmentDetail,
  ShipmentImage,
  ShipmentIssue,
  StartInspectionInput,
  UpdateUnknownProductInput,
} from './types';

export interface ArvistClientConfig {
  /** API origin, e.g. `https://arvist.example.com`. The `/v1/api` prefix is added for you. */
  baseUrl: string;
  /**
   * Bearer token, or a function returning one. Use the function form for tokens
   * that rotate — it is awaited on every request.
   */
  token?: string | (() => string | Promise<string | undefined> | undefined);
  /**
   * Cloudflare Access service-token headers, when the deployment sits behind
   * Access. These authenticate the *device* at the edge and are independent of
   * the API token, which authenticates the caller.
   */
  cloudflareAccess?: { clientId: string; clientSecret: string };
  /** Send cookies. Enable when relying on an existing dashboard session. */
  credentials?: RequestCredentials;
  /** Default `site_id` applied to every request that accepts one. */
  siteId?: number;
  /** Per-request timeout. Defaults to 30s. */
  timeoutMs?: number;
  /** Retries for retryable failures (429, 5xx, network). Defaults to 2. */
  retries?: number;
  /** Extra headers on every request. */
  headers?: Record<string, string>;
  fetch?: typeof globalThis.fetch;
  /** Called for every request outcome — wire this to your logging. */
  onRequest?: (info: RequestTelemetry) => void;
}

export interface RequestTelemetry {
  method: string;
  path: string;
  status?: number;
  durationMs: number;
  attempt: number;
  error?: ArvistError;
}

export interface RequestOptions {
  signal?: AbortSignal;
  /** Overrides the client default for this call. */
  timeoutMs?: number;
  retries?: number;
  /**
   * Deduplicates retries of the same logical action. Two calls with the same
   * key inside the dedupe window resolve to the same result rather than
   * creating two records — which is what you want on a double barcode scan.
   */
  idempotencyKey?: string;
}

const API_PREFIX = '/v1/api';
const IDEMPOTENCY_WINDOW_MS = 10_000;

export class ArvistClient {
  private readonly config: ArvistClientConfig;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly inflight = new Map<string, { at: number; promise: Promise<unknown> }>();

  constructor(config: ArvistClientConfig) {
    if (!config.baseUrl) throw new Error('ArvistClient: baseUrl is required');
    this.config = config;
    this.fetchImpl = config.fetch ?? globalThis.fetch?.bind(globalThis);
    if (!this.fetchImpl) {
      throw new Error('ArvistClient: no fetch implementation available; pass one via config.fetch');
    }
  }

  // -------------------------------------------------------------------------
  // Quality stations
  // -------------------------------------------------------------------------

  /** Lists configured quality stations for the site. */
  listStations(params: { site_id?: number; id?: number } = {}, opts?: RequestOptions) {
    return this.request<QualityStation[]>('GET', '/locations/quality-stations', {
      query: params,
      ...opts,
    });
  }

  /**
   * Resolves a station name (e.g. `Z01-PS-001`) to its record.
   *
   * Upstream systems address stations by name while the realtime feed keys
   * per-unit topics on `area_id`, so most integrations need this lookup once at
   * startup.
   */
  async findStationByName(areaName: string, opts?: RequestOptions): Promise<QualityStation> {
    const stations = await this.listStations({}, opts);
    const needle = areaName.trim().toLowerCase();
    const match = stations.find(
      (s) => s.area_name?.trim().toLowerCase() === needle || s.name?.trim().toLowerCase() === needle,
    );
    if (!match) {
      throw new ArvistError({
        code: 'station_not_found',
        message: `No quality station is configured with the name "${areaName}".`,
        detail: { areaName, known: stations.map((s) => s.area_name ?? s.name) },
      });
    }
    return match;
  }

  // -------------------------------------------------------------------------
  // Shipments
  // -------------------------------------------------------------------------

  listShipments(query: ListShipmentsQuery = {}, opts?: RequestOptions) {
    return this.request<Paginated<Shipment>>('GET', '/quality/inspection/shipment', {
      query: query as Record<string, unknown>,
      ...opts,
    });
  }

  /**
   * A single shipment.
   *
   * The response is the shipment object itself — not wrapped — with live
   * `progress` and `inspection_state` folded in.
   */
  getShipment(id: number, opts?: RequestOptions) {
    return this.request<ShipmentDetail>('GET', `/quality/inspection/shipment/${id}`, opts);
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
  async startInspection(input: StartInspectionInput, opts?: RequestOptions): Promise<Shipment> {
    const body = await this.request<unknown>('POST', '/quality/inspection/shipment', {
      body: input,
      ...opts,
    });
    const shipment = pickShipment(body);
    if (!shipment) {
      throw new ArvistError({
        code: 'server_error',
        message: 'The inspection was started but the API did not return it.',
        detail: body,
      });
    }
    return shipment;
  }

  /** Marks an inspection finished — no further units are expected. */
  finishInspection(shipmentId: number, opts?: RequestOptions): Promise<ActionResult> {
    return this.action('POST', '/quality/inspection/shipment/finished', shipmentId, opts);
  }

  /**
   * Submits the inspection results. Call after {@link finishInspection}.
   *
   * Manual count corrections ride along here rather than being written as they
   * are made — there is no live endpoint for editing a line item's count. Pass
   * them as `line_items`, each with the existing line item's `id`.
   */
  async submitInspection(
    shipmentId: number,
    input: SubmitInspectionInput = {},
    opts?: RequestOptions,
  ): Promise<ActionResult> {
    const body = await this.request<unknown>('POST', '/quality/inspection/shipment/submit', {
      body: { shipment_id: shipmentId, ...input },
      ...opts,
    });
    return toActionResult(body);
  }

  cancelShipment(shipmentId: number, opts?: RequestOptions): Promise<ActionResult> {
    return this.action('POST', '/quality/inspection/shipment/cancel-shipment', shipmentId, opts);
  }

  async cancelUnit(
    shipmentId: number,
    unitId: string,
    opts?: RequestOptions,
  ): Promise<ActionResult> {
    const body = await this.request<unknown>('POST', '/quality/inspection/shipment/cancel-unit', {
      body: { shipment_id: shipmentId, unit_id: unitId },
      ...opts,
    });
    return toActionResult(body);
  }

  pauseShipment(shipmentId: number, opts?: RequestOptions): Promise<ActionResult> {
    return this.action('POST', '/quality/inspection/shipment/pause-shipment', shipmentId, opts);
  }

  resumeShipment(shipmentId: number, opts?: RequestOptions): Promise<ActionResult> {
    return this.action('POST', '/quality/inspection/shipment/resume-shipment', shipmentId, opts);
  }

  private async action(
    method: string,
    path: string,
    shipmentId: number,
    opts?: RequestOptions,
  ): Promise<ActionResult> {
    const body = await this.request<unknown>(method, path, {
      body: { shipment_id: shipmentId },
      ...opts,
    });
    return toActionResult(body);
  }

  // -------------------------------------------------------------------------
  // Exceptions
  // -------------------------------------------------------------------------

  listIssues(unitSessionId: number, opts?: RequestOptions) {
    return this.request<ShipmentIssue[]>(
      'GET',
      `/quality/inspection/shipment-issue/unit/${unitSessionId}`,
      opts,
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
  async resolveIssue(input: ResolveIssueInput, opts?: RequestOptions): Promise<ActionResult> {
    const { unit_session_id, ...body } = input;
    const result = await this.request<unknown>(
      'PUT',
      `/quality/inspection/shipment-issue/unit/${unit_session_id}`,
      { body, ...opts },
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
  async resolveIssueById(input: ResolveIssueByIdInput, opts?: RequestOptions): Promise<ActionResult> {
    const { issue_id, ...body } = input;
    const result = await this.request<unknown>(
      'PATCH',
      `/quality/inspection/shipment-issue/${issue_id}/resolve`,
      { body, ...opts },
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
  async updateUnknownProduct(
    input: UpdateUnknownProductInput,
    opts?: RequestOptions,
  ): Promise<ActionResult> {
    const result = await this.request<unknown>(
      'PUT',
      '/quality/inspection/shipment/unknown-product/update',
      { body: input, ...opts },
    );
    return toActionResult(result);
  }

  /** Supplies pallet identifiers that could not be read from the label. */
  async updatePalletIdentifier(
    body: { shipment_id: number; shipment_unit_id?: string; identifier: string; metadata?: Record<string, unknown> },
    opts?: RequestOptions,
  ): Promise<ActionResult> {
    const result = await this.request<unknown>(
      'PUT',
      '/quality/inspection/shipment/pallet-identifier',
      { body, ...opts },
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
  async getShipmentMedia(shipmentId: number, opts?: RequestOptions): Promise<ShipmentImage[]> {
    const shipment = await this.getShipment(shipmentId, opts);
    return (shipment.units ?? []).flatMap((u) =>
      (u.quality_sessions?.[0]?.images ?? []).map((img) => ({ ...img })),
    );
  }

  /** Presigned URL for a captured video clip. */
  getVideoUrl(contentId: string, opts?: RequestOptions) {
    return this.request<{ url: string }>(
      'GET',
      `/quality/inspection/shipment/video/presigned/${contentId}`,
      opts,
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
  async checkStationBinding(
    areaName: string,
    opts?: RequestOptions,
  ): Promise<{ station: QualityStation; hasOpenInspection: boolean; warning?: ArvistErrorCode }> {
    const station = await this.findStationByName(areaName, opts);
    const open = await this.listShipments(
      { areaName, status: 'in_progress', limit: 1 },
      opts,
    );
    return {
      station,
      hasOpenInspection: open.data.length > 0,
      warning: open.data.length > 0 ? 'shipment_already_open' : undefined,
    };
  }

  // -------------------------------------------------------------------------
  // Transport
  // -------------------------------------------------------------------------

  private async buildHeaders(hasBody: boolean): Promise<Headers> {
    const headers = new Headers(this.config.headers);
    if (hasBody) headers.set('content-type', 'application/json');
    headers.set('accept', 'application/json');

    const rawToken = this.config.token;
    const token = typeof rawToken === 'function' ? await rawToken() : rawToken;
    if (token) headers.set('authorization', `Bearer ${token}`);

    const cf = this.config.cloudflareAccess;
    if (cf) {
      headers.set('CF-Access-Client-Id', cf.clientId);
      headers.set('CF-Access-Client-Secret', cf.clientSecret);
    }
    return headers;
  }

  private buildUrl(path: string, query?: Record<string, unknown>): string {
    const base = this.config.baseUrl.replace(/\/+$/, '');
    const url = new URL(`${base}${API_PREFIX}${path}`);
    const merged: Record<string, unknown> = { ...query };
    if (this.config.siteId != null && merged['site_id'] == null) {
      merged['site_id'] = this.config.siteId;
    }
    for (const [key, value] of Object.entries(merged)) {
      if (value == null || value === '') continue;
      if (Array.isArray(value)) {
        for (const v of value) url.searchParams.append(key, String(v));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  /** Escape hatch for endpoints the SDK does not wrap yet. */
  async request<T>(
    method: string,
    path: string,
    options: RequestOptions & { query?: Record<string, unknown>; body?: unknown } = {},
  ): Promise<T> {
    const { idempotencyKey } = options;
    if (idempotencyKey) {
      const cached = this.inflight.get(idempotencyKey);
      if (cached && Date.now() - cached.at < IDEMPOTENCY_WINDOW_MS) {
        return cached.promise as Promise<T>;
      }
    }

    const promise = this.execute<T>(method, path, options);
    if (idempotencyKey) {
      this.inflight.set(idempotencyKey, { at: Date.now(), promise });
      promise.catch(() => this.inflight.delete(idempotencyKey));
    }
    return promise;
  }

  private async execute<T>(
    method: string,
    path: string,
    options: RequestOptions & { query?: Record<string, unknown>; body?: unknown },
  ): Promise<T> {
    const maxRetries = options.retries ?? this.config.retries ?? 2;
    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs ?? 30_000;
    const url = this.buildUrl(path, options.query);
    const hasBody = options.body !== undefined;

    // The API accepts site_id in the body on writes; mirror the default there.
    let body = options.body;
    if (hasBody && this.config.siteId != null && isPlainObject(body) && body['site_id'] == null) {
      body = { ...body, site_id: this.config.siteId };
    }

    let lastError: ArvistError | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const startedAt = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const onAbort = () => controller.abort();
      options.signal?.addEventListener('abort', onAbort, { once: true });

      try {
        const response = await this.fetchImpl(url, {
          method,
          headers: await this.buildHeaders(hasBody),
          body: hasBody ? JSON.stringify(body) : undefined,
          credentials: this.config.credentials,
          signal: controller.signal,
        });

        const requestId = response.headers.get('x-request-id') ?? undefined;
        const payload = await parseBody(response);

        if (!response.ok) {
          const error = errorFromResponse(response.status, payload, requestId);
          this.config.onRequest?.({
            method, path, status: response.status,
            durationMs: Date.now() - startedAt, attempt, error,
          });
          if (error.retryable && attempt < maxRetries) {
            lastError = error;
            await backoff(attempt);
            continue;
          }
          throw error;
        }

        this.config.onRequest?.({
          method, path, status: response.status,
          durationMs: Date.now() - startedAt, attempt,
        });
        return payload as T;
      } catch (err) {
        if (ArvistError.is(err)) throw err;

        const aborted = options.signal?.aborted === true;
        const error = new ArvistError({
          code: aborted ? 'unknown' : controller.signal.aborted ? 'timeout' : 'network_error',
          message: aborted ? 'Request cancelled.' : 'Could not reach Arvist.',
          retryable: !aborted,
          cause: err,
        });
        this.config.onRequest?.({
          method, path, durationMs: Date.now() - startedAt, attempt, error,
        });
        if (error.retryable && attempt < maxRetries) {
          lastError = error;
          await backoff(attempt);
          continue;
        }
        throw error;
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
      }
    }

    throw lastError ?? new ArvistError({ code: 'unknown', message: 'Request failed.' });
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

async function parseBody(response: Response): Promise<unknown> {
  const type = response.headers.get('content-type') ?? '';
  if (response.status === 204) return undefined;
  if (type.includes('application/json')) {
    return response.json().catch(() => undefined);
  }
  return response.text().catch(() => undefined);
}

/**
 * Envelope handling.
 *
 * The API is not uniform about this: reads return their payload bare, writes
 * return either a plain string, `{ message, shipment }`, or `{ message, data }`
 * depending on the endpoint. Rather than guess from the shape at runtime — which
 * silently mangles a response the moment a new endpoint picks a different
 * convention — each method states the envelope it expects and these two helpers
 * flatten it into something predictable.
 */
function pickShipment(body: unknown): Shipment | undefined {
  if (!isPlainObject(body)) return undefined;
  for (const key of ['shipment', 'data']) {
    const value = body[key];
    if (isPlainObject(value) && typeof value['id'] === 'number') return value as unknown as Shipment;
  }
  return typeof body['id'] === 'number' ? (body as unknown as Shipment) : undefined;
}

function toActionResult(body: unknown): ActionResult {
  if (typeof body === 'string') return { message: body, raw: body };
  if (isPlainObject(body)) {
    const message = typeof body['message'] === 'string' ? body['message'] : 'OK';
    const shipment = pickShipment(body);
    return shipment ? { message, shipment, raw: body } : { message, raw: body };
  }
  return { message: 'OK', raw: body };
}

function backoff(attempt: number): Promise<void> {
  const base = Math.min(1000 * 2 ** attempt, 8000);
  const jitter = Math.random() * 250;
  return new Promise((resolve) => setTimeout(resolve, base + jitter));
}
