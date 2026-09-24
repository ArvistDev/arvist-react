/**
 * Wire types for the Arvist public API (`/v1/api/`).
 *
 * These mirror the documented REST responses. Fields the API may omit are
 * optional here rather than defaulted, so you can tell "absent" from "empty".
 */
type ShipmentType = 'inbound' | 'outbound';
type ShipmentStatus = 'pending' | 'in_progress' | 'review' | 'completed' | 'canceled';
type ShipmentUnitType = 'pallet' | 'product';
/**
 * Sentinel SKUs the API uses for line items that were counted but could not be
 * matched to the order. They are not real products — treat them as exceptions,
 * never as inventory.
 *
 * - `unknown` — an item was detected but no identifier could be read.
 * - `wrong`   — an identifier was read and it is not on this order.
 */
declare const SENTINEL_SKUS: readonly ["unknown", "wrong"];
type SentinelSku = (typeof SENTINEL_SKUS)[number];
interface LineItem {
    id?: number;
    name: string;
    /** Real SKU, or one of {@link SENTINEL_SKUS} for off-order items. */
    sku: string;
    line_no?: string;
    product_id: string | number;
    inventory_item_id?: string;
    expected_quantity: number;
    /** Counted quantity. Compare against `expected_quantity` to reconcile. */
    actual_quantity: number;
    quantity?: number;
    /** `true` when an operator overrode the counted quantity by hand. */
    is_edited?: boolean;
    /**
     * Integration-supplied passthrough. `upc` is the conventional key for barcode
     * matching; see {@link getLineItemBarcode} for the documented fallback order.
     */
    additional_data?: Record<string, unknown> | null;
    /**
     * The line item's own open `overage`/`shortage` issue, when one exists.
     * Session-less — at most one open row per line item — unlike the per-unit
     * issues on {@link ShipmentUnitSession.issues}. `null`/absent means no open
     * aggregate issue, not that the count reconciles.
     */
    issue?: ShipmentIssue | null;
}
interface Shipment {
    id: number;
    /** Stable join key across REST and the realtime feed. */
    shipment_key: string;
    type: ShipmentType | string;
    status: ShipmentStatus | string;
    site_id: number;
    location_id?: number;
    location_name?: string;
    confidence: number | null;
    order_numbers: string[];
    supplier: string;
    created_at: string;
    updated_at: string;
    units?: ShipmentUnit[];
    line_items: LineItem[];
    pallet_identifiers?: ShipmentPalletIdentifier[];
    quality_station?: QualityStation | null;
    additional_data?: Record<string, unknown> | null;
}
interface ShipmentUnit {
    id: string;
    shipment_id: number;
    type: ShipmentUnitType | null;
    created_at: string;
    updated_at: string;
    /** Ordered newest-first. Index 0 is the current session for the unit. */
    quality_sessions?: ShipmentUnitSession[];
}
interface ShipmentUnitSession {
    id: number;
    shipment_unit_id: string;
    created_at: string;
    updated_at: string;
    images?: ShipmentImage[];
    issues?: ShipmentIssue[];
}
interface ShipmentPalletIdentifier {
    id: number;
    identifier: string;
    is_tracked: boolean;
    tracked_at: string | null;
    metadata?: Record<string, unknown>;
    shipment_unit_id: string | null;
}
/**
 * Issue categories the API persists.
 *
 * `damage`/`wrong_load`/`no_identifiers` are session-scoped singletons — at
 * most one open row per unit session — and resolve through
 * {@link ArvistClient.resolveIssue}. `unidentified_product`/`wrong_product`
 * are per-instance: a session can hold several rows of the same type, one per
 * detected annotation. `overage`/`shortage` are session-less, one open row per
 * line item (`LineItem.issue`). The latter four resolve through
 * {@link ArvistClient.resolveIssueById}. Use {@link deriveExceptions} to get
 * the full operator-facing picture regardless of which shape a type uses.
 */
