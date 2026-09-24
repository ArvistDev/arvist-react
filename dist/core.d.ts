import { A as ArvistError, Q as QualityStation, G as ListShipmentsQuery, O as Paginated, S as Shipment, a0 as ShipmentDetail, c as StartInspectionInput, l as ActionResult, ab as SubmitInspectionInput, a1 as ShipmentIssue, Y as ResolveIssueInput, X as ResolveIssueByIdInput, ad as UpdateUnknownProductInput, k as ShipmentImage, h as ArvistErrorCode } from './media-DnQFgvEV.js';
export { m as ArvistErrorInit, a as CompletionCheck, C as ConnectionState, D as DEFAULT_ERROR_MESSAGES, n as DEFAULT_EXCEPTION_COPY, o as DEFAULT_PRESIGNED_TTL_MS, p as DeriveOptions, q as DetectionAnnotation, E as ErrorMessageResolver, e as ExceptionCopy, r as ExceptionSeverity, j as ExceptionType, s as FeedBinding, F as FlatMediaItem, t as ISSUE_ACTION_BY_RESOLUTION, I as InspectionEvent, u as InspectionEventKind, d as InspectionFeed, v as InspectionFeedOptions, w as IssueResolveAction, x as IssueStatus, y as IssueType, b as LineItem, L as LineItemCorrection, z as LineItemInput, B as LineVariance, M as MediaExpiry, H as MediaRef, N as NormalizedException, J as PALLET_ONLY_EXCEPTIONS, K as PRESIGN_REFRESH_MARGIN_MS, P as PartialExceptionCopy, T as QualityStationType, U as RealtimeIssue, g as RealtimeTransport, V as ReconciledLine, R as Reconciliation, W as ResolutionAction, i as ResolutionOption, Z as SENTINEL_SKUS, _ as SentinelSku, $ as ShipmentDamage, a2 as ShipmentPalletIdentifier, a3 as ShipmentSide, a4 as ShipmentStatus, a5 as ShipmentType, a6 as ShipmentUnit, a7 as ShipmentUnitSession, a8 as ShipmentUnitType, f as SocketIoFactory, a9 as SocketIoTransportConfig, aa as SocketLike, ac as UnitPayload, ae as buildBarcodeIndex, af as checkCompletion, ag as collectIssues, ah as createErrorMessageResolver, ai as createSocketIoTransport, aj as deriveExceptions, ak as errorFromResponse, al as flattenMedia, am as getDisplayMessage, an as getLineItemBarcode, ao as getMediaExpiry, ap as isExceptionOpen, aq as isMediaUrlExpired, ar as isSentinelLineItem, as as mergeRealtimeIssues, at as normalizeBarcode, au as orderedLineItems, av as parsePresignedExpiry, aw as reconcile, ax as resolutionsFor, ay as sortMediaBySide, az as topics, aA as upcCoverage } from './media-DnQFgvEV.js';

/**
 * REST client for the Arvist API.
 *
 * Built on `fetch` with no HTTP dependency, so it works in the browser, in
 * React Native, and on the server. Every failure is normalised to an
 * {@link ArvistError}.
 */

