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
 * Issue categories the API persists. This is deliberately smaller than the
 * operator-facing exception taxonomy: quantity exceptions (overage, shortage,
 * wrong product, manual correction) are *derived* from line items rather than
 * stored as rows. Use {@link deriveExceptions} to get the full picture.
 */
export type IssueType = 'damage' | 'unidentified_product' | 'wrong_load' | 'no_identifiers';

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

export interface ResolveIssueInput {
  unit_session_id: number;
  issue_type: IssueType;
  status: IssueStatus;
  /** Required by convention when `status` is `unresolved` — why it could not be closed. */
  reason?: string;
  metadata?: Record<string, unknown>;
  site_id?: number;
}