type IssueType = 'damage' | 'unidentified_product' | 'wrong_load' | 'no_identifiers' | 'wrong_product' | 'overage' | 'shortage';
type IssueStatus = 'open' | 'resolved' | 'canceled' | 'unresolved' | 'false_positive';
interface ShipmentIssue {
    id: number;
    issue_type: IssueType;
    status: IssueStatus;
    description?: string;
    metadata?: Record<string, unknown>;
    created_at: string;
    updated_at: string;
    resolved_at?: string;
    /**
     * The line item this issue resolves onto. Always set for a session-less
     * `overage`/`shortage` row (it's how the row is scoped to a line item in the
     * first place); set on other types once a resolution assigns one (e.g.
     * `assign`/`correct_product`).
     */
    shipment_data_id?: number;
    /** Attached by the SDK when an issue is read through a unit. */
    unit_id?: string;
    /** Attached by the SDK so a resolution can be routed without a second lookup. */
    unit_session_id?: number;
}
type ShipmentSide = 'front' | 'back' | 'left' | 'right' | 'top' | 'all' | 'left_low' | 'left_high' | 'right_low' | 'right_high' | 'front_low' | 'front_high';
interface ShipmentImage {
    id: number;
    side: ShipmentSide | string;
    filepath?: string;
    shipment_unit_session_id: number;
    media?: MediaRef;
    damages?: ShipmentDamage[];
}
interface MediaRef {
    id?: number;
    content_id?: string;
    filename?: string;
    mime_type?: string;
    /** Presigned and short-lived. See {@link isMediaUrlExpired}. */
    url?: string;
    /** ISO timestamp the presigned URL stops working, when the API supplies one. */
    expires_at?: string;
}
interface ShipmentDamage {
    id: number;
    type: string;
    category: string;
    category_type: string;
    description: string;
    damaged_box_qty: number | null;
    created_at: string;
}
type QualityStationType = 'turntable' | 'stationary' | 'conveyor_belt' | 'mobile_device' | 'packing_table';
interface QualityStation {
    id: number;
    name: string;
    /** Numeric id. Realtime topics for per-unit events are keyed on this. */
    area_id: number;
    /**
     * Human-readable station name (e.g. `Z01-PS-001`). This is what upstream
     * systems send when starting an inspection, and what the `start` realtime
     * topic is keyed on.
     */
    area_name?: string;
    type?: QualityStationType | string;
    station_configuration?: string;
    location?: string | null;
    inspection_types?: {
        id: number;
        name: string;
        description?: string | null;
    }[];
    inspection_configuration_id?: number | null;
    additional_configurations?: Record<string, unknown> | null;
}
interface StartInspectionInput {
    /** Existing shipment id. Omit when creating from `order_numbers`. */
    id?: number;
    /** Station name, e.g. `Z01-PS-001`. Provide this or `area_id`. */
    area_name?: string;
    area_id?: number;
    order_numbers?: string[];
    shipment_key?: string;
    type?: ShipmentType;
    supplier?: string;
    pallet_identifiers?: string[];
    line_items?: LineItemInput[];
    shipment_label_id?: number;
    site_id?: number;
}
interface LineItemInput {
    name: string;
    sku: string;
    product_id: string | number;
    expected_quantity: number;
    line_no?: string;
    inventory_item_id?: string;
    /** Put the scannable barcode at `additional_data.upc`. */
    additional_data?: Record<string, unknown> | null;
}
interface ListShipmentsQuery {
    page?: number;
    limit?: number;
    startDate?: string;
    endDate?: string;
    dateDays?: string[];
    status?: string;
    type?: ShipmentType;
    supplier?: string;
    searchTerm?: string;
    orderNumbers?: string[];
    areaId?: number;
    areaName?: string;
    orderBy?: string;
    orderDirection?: 'asc' | 'desc';
    site_id?: number;
}
/**
 * A single shipment as `GET /shipment/:id` returns it — the shipment object
 * itself, with live inspection state folded in.
 */
interface ShipmentDetail extends Shipment {
    /** 0-1, or null when the total is not yet known. */
    progress?: number | null;
    inspection_state?: string | null;
}
/**
 * The result of a write.
 *
 * Endpoints differ in what they return - a bare string, `{ message }`, or a
 * message plus the updated shipment - so the client flattens them all to this.
 * `shipment` is present whenever the API sent one back, which saves a re-fetch.
 */
interface ActionResult {
    message: string;
    shipment?: Shipment;
    /**
     * Set when `finishInspection` was rejected because open shortages exist.
     * The API runs its shortage check there (`detectShortages`) rather than
     * continuously during counting, so this is the point those issue rows
     * actually get created — `shortage_issues` reflects the real, freshly
     * created rows, not a client-side guess.
     */
    blocked_by?: 'shortage';
    /** The shortage issues that blocked completion, when `blocked_by` is set. */
    shortage_issues?: ShipmentIssue[];
    /** The unflattened body, for logging or an endpoint the SDK does not model. */
    raw?: unknown;
}
interface Paginated<T> {
    data: T[];
    total: number;
    page: number;
    limit: number;
}
/**
 * A detection annotation, as carried on the shipment's detection data.
 *
 * Reclassifying an unidentified item works on the annotation, not the line
 * item: `category_id` is either the id of the line item the item really is,
 * or the string `'remove'` to drop it from the count entirely.
 */
interface DetectionAnnotation {
    id: number;
    image_id?: number;
    /** Target line-item id, or `'remove'`. */
    category_id: number | 'remove';
    /**
     * Product identifiers read from the item. Setting any non-quantity key here
     * marks the item as belonging to another order rather than this one.
     */
    identifiers?: Record<string, string | number | null> & {
        items_quantity?: number;
    };
    bbox?: number[];
    [key: string]: unknown;
}
interface UpdateUnknownProductInput {
    shipment_id: number;
    /** Image the annotation sits on. */
    image_id: number;
    annotation: DetectionAnnotation;
}
/**
 * Line-item count correction.
 *
 * Corrections are not written as they are made — they are submitted together
 * with the inspection, so `id` must be the existing line item's id.
 */