interface ArvistClientConfig {
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
    cloudflareAccess?: {
        clientId: string;
        clientSecret: string;
    };
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
interface RequestTelemetry {
    method: string;
    path: string;
    status?: number;
    durationMs: number;
    attempt: number;
    error?: ArvistError;
}
interface RequestOptions {
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
declare class ArvistClient {
    private readonly config;
    private readonly fetchImpl;
    private readonly inflight;
    constructor(config: ArvistClientConfig);
    /** Lists configured quality stations for the site. */
    listStations(params?: {
        site_id?: number;
        id?: number;
    }, opts?: RequestOptions): Promise<QualityStation[]>;
    /**
     * Resolves a station name (e.g. `Z01-PS-001`) to its record.
     *
     * Upstream systems address stations by name while the realtime feed keys
     * per-unit topics on `area_id`, so most integrations need this lookup once at
     * startup.
     */
    findStationByName(areaName: string, opts?: RequestOptions): Promise<QualityStation>;
    listShipments(query?: ListShipmentsQuery, opts?: RequestOptions): Promise<Paginated<Shipment>>;
    /**
     * A single shipment.
     *
     * The response is the shipment object itself — not wrapped — with live
     * `progress` and `inspection_state` folded in.
     */
    getShipment(id: number, opts?: RequestOptions): Promise<ShipmentDetail>;
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
    startInspection(input: StartInspectionInput, opts?: RequestOptions): Promise<Shipment>;
    /** Marks an inspection finished — no further units are expected. */
    finishInspection(shipmentId: number, opts?: RequestOptions): Promise<ActionResult>;
    /**
     * Submits the inspection results. Call after {@link finishInspection}.
     *
     * Manual count corrections ride along here rather than being written as they
     * are made — there is no live endpoint for editing a line item's count. Pass
     * them as `line_items`, each with the existing line item's `id`.
     */
    submitInspection(shipmentId: number, input?: SubmitInspectionInput, opts?: RequestOptions): Promise<ActionResult>;
    cancelShipment(shipmentId: number, opts?: RequestOptions): Promise<ActionResult>;
    cancelUnit(shipmentId: number, unitId: string, opts?: RequestOptions): Promise<ActionResult>;
    pauseShipment(shipmentId: number, opts?: RequestOptions): Promise<ActionResult>;
    resumeShipment(shipmentId: number, opts?: RequestOptions): Promise<ActionResult>;
    private action;
    listIssues(unitSessionId: number, opts?: RequestOptions): Promise<ShipmentIssue[]>;
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
    resolveIssue(input: ResolveIssueInput, opts?: RequestOptions): Promise<ActionResult>;
    /**
     * Resolves one issue by id via a keyword `action`.
     *
     * The modern per-instance resolve path for `unidentified_product`,
     * `wrong_product`, `overage`, and `shortage` issues. Each action is valid
     * for a specific set of issue types and origin statuses — the API 400s if
     * the pairing doesn't match; see {@link IssueResolveAction}.
     */
    resolveIssueById(input: ResolveIssueByIdInput, opts?: RequestOptions): Promise<ActionResult>;
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
    updateUnknownProduct(input: UpdateUnknownProductInput, opts?: RequestOptions): Promise<ActionResult>;
    /** Supplies pallet identifiers that could not be read from the label. */
    updatePalletIdentifier(body: {
        shipment_id: number;
        shipment_unit_id?: string;
        identifier: string;
        metadata?: Record<string, unknown>;
    }, opts?: RequestOptions): Promise<ActionResult>;
    /**
     * Images for a shipment, as presigned URLs.
     *
     * The URLs are short-lived — copy anything you need to retain to your own
     * storage on receipt rather than storing the URL.
     */
    getShipmentMedia(shipmentId: number, opts?: RequestOptions): Promise<ShipmentImage[]>;
    /** Presigned URL for a captured video clip. */
    getVideoUrl(contentId: string, opts?: RequestOptions): Promise<{
        url: string;
    }>;
    /**
     * Checks that a station exists and that something is listening on it.
     *
     * An inspection opens on whichever screen has the station selected. If none
     * does, `startInspection` still returns 200 and the inspection sits unopened
     * — the most common "station not responding" report. Call this before or
     * alongside a start to surface that as a real condition rather than silence.
     */
    checkStationBinding(areaName: string, opts?: RequestOptions): Promise<{
        station: QualityStation;
        hasOpenInspection: boolean;
        warning?: ArvistErrorCode;
    }>;
    private buildHeaders;
    private buildUrl;
    /** Escape hatch for endpoints the SDK does not wrap yet. */
    request<T>(method: string, path: string, options?: RequestOptions & {
        query?: Record<string, unknown>;
        body?: unknown;
    }): Promise<T>;
    private execute;
}

/**
 * Wedge-scanner input handling.
 *
 * Handheld scanners type their payload as fast keystrokes ending in Enter, and
 * a packstation screen has to tell that apart from an operator typing into a
 * field. The discriminator is inter-keystroke timing: scanner bursts land far
 * faster than any human types.
 */
interface ScanBufferOptions {
    /**
     * Maximum gap between keystrokes for them to count as one scan. Handhelds
     * emit well under 30ms; humans rarely go under 50ms sustained. Defaults to 40.
     */
    maxKeystrokeGapMs?: number;
    /** Shortest accepted payload. Filters stray Enter presses. Defaults to 4. */
    minLength?: number;
    /** Key that terminates a scan. Defaults to `Enter`. */
    terminator?: string;
    /** Called with the completed payload. */
    onScan: (code: string) => void;
}
interface ScanBuffer {
    /** Feed every `keydown`. Returns `true` when the event was consumed as scanner input. */
    handleKey(event: Pick<KeyboardEvent, 'key' | 'timeStamp'>): boolean;
    reset(): void;
}
/**
 * Accumulates keystrokes into scans.
 *
 * Returns `true` from `handleKey` when the keystroke belonged to a scan, so the
 * caller can `preventDefault()` and keep scanner output out of focused inputs.
 */
declare function createScanBuffer(options: ScanBufferOptions): ScanBuffer;
type ScanKind = 'upc' | 'ean' | 'code128' | 'unknown';
interface ParsedScan {
    raw: string;
    /** Normalised for lookup — trimmed, upper-cased, leading zeros stripped. */
    value: string;
    kind: ScanKind;
    /** `true` when the check digit validates. `undefined` for formats without one. */
    checkDigitValid?: boolean;
}
/** Classifies a scan and validates its check digit where the format has one. */
declare function parseScan(raw: string): ParsedScan;
/** Modulo-10 check digit shared by UPC-A, EAN-8 and EAN-13. */
declare function validateGtinCheckDigit(code: string): boolean;

export { ActionResult, ArvistClient, type ArvistClientConfig, ArvistError, ArvistErrorCode, ListShipmentsQuery, Paginated, type ParsedScan, QualityStation, type RequestOptions, type RequestTelemetry, ResolveIssueByIdInput, ResolveIssueInput, type ScanBuffer, type ScanBufferOptions, type ScanKind, Shipment, ShipmentDetail, ShipmentImage, ShipmentIssue, StartInspectionInput, SubmitInspectionInput, UpdateUnknownProductInput, createScanBuffer, parseScan, validateGtinCheckDigit };
