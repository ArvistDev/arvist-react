/**
 * Wire types for the Arvist public API (`/v1/api/`).
 *
 * These mirror the documented REST responses. Fields the API may omit are
 * optional here rather than defaulted, so you can tell "absent" from "empty".
 */

// ---------------------------------------------------------------------------
// Shipments
// ---------------------------------------------------------------------------

export type ShipmentType = 'inbound' | 'outbound';

export type ShipmentStatus = 'pending' | 'in_progress' | 'review' | 'completed' | 'canceled';

export type ShipmentUnitType = 'pallet' | 'product';

/**
 * Sentinel SKUs the API uses for line items that were counted but could not be
 * matched to the order. They are not real products — treat them as exceptions,
 * never as inventory.
 *
 * - `unknown` — an item was detected but no identifier could be read.
 * - `wrong`   — an identifier was read and it is not on this order.
 */
export const SENTINEL_SKUS = ['unknown', 'wrong'] as const;
export type SentinelSku = (typeof SENTINEL_SKUS)[number];

export interface LineItem {
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

export interface Shipment {
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

export interface ShipmentUnit {
  id: string;
  shipment_id: number;
  type: ShipmentUnitType | null;
  created_at: string;
  updated_at: string;
  /** Ordered newest-first. Index 0 is the current session for the unit. */
  quality_sessions?: ShipmentUnitSession[];
}

export interface ShipmentUnitSession {
  id: number;
  shipment_unit_id: string;
  created_at: string;
  updated_at: string;
  images?: ShipmentImage[];
  issues?: ShipmentIssue[];
}

export interface ShipmentPalletIdentifier {
  id: number;
  identifier: string;
  is_tracked: boolean;
  tracked_at: string | null;
  metadata?: Record<string, unknown>;
  shipment_unit_id: string | null;
}

// ---------------------------------------------------------------------------
// Issues — the raw rows the API stores
// ---------------------------------------------------------------------------

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
export type IssueType =
  | 'damage'
  | 'unidentified_product'
  | 'wrong_load'
  | 'no_identifiers'
  | 'wrong_product'
  | 'overage'
  | 'shortage';

export type IssueStatus = 'open' | 'resolved' | 'canceled' | 'unresolved' | 'false_positive';

export interface ShipmentIssue {
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

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export type ShipmentSide =
  | 'front' | 'back' | 'left' | 'right' | 'top' | 'all'
  | 'left_low' | 'left_high' | 'right_low' | 'right_high'
  | 'front_low' | 'front_high';

export interface ShipmentImage {
  id: number;
  side: ShipmentSide | string;
  filepath?: string;
  shipment_unit_session_id: number;
  media?: MediaRef;
  damages?: ShipmentDamage[];
}

export interface MediaRef {
  id?: number;
  content_id?: string;
  filename?: string;
  mime_type?: string;
  /** Presigned and short-lived. See {@link isMediaUrlExpired}. */
  url?: string;
  /** ISO timestamp the presigned URL stops working, when the API supplies one. */
  expires_at?: string;
}

export interface ShipmentDamage {
  id: number;
  type: string;
  category: string;
  category_type: string;
  description: string;
  damaged_box_qty: number | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Stations
// ---------------------------------------------------------------------------

export type QualityStationType =
  | 'turntable' | 'stationary' | 'conveyor_belt' | 'mobile_device' | 'packing_table';

export interface QualityStation {
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
  inspection_types?: { id: number; name: string; description?: string | null }[];
  inspection_configuration_id?: number | null;
  additional_configurations?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export interface StartInspectionInput {
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

export interface LineItemInput {
  name: string;
  sku: string;
  product_id: string | number;
  expected_quantity: number;
  line_no?: string;
  inventory_item_id?: string;
  /** Put the scannable barcode at `additional_data.upc`. */
  additional_data?: Record<string, unknown> | null;
}

export interface ListShipmentsQuery {
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
export interface ShipmentDetail extends Shipment {
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
export interface ActionResult {
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

export interface Paginated<T> {
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
export interface DetectionAnnotation {
  id: number;
  image_id?: number;
  /** Target line-item id, or `'remove'`. */
  category_id: number | 'remove';
  /**
   * Product identifiers read from the item. Setting any non-quantity key here
   * marks the item as belonging to another order rather than this one.
   */
  identifiers?: Record<string, string | number | null> & { items_quantity?: number };
  bbox?: number[];
  [key: string]: unknown;
}

export interface UpdateUnknownProductInput {
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
export interface LineItemCorrection {
  id: number;
  actual_quantity: number;
  /** Marks the count as operator-set rather than machine-counted. */
  is_edited: boolean;
}

export interface SubmitInspectionInput {
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
export interface ResolveIssueInput {
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
export type IssueResolveAction =
  /** `unidentified_product` (open/false_positive) → resolved. */
  | { action: 'assign'; annotation_id: number; sku: string }
  /** `unidentified_product` (open) → false_positive: the detection itself was noise. */
  | { action: 'invalid'; annotation_id: number }
  /** `wrong_product`/`unidentified_product` (open) → resolved: kept and shipped as-is. */
  | { action: 'keep_in_order'; annotation_id: number; sku?: string }
  /** `wrong_product` (open) → false_positive: the wrong_product call itself was wrong. */
  | { action: 'correct_product'; annotation_id: number; sku: string }
  /** `wrong_product`/`unidentified_product` (open) → resolved: physically pulled. */
  | { action: 'remove_product'; annotation_id: number; sku?: string }
  /** `overage` (open) → resolved: the extra units were physically removed. */
  | { action: 'remove_extra' }
  /**
   * `overage` (open) → false_positive: one detected instance belongs to a
   * different sku. `annotation_id` picks which detected instance on the line
   * item is being reassigned — the issue itself does not pin one.
   */
  | { action: 'reassign'; annotation_id: number; target_sku: string }
  /** `shortage` (open) → resolved: the missing units were located and re-counted. */
  | { action: 'missing_added' }
  /** `shortage` (open) → false_positive: the expected count itself was wrong. */
  | { action: 'wrong_counting'; corrected_quantity: number };

export type ResolveIssueByIdInput = { issue_id: number; site_id?: number } & IssueResolveAction;