interface LineItemCorrection {
    id: number;
    actual_quantity: number;
    /** Marks the count as operator-set rather than machine-counted. */
    is_edited: boolean;
}
interface SubmitInspectionInput {
    /** Staged count corrections, applied as part of the submission. */
    line_items?: LineItemCorrection[];
    type?: ShipmentType;
    location_key?: string;
    shipment_key?: string;
}
/**
 * `damage`/`wrong_load`/`no_identifiers` only — a raw status write, keyed by
 * unit session and type. `unidentified_product`/`wrong_product`/`overage`/
 * `shortage` resolve through {@link ResolveIssueByIdInput} instead: those are
 * per-instance or session-less, so "by type" no longer identifies one row.
 */
interface ResolveIssueInput {
    unit_session_id: number;
    issue_type: IssueType;
    status: IssueStatus;
    /** Required by convention when `status` is `unresolved` — why it could not be closed. */
    reason?: string;
    metadata?: Record<string, unknown>;
    site_id?: number;
}
/**
 * Keyword actions for {@link ArvistClient.resolveIssueById}, one union member
 * per action the API accepts. Each is valid for a specific set of issue types
 * and origin statuses — the API 400s on a mismatch — mirrored in
 * {@link import('./exceptions').resolutionsFor}, which only ever offers an
 * action for the exception type it actually applies to.
 *
 * For `unidentified_product`/`wrong_product`, `annotation_id` is the
 * annotation the issue row already pins (`issue.metadata.annotation_id`) —
 * required by the API as a check against stale data, but the SDK fills it in
 * from the issue itself; callers only supply the fields the issue doesn't
 * already know (`sku`). `overage` issues are session-less and can have several
 * candidate annotations on the same line item, so `reassign` needs the caller
 * to pick one explicitly.
 */
type IssueResolveAction = 
/** `unidentified_product` (open/false_positive) → resolved. */
{
    action: 'assign';
    annotation_id: number;
    sku: string;
}
/** `unidentified_product` (open) → false_positive: the detection itself was noise. */
 | {
    action: 'invalid';
    annotation_id: number;
}
/** `wrong_product`/`unidentified_product` (open) → resolved: kept and shipped as-is. */
 | {
    action: 'keep_in_order';
    annotation_id: number;
    sku?: string;
}
/** `wrong_product` (open) → false_positive: the wrong_product call itself was wrong. */
 | {
    action: 'correct_product';
    annotation_id: number;
    sku: string;
}
/** `wrong_product`/`unidentified_product` (open) → resolved: physically pulled. */
 | {
    action: 'remove_product';
    annotation_id: number;
    sku?: string;
}
/** `overage` (open) → resolved: the extra units were physically removed. */
 | {
    action: 'remove_extra';
}
/**
 * `overage` (open) → false_positive: one detected instance belongs to a
 * different sku. `annotation_id` picks which detected instance on the line
 * item is being reassigned — the issue itself does not pin one.
 */
 | {
    action: 'reassign';
    annotation_id: number;
    target_sku: string;
}
/** `shortage` (open) → resolved: the missing units were located and re-counted. */
 | {
    action: 'missing_added';
}
/** `shortage` (open) → false_positive: the expected count itself was wrong. */
 | {
    action: 'wrong_counting';
    corrected_quantity: number;
};
type ResolveIssueByIdInput = {
    issue_id: number;
    site_id?: number;
} & IssueResolveAction;

/**
 * Error normalisation.
 *
 * The API returns errors in a few shapes depending on which layer rejected the
 * request (edge, auth middleware, controller). Everything the SDK throws is an
 * {@link ArvistError} with a stable `code`, so integrators can branch on the
 * code and show `message` to an operator without parsing strings.
 */
type ArvistErrorCode = 'network_error' | 'timeout' | 'edge_forbidden' | 'unauthorized' | 'forbidden' | 'bad_request' | 'not_found' | 'conflict' | 'rate_limited' | 'validation_failed' | 'station_not_found' | 'station_not_bound' | 'shipment_not_found' | 'shipment_already_open' | 'completion_blocked' | 'issue_not_found' | 'server_error' | 'unknown';
interface ArvistErrorInit {
    code: ArvistErrorCode;
    message: string;
    status?: number;
    /** Raw body the API returned, for logging. Never render this to operators. */
    detail?: unknown;
    requestId?: string;
    /** `true` when retrying the identical request could plausibly succeed. */
    retryable?: boolean;
    cause?: unknown;
}
declare class ArvistError extends Error {
    readonly code: ArvistErrorCode;
    readonly status?: number;
    readonly detail?: unknown;
    readonly requestId?: string;
    readonly retryable: boolean;
    constructor(init: ArvistErrorInit);
    static is(err: unknown): err is ArvistError;
}
/**
 * Operator-facing copy for each error code.
 *
 * These are deliberately plain and actionable — they are written to be shown on
 * a packstation screen, not to a developer. Override any of them via
 * `errorMessages` on the client config, or localise with
 * {@link createErrorMessageResolver}.
 */
declare const DEFAULT_ERROR_MESSAGES: Record<ArvistErrorCode, string>;
type ErrorMessageResolver = (code: ArvistErrorCode, fallback: string) => string;
/** Builds a resolver from a partial override map, falling back to the defaults. */
declare function createErrorMessageResolver(overrides?: Partial<Record<ArvistErrorCode, string>>): ErrorMessageResolver;
/** Copy for a caught error. Safe to call with anything, including non-Errors. */
declare function getDisplayMessage(err: unknown, resolve?: ErrorMessageResolver): string;
/** Maps an HTTP response (plus its parsed body) onto an {@link ArvistError}. */
declare function errorFromResponse(status: number, body: unknown, requestId?: string): ArvistError;

/**
 * Realtime inspection feed.
 *
 * The API publishes inspection activity on a socket channel where each topic is
 * keyed by the thing it concerns — station name for starts, station id for
 * per-unit activity, shipment id for lifecycle changes. Subscribing correctly
 * means knowing which key goes with which topic and re-subscribing when the
 * shipment in progress changes.
 *
 * {@link InspectionFeed} does that bookkeeping and emits one typed event union.
 * The transport is pluggable — {@link createSocketIoTransport} ships in the box,
 * and any other duplex channel can be adapted by implementing
 * {@link RealtimeTransport}.
 */

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed';
interface RealtimeTransport {
    connect(): void;
    close(): void;
    on(topic: string, handler: (payload: unknown) => void): void;
    off(topic: string, handler?: (payload: unknown) => void): void;
    onStateChange(handler: (state: ConnectionState, error?: Error) => void): () => void;
    readonly state: ConnectionState;
}
interface SocketIoTransportConfig {
    url: string;
    /** Defaults to `/socket.io`. */
    path?: string;
    auth?: Record<string, unknown>;
    extraHeaders?: Record<string, string>;
    withCredentials?: boolean;
    /**
     * `socket.io-client`'s `io` function. Pass it explicitly to keep the SDK's
     * dependency on socket.io optional and avoid bundler resolution surprises:
     *
     * ```ts
     * import { io } from 'socket.io-client';
     * createSocketIoTransport({ url, io });
     * ```
     */
    io: SocketIoFactory;
}
/** Structural type for `socket.io-client`'s `io`, so it is not a hard dependency. */
type SocketIoFactory = (url: string, opts?: Record<string, unknown>) => SocketLike;
interface SocketLike {
    connected: boolean;
    connect(): void;
    disconnect(): void;
    on(event: string, handler: (...args: unknown[]) => void): void;
    off(event: string, handler?: (...args: unknown[]) => void): void;
}
declare function createSocketIoTransport(config: SocketIoTransportConfig): RealtimeTransport;
/**
 * Topic names, with the key each one is scoped by. Getting the key wrong is a
 * silent failure — you subscribe successfully and never receive anything — so
 * these are centralised rather than interpolated at call sites.
 */
declare const topics: {
    /** Global. Every shipment lifecycle transition. */
    readonly update: () => string;
    /** Keyed by station *name*, because that is what upstream systems address. */
    readonly start: (areaName: string) => string;
    /** Keyed by station *id*. */
    readonly unitProcessing: (areaId: number) => string;
    readonly unitCompleted: (areaId: number) => string;
    readonly damagesDetected: (areaId: number) => string;
    readonly stationStateChange: (areaId: number) => string;
    /** Keyed by shipment id. */
    readonly shipmentStateChange: (shipmentId: number) => string;
    readonly error: (shipmentId: number) => string;
    readonly complete: (shipmentId: number) => string;
};
interface RealtimeIssue {
    type: IssueType;
    status?: string;
    description?: string;
    metadata?: Record<string, unknown>;
}
interface UnitPayload {
    shipment_id: number;
    unit_id?: string;
    unit_session_id?: number;
    increment_by?: number;
    images?: unknown[];
    issues?: RealtimeIssue[];
    identifiers?: {
        order_numbers?: string[];
        total_pallets?: number;
        [k: string]: unknown;
    };
    [k: string]: unknown;
}
type InspectionEvent = 
/** An inspection opened at this station. */
{
    kind: 'started';
    shipment: Shipment;
    raw: unknown;
}
/** A unit is being captured. Images are arriving; counts are not final. */
 | {
    kind: 'unit-processing';
    payload: UnitPayload;
    raw: unknown;
}
/**
 * A unit finished. `issues` is the authoritative state for that unit —
 * replace rather than append. Empty means the unit was clean.
 */
 | {
    kind: 'unit-completed';
    payload: UnitPayload;
    issues: RealtimeIssue[];
    raw: unknown;
}
/** Damage findings for a unit, which may arrive after `unit-completed`. */
 | {
    kind: 'damages-detected';
    payload: UnitPayload;
    raw: unknown;
}
/** Lifecycle transition. `progress` is 0–1, or null when not applicable. */
 | {
    kind: 'status';
    shipmentId: number;
    status: ShipmentStatus | string;
    progress: number | null;
    raw: unknown;
}
/** Paused or resumed, manually or by inactivity. */
 | {
    kind: 'state-change';
    scope: 'shipment' | 'station';
    payload: UnitPayload;
    raw: unknown;
}
/** Final counts. This is the one to reconcile against. */
 | {
    kind: 'completed';
    shipmentId: number;
    raw: unknown;
} | {
    kind: 'canceled';
    shipmentId: number;
    raw: unknown;
} | {
    kind: 'error';
    shipmentId: number;
    message?: string;
    raw: unknown;
};
type InspectionEventKind = InspectionEvent['kind'];
interface FeedBinding {
    /** Station name — required for `started`. */
    areaName?: string;
    /** Station id — required for every per-unit event. */
    areaId?: number;
    /** Shipment id — required for per-shipment lifecycle events. Set as it changes. */
    shipmentId?: number;
}
interface InspectionFeedOptions {
    transport: RealtimeTransport;
    /**
     * Events received before any listener attaches are buffered and replayed to
     * the first listener. Prevents losing the `started` event to a React mount
     * race. Defaults to 50; set 0 to disable.
     */
    bufferSize?: number;
    onError?: (error: Error) => void;
}
type Listener = (event: InspectionEvent) => void;
/**
 * Subscribes to the topics a station needs and emits {@link InspectionEvent}.
 *
 * Rebinding is cheap: call {@link InspectionFeed.bind} whenever the station or
 * the shipment in progress changes and it diffs the subscriptions for you.
 */
declare class InspectionFeed {
    private readonly transport;
    private readonly listeners;
    private readonly bound;
    private readonly buffer;
    private readonly bufferSize;
    private readonly onError?;
    private binding;
    constructor(options: InspectionFeedOptions);
    get state(): ConnectionState;
    get currentBinding(): Readonly<FeedBinding>;
    connect(): void;
    onStateChange(handler: (state: ConnectionState, error?: Error) => void): () => void;
    /** Points the feed at a station and, optionally, the shipment in progress. */
    bind(binding: FeedBinding): void;
    subscribe(listener: Listener): () => void;
    close(): void;
    private bindTopic;
    private unbindTopic;
    private emit;
}

/**
 * Exception derivation.
 *
 * The API stores seven issue *rows* (`damage`, `unidentified_product`,
 * `wrong_load`, `no_identifiers`, `wrong_product`, `overage`, `shortage`),
 * in three different shapes — session-scoped singleton, per-instance, and
 * session-less per-line-item — but an operator screen has to cover nine
 * distinct situations regardless of shape. `manual_count_correction` is the
 * one exception with no issue row at all — a hand-edited count is reported
 * directly off the line item.
 *
 * Every other exception type is reported *only* when a real issue row backs
 * it, deliberately, even when the raw line-item numbers alone would already
 * tell the same story (a line short of `expected_quantity`, a count sitting
 * in the `unknown`/`wrong` sentinel bucket). The issues table is the system
 * of record for audit and KPI tracking — an exception the client invented
 * from quantity math, with nothing behind it to resolve, would be invisible
 * to that tracking even while it sits in front of an operator. Concretely
 * this means a `shortage` never appears while counting is still in progress:
 * the API only creates that row when the operator actually tries to
 * complete the inspection and comes up short (`detectShortages`, called
 * from `finishShipmentProcessing`/`submitShipmentProcessing`) — never
 * continuously during counting.
 *
 * Reimplementing that mapping is the single most error-prone part of an
 * integration, so it lives here. Feed {@link deriveExceptions} whatever you
 * have — a full shipment from REST, or a realtime unit payload — and it returns
 * one normalised list with resolution paths already attached.
 */

type ExceptionType = 'unidentified_product' | 'wrong_product' | 'overage' | 'shortage' | 'manual_count_correction' | 'wrong_load' | 'missing_identifiers' | 'unit_removed' | 'damage';
type ExceptionSeverity = 'blocking' | 'warning' | 'info';
/** How an operator can close an exception. */
type ResolutionAction = 
/** Attach a real SKU/product to a detected-but-unidentified item. */
'identify_product'
/** Confirm the item was physically pulled from the shipment. */
 | 'remove_item'
/** Keep the off-order item and ship it anyway. */
 | 'accept_substitute'
/** Accept the counted quantity as correct. */
 | 'accept_count'
/** Overwrite the counted quantity by hand. */
 | 'correct_count'
/** Confirm the missing units were physically located and re-counted. */
 | 'locate_stock'
/** Redirect a pallet that belongs to a different load. */
 | 'redirect_load'
/** Drop the unit from the inspection entirely. */
 | 'cancel_unit'
/** Supply the pallet identifiers that could not be read. */
 | 'submit_identifiers'
/** Nothing to do — acknowledge and move on. */
 | 'acknowledge'
/** The system was wrong; no physical discrepancy exists. */
 | 'flag_false_positive'
/** Cannot be closed here — record why and escalate. */
 | 'mark_unresolved'
/** The `wrong_product` call itself was wrong — assign the real line item. */
 | 'correct_product'
/** One detected instance actually belongs to a different sku. */
 | 'reassign_product';
interface ResolutionOption {
    action: ResolutionAction;
    /** Operator-facing label. Override via {@link ExceptionCopy}. */
    label: string;
    /** `true` when the operator must do something on the floor first. */
    requiresPhysicalAction: boolean;
    /** Issue status this action writes, for exceptions backed by an issue row. */
    status?: IssueStatus;
    /** Prompt for a free-text reason before submitting. */
    requiresReason?: boolean;
}
interface NormalizedException {
    /** Stable within a shipment — safe as a React key and for dedupe. */
    key: string;
    type: ExceptionType;
    status: IssueStatus;
    severity: ExceptionSeverity;
    /** Short operator-facing summary. */
    title: string;
    /** One line of detail: quantities, SKU, pallet id. */
    description: string;
    /** Ways to close it, in the order they should be offered. */
    resolutions: ResolutionOption[];
    /** `true` while this exception prevents the inspection from completing. */
    blocksCompletion: boolean;
    /** Present when the exception came from a stored issue row. */
    issue?: ShipmentIssue;
    /** Present when the exception was derived from a line item. */
    lineItem?: LineItem;
    unitId?: string;
    unitSessionId?: number;
    /** Only pallet inspections can raise `wrong_load` / `missing_identifiers`. */
    palletOnly: boolean;
    quantities?: {
        expected: number;
        actual: number;
        delta: number;
    };
}
declare const PALLET_ONLY_EXCEPTIONS: ExceptionType[];
/**
 * Backend keyword `action` for {@link ArvistClient.resolveIssueById}, per
 * exception type and {@link ResolutionAction}. Only issue types that resolve
 * through that endpoint appear here — `damage`/`wrong_load`/
 * `missing_identifiers` resolve through the older status write instead, and
 * are absent on purpose.
 */
declare const ISSUE_ACTION_BY_RESOLUTION: Partial<Record<ExceptionType, Partial<Record<ResolutionAction, string>>>>;
declare function isExceptionOpen(exception: NormalizedException): boolean;
/** Every string the derivation produces, so it can be localised or rebranded. */
interface ExceptionCopy {
    titles: Record<ExceptionType, string>;
    actions: Record<ResolutionAction, string>;
}
/** Partial overrides, for callers replacing only some strings. */
interface PartialExceptionCopy {
    titles?: Partial<Record<ExceptionType, string>>;
    actions?: Partial<Record<ResolutionAction, string>>;
}
/**
 * Matches the real first-party frontend's operator-facing copy
 * (`arvist/frontend/userdashboard/src/locales/translations/en.ts`) for the
 * four exception types that resolve through the keyword-action endpoint
 * (`unidentified_product`/`wrong_product`/`overage`/`shortage`), so an
 * operator sees identical wording whether they use the in-house dashboard or
 * an integrator's app built on this SDK.
 *
 * Two known gaps, both on the real frontend's side, not fixed here:
 * - `remove_item` covers three real, *differently worded* buttons ("Remove
 *   Product" for unidentified_product/wrong_product, "Extra product removed"
 *   for overage) — this copy model is one label per action, not per
 *   (type, action) pair, so it can't carry all three. "Remove Product" is
 *   used since it covers two of the three.
 * - `reassign_product` (overage's `reassign`) has no dedicated copy in the
 *   real frontend at all — it reuses `unidentified_product`'s "Assign
 *   Product" flow and modal verbatim, which reads as if the operator is
 *   identifying an unidentified item rather than reassigning an overage.
 *   The label here is written fresh rather than copying that mismatch.
 *
 * `damage`/`wrong_load`/`missing_identifiers` resolve through the older,
 * status-based endpoint (not the keyword one) and have no equivalent
 * per-action copy to match — their real UI is a single "Resolve" button
 * (damage) or a differently-shaped three-option flow (wrong_load) — so their
 * copy here is unchanged from this SDK's own original wording.
 */
declare const DEFAULT_EXCEPTION_COPY: ExceptionCopy;
/**
 * The resolution paths each exception type offers, in presentation order.
 *
 * Kept as a pure function of type + copy so a host app can wrap it to hide
 * actions its operators are not permitted to take.
 */
declare function resolutionsFor(type: ExceptionType, copy: ExceptionCopy): ResolutionOption[];
interface DeriveOptions {
    copy?: ExceptionCopy;
    /**
     * When the shipment is auto-completed by an upstream system (a box-closure
     * barcode scan, for example), an open `shortage` issue no longer holds the
     * inspection open — completion already happened out of band. The issue row
     * itself still gets reported (for audit), just not as a blocker. Defaults
     * to `false`, which is the conservative reading.
     */
    autoCompleted?: boolean;
    /**
     * Unit type of the inspection. Pallet-only exceptions are dropped for
     * `product` inspections even if a stale row exists. Defaults to inferring
     * from the shipment's units.
     */
    unitType?: ShipmentUnitType;
    /** Suppress exception types the host app handles elsewhere. */
    exclude?: ExceptionType[];
}
/** Off-order sentinel rows are exceptions, not inventory. */
declare function isSentinelLineItem(item: LineItem): boolean;
/** Real order lines only — what you reconcile expected vs actual against. */
declare function orderedLineItems(items: LineItem[] | undefined): LineItem[];
/**
 * Flattens issue rows out of a shipment's units, keeping only the current
 * session per unit and one row per instance (see {@link issueInstanceKey}) —
 * a defensive dedupe against a duplicate row, not a collapse of distinct
 * detected instances.
 */
declare function collectIssues(shipment: Pick<Shipment, 'units'> | undefined): ShipmentIssue[];
/**
 * Turns a shipment into the normalised exception list an operator screen needs.
 *
 * Pass the shipment exactly as the API returned it. Realtime unit payloads can
 * be merged in first with {@link mergeRealtimeIssues}.
 */
declare function deriveExceptions(shipment: Pick<Shipment, 'line_items' | 'units' | 'status'> | undefined, options?: DeriveOptions): NormalizedException[];
/**
 * Realtime unit payloads carry issues keyed `type` rather than `issue_type`,
 * and without ids. This folds them into a shipment so a single
 * {@link deriveExceptions} call covers both sources.
 */
declare function mergeRealtimeIssues<T extends Pick<Shipment, 'units'>>(shipment: T, update: {
    unit_id?: string;
    unit_session_id?: number;
    issues?: unknown[];
}): T;

/**
 * Reconciliation and completion gating.
 *
 * `completed` from the realtime feed carries final counts, and the rule for
 * reading them is always the same: compare `expected_quantity` against
 * `actual_quantity` per line, and treat sentinel-SKU rows as off-order. This
 * module implements that once so every integration reads the numbers the same
 * way.
 */

/**
 * The scannable barcode for a line item.
 *
 * Convention is `additional_data.upc`, falling back to the SKU. Upstream
 * systems do not always populate the UPC, so the fallback is load-bearing —
 * never assume the first key is present.
 */
declare function getLineItemBarcode(item: LineItem): string | undefined;
/** Index of barcode → line item, for wedge-scanner lookups. */
declare function buildBarcodeIndex(items: LineItem[] | undefined): Map<string, LineItem>;
/** Strips whitespace and leading zeros so UPC-A and EAN-13 forms match. */
declare function normalizeBarcode(code: string): string;
/** How many line items are missing a real UPC — a useful data-quality signal. */
declare function upcCoverage(items: LineItem[] | undefined): {
    total: number;
    withUpc: number;
    ratio: number;
    missing: LineItem[];
};
type LineVariance = 'match' | 'over' | 'short';
interface ReconciledLine {
    item: LineItem;
    expected: number;
    actual: number;
    delta: number;
    variance: LineVariance;
    /** `true` when an operator overrode the counted quantity. */
    manuallyCorrected: boolean;
    barcode?: string;
}
interface Reconciliation {
    lines: ReconciledLine[];
    /** Counted items that are not on the order, keyed by their sentinel SKU. */
    offOrder: {
        sku: 'unknown' | 'wrong';
        item: LineItem;
        quantity: number;
    }[];
    totals: {
        expected: number;
        actual: number;
        delta: number;
    };
    counts: {
        matched: number;
        over: number;
        short: number;
        manuallyCorrected: number;
    };
    /** `true` when every ordered line matches and nothing is off-order. */
    isClean: boolean;
}
/**
 * Reconciles a shipment's line items. Safe to call on a provisional shipment,
 * but only the `completed` payload carries final counts — anything earlier can
 * still change.
 */
declare function reconcile(shipment: Pick<Shipment, 'line_items'> | undefined): Reconciliation;
interface CompletionCheck {
    canComplete: boolean;
    /** Open exceptions that must be closed first. */
    blockers: NormalizedException[];
    /** Open exceptions worth showing but which do not gate completion. */
    warnings: NormalizedException[];
    reason?: string;
}
/**
 * Whether an inspection can be closed from the UI.
 *
 * An open, unresolved `shortage` issue holds the inspection open — but that
 * row only exists once the operator has actually tried to complete and come
 * up short (the API's own `detectShortages` check), so this reads as
 * unblocked right up until that first attempt; the block, when it happens,
 * comes from the server rejecting `finish`/`submit`, not from a client-side
 * guess made from quantity math. Pass `autoCompleted: true` when an upstream
 * system closes the shipment out of band — a box-closure barcode scan, for
 * example — in which case an open shortage is still recorded but no longer
 * blocking.
 */
declare function checkCompletion(shipment: Pick<Shipment, 'line_items' | 'units' | 'status'> | undefined, options?: DeriveOptions): CompletionCheck;

/**
 * Presigned media helpers.
 *
 * Inspection media is served as short-lived presigned URLs — assume roughly 30
 * minutes unless the API tells you otherwise. A URL that worked when a page
 * loaded will not work an hour later, so anything you need to keep must be
 * copied to your own storage on receipt.
 */

/** Conservative default lifetime, used when the URL carries no expiry of its own. */
declare const DEFAULT_PRESIGNED_TTL_MS: number;
/** Refresh this far ahead of expiry so an in-flight request does not race it. */
declare const PRESIGN_REFRESH_MARGIN_MS: number;
/**
 * Reads the expiry out of a presigned URL.
 *
 * Handles the two common signing conventions — `X-Amz-Date` +
 * `X-Amz-Expires`, and a bare `Expires` epoch. Returns `undefined` when the URL
 * is not signed or uses a scheme we do not recognise, in which case callers
 * should fall back to {@link DEFAULT_PRESIGNED_TTL_MS} from receipt.
 */
declare function parsePresignedExpiry(url: string): Date | undefined;
interface MediaExpiry {
    expiresAt?: Date;
    /** `true` once the URL is past its expiry (or its assumed one). */
    expired: boolean;
    /** `true` once it is close enough to expiry to be worth re-fetching. */
    stale: boolean;
    msRemaining?: number;
}
/**
 * Expiry state for a presigned URL.
 *
 * `receivedAt` matters when the URL carries no parseable expiry: the assumed
 * TTL runs from when you received it, not from now.
 */
declare function getMediaExpiry(media: Pick<MediaRef, 'url' | 'expires_at'> | undefined, receivedAt?: Date, now?: Date): MediaExpiry;
declare function isMediaUrlExpired(media: Pick<MediaRef, 'url' | 'expires_at'> | undefined, receivedAt?: Date): boolean;
interface FlatMediaItem {
    id: number;
    side: string;
    url?: string;
    filename?: string;
    contentId?: string;
    mimeType?: string;
    unitSessionId: number;
    damageCount: number;
}
/** Flattens the nested image structure into a list a gallery can render. */
declare function flattenMedia(images: ShipmentImage[] | undefined): FlatMediaItem[];
/** Sorts media into the order operators expect to walk a unit. */
declare function sortMediaBySide<T extends {
    side: string;
}>(items: T[]): T[];

export { type ShipmentDamage as $, ArvistError as A, type LineVariance as B, type ConnectionState as C, DEFAULT_ERROR_MESSAGES as D, type ErrorMessageResolver as E, type FlatMediaItem as F, type ListShipmentsQuery as G, type MediaRef as H, type InspectionEvent as I, PALLET_ONLY_EXCEPTIONS as J, PRESIGN_REFRESH_MARGIN_MS as K, type LineItemCorrection as L, type MediaExpiry as M, type NormalizedException as N, type Paginated as O, type PartialExceptionCopy as P, type QualityStation as Q, type Reconciliation as R, type Shipment as S, type QualityStationType as T, type RealtimeIssue as U, type ReconciledLine as V, type ResolutionAction as W, type ResolveIssueByIdInput as X, type ResolveIssueInput as Y, SENTINEL_SKUS as Z, type SentinelSku as _, type CompletionCheck as a, type ShipmentDetail as a0, type ShipmentIssue as a1, type ShipmentPalletIdentifier as a2, type ShipmentSide as a3, type ShipmentStatus as a4, type ShipmentType as a5, type ShipmentUnit as a6, type ShipmentUnitSession as a7, type ShipmentUnitType as a8, type SocketIoTransportConfig as a9, upcCoverage as aA, type SocketLike as aa, type SubmitInspectionInput as ab, type UnitPayload as ac, type UpdateUnknownProductInput as ad, buildBarcodeIndex as ae, checkCompletion as af, collectIssues as ag, createErrorMessageResolver as ah, createSocketIoTransport as ai, deriveExceptions as aj, errorFromResponse as ak, flattenMedia as al, getDisplayMessage as am, getLineItemBarcode as an, getMediaExpiry as ao, isExceptionOpen as ap, isMediaUrlExpired as aq, isSentinelLineItem as ar, mergeRealtimeIssues as as, normalizeBarcode as at, orderedLineItems as au, parsePresignedExpiry as av, reconcile as aw, resolutionsFor as ax, sortMediaBySide as ay, topics as az, type LineItem as b, type StartInspectionInput as c, InspectionFeed as d, type ExceptionCopy as e, type SocketIoFactory as f, type RealtimeTransport as g, type ArvistErrorCode as h, type ResolutionOption as i, type ExceptionType as j, type ShipmentImage as k, type ActionResult as l, type ArvistErrorInit as m, DEFAULT_EXCEPTION_COPY as n, DEFAULT_PRESIGNED_TTL_MS as o, type DeriveOptions as p, type DetectionAnnotation as q, type ExceptionSeverity as r, type FeedBinding as s, ISSUE_ACTION_BY_RESOLUTION as t, type InspectionEventKind as u, type InspectionFeedOptions as v, type IssueResolveAction as w, type IssueStatus as x, type IssueType as y, type LineItemInput as z };
