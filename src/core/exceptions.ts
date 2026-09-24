/**
 * Exception derivation.
 *
 * The API stores seven issue *rows* (`damage`, `unidentified_product`,
 * `wrong_load`, `no_identifiers`, `wrong_product`, `overage`, `shortage`),
 * in three different shapes — session-scoped singleton, per-instance, and
 * session-less per-line-item — but an operator screen has to cover nine
 * distinct situations regardless of shape. The rest are implied by the line
 * items: a hand-edited count, or a sentinel SKU standing in for an off-order
 * item.
 *
 * Reimplementing that mapping is the single most error-prone part of an
 * integration, so it lives here. Feed {@link deriveExceptions} whatever you
 * have — a full shipment from REST, or a realtime unit payload — and it returns
 * one normalised list with resolution paths already attached.
 */

import {
  SENTINEL_SKUS,
  type IssueStatus,
  type IssueType,
  type LineItem,
  type Shipment,
  type ShipmentIssue,
  type ShipmentUnitType,
} from './types';

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------

export type ExceptionType =
  | 'unidentified_product'
  | 'wrong_product'
  | 'overage'
  | 'shortage'
  | 'manual_count_correction'
  | 'wrong_load'
  | 'missing_identifiers'
  | 'unit_removed'
  | 'damage';

export type ExceptionSeverity = 'blocking' | 'warning' | 'info';

/** How an operator can close an exception. */
export type ResolutionAction =
  /** Attach a real SKU/product to a detected-but-unidentified item. */
  | 'identify_product'
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

export interface ResolutionOption {
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

export interface NormalizedException {
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
  quantities?: { expected: number; actual: number; delta: number };
}

export const PALLET_ONLY_EXCEPTIONS: ExceptionType[] = ['wrong_load', 'missing_identifiers'];

/** Which issue row maps onto which exception type. */
const ISSUE_TO_EXCEPTION: Record<IssueType, ExceptionType> = {
  damage: 'damage',
  unidentified_product: 'unidentified_product',
  wrong_load: 'wrong_load',
  no_identifiers: 'missing_identifiers',
  wrong_product: 'wrong_product',
  overage: 'overage',
  shortage: 'shortage',
};

/**
 * Backend keyword `action` for {@link ArvistClient.resolveIssueById}, per
 * exception type and {@link ResolutionAction}. Only issue types that resolve
 * through that endpoint appear here — `damage`/`wrong_load`/
 * `missing_identifiers` resolve through the older status write instead, and
 * are absent on purpose.
 */
export const ISSUE_ACTION_BY_RESOLUTION: Partial<
  Record<ExceptionType, Partial<Record<ResolutionAction, string>>>
> = {
  unidentified_product: {
    identify_product: 'assign',
    remove_item: 'remove_product',
    flag_false_positive: 'invalid',
  },
  wrong_product: {
    accept_substitute: 'keep_in_order',
    remove_item: 'remove_product',
    correct_product: 'correct_product',
  },
  overage: {
    remove_item: 'remove_extra',
    reassign_product: 'reassign',
  },
  shortage: {
    locate_stock: 'missing_added',
    correct_count: 'wrong_counting',
  },
};

const OPEN_STATUSES: IssueStatus[] = ['open', 'unresolved'];

export function isExceptionOpen(exception: NormalizedException): boolean {
  return OPEN_STATUSES.includes(exception.status);
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

/** Every string the derivation produces, so it can be localised or rebranded. */
export interface ExceptionCopy {
  titles: Record<ExceptionType, string>;
  actions: Record<ResolutionAction, string>;
}

/** Partial overrides, for callers replacing only some strings. */
export interface PartialExceptionCopy {
  titles?: Partial<Record<ExceptionType, string>>;
  actions?: Partial<Record<ResolutionAction, string>>;
}

export const DEFAULT_EXCEPTION_COPY: ExceptionCopy = {
  titles: {
    unidentified_product: 'Unidentified product',
    wrong_product: 'Wrong product',
    overage: 'Overage',
    shortage: 'Shortage',
    manual_count_correction: 'Manual count correction',
    wrong_load: 'Wrong load',
    missing_identifiers: 'Missing identifiers',
    unit_removed: 'Unit removed from inspection',
    damage: 'Damage detected',
  },
  actions: {
    identify_product: 'Identify product',
    remove_item: 'Removed from shipment',
    accept_substitute: 'Accept as substitute',
    accept_count: 'Accept count',
    correct_count: 'Correct count',
    locate_stock: 'Located and re-counted',
    redirect_load: 'Redirected to correct load',
    cancel_unit: 'Remove unit from inspection',
    submit_identifiers: 'Enter identifiers',
    acknowledge: 'Acknowledge',
    flag_false_positive: 'Not an issue',
    mark_unresolved: 'Cannot resolve',
    correct_product: 'Correct the product',
    reassign_product: 'Reassign to correct product',
  },
};

// ---------------------------------------------------------------------------
// Resolution paths
// ---------------------------------------------------------------------------

function opt(
  action: ResolutionAction,
  copy: ExceptionCopy,
  extra: Omit<ResolutionOption, 'action' | 'label' | 'requiresPhysicalAction'> & {
    requiresPhysicalAction?: boolean;
  } = {},
): ResolutionOption {
  const { requiresPhysicalAction = false, ...rest } = extra;
  return { action, label: copy.actions[action], requiresPhysicalAction, ...rest };
}

/**
 * The resolution paths each exception type offers, in presentation order.
 *
 * Kept as a pure function of type + copy so a host app can wrap it to hide
 * actions its operators are not permitted to take.
 */
export function resolutionsFor(type: ExceptionType, copy: ExceptionCopy): ResolutionOption[] {
  switch (type) {
    case 'unidentified_product':
      return [
        opt('identify_product', copy, { status: 'resolved' }),
        opt('remove_item', copy, { status: 'resolved', requiresPhysicalAction: true }),
        opt('flag_false_positive', copy, { status: 'false_positive' }),
      ];
    case 'wrong_product':
      // No `mark_unresolved` — the API's keyword resolve endpoint has no
      // generic "escalate" action for a per-instance issue, only the specific
      // ones listed here.
      return [
        opt('remove_item', copy, { status: 'resolved', requiresPhysicalAction: true }),
        opt('accept_substitute', copy, { status: 'resolved' }),
        opt('correct_product', copy, { status: 'false_positive' }),
      ];
    case 'overage':
      // No "just accept it" action — an overage closes either by physically
      // removing the extra or by reattributing a detection to another sku.
      return [
        opt('remove_item', copy, { status: 'resolved', requiresPhysicalAction: true }),
        opt('reassign_product', copy, { status: 'false_positive' }),
      ];
    case 'shortage':
      return [
        opt('locate_stock', copy, { status: 'resolved', requiresPhysicalAction: true }),
        opt('correct_count', copy, { status: 'false_positive' }),
      ];
    case 'manual_count_correction':
      return [opt('acknowledge', copy, { status: 'resolved' })];
    case 'wrong_load':
      return [
        opt('redirect_load', copy, { status: 'resolved', requiresPhysicalAction: true }),
        opt('cancel_unit', copy, { status: 'canceled' }),
      ];
    case 'missing_identifiers':
      return [
        opt('submit_identifiers', copy, { status: 'resolved' }),
        opt('mark_unresolved', copy, { status: 'unresolved', requiresReason: true }),
      ];
    case 'unit_removed':
      return [opt('acknowledge', copy, { status: 'resolved' })];
    case 'damage':
      return [
        opt('acknowledge', copy, { status: 'resolved' }),
        opt('flag_false_positive', copy, { status: 'false_positive' }),
        opt('mark_unresolved', copy, { status: 'unresolved', requiresReason: true }),
      ];
  }
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

export interface DeriveOptions {
  copy?: ExceptionCopy;
  /**
   * When the shipment is auto-completed by an upstream system (a box-closure
   * barcode scan, for example), a shortage no longer holds the inspection open.
   * Defaults to `false`, which is the conservative reading.
   */
  autoCompleted?: boolean;
  /**
   * Whether counting has finished.
   *
   * This matters for shortages specifically. Counts climb from zero as units
   * complete, so mid-inspection every uncounted line looks short — reporting
   * those as real exceptions would bury the operator in noise before a single
   * unit has been scanned. While counting is in flight a shortage is reported
   * as provisional: visible, but not blocking and not alarming.
   *
   * Defaults to whether the shipment has reached `review` or `completed`.
   * {@link checkCompletion} overrides it to `true`, because asking to complete
   * an inspection is itself the assertion that counting is done.
   */
  countsFinal?: boolean;
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
export function isSentinelLineItem(item: LineItem): boolean {
  return (SENTINEL_SKUS as readonly string[]).includes((item.sku ?? '').toLowerCase().trim());
}

/** Real order lines only — what you reconcile expected vs actual against. */
export function orderedLineItems(items: LineItem[] | undefined): LineItem[] {
  return (items ?? []).filter((i) => !isSentinelLineItem(i));
}

function lineItemKey(item: LineItem, suffix: string): string {
  return `line:${item.id ?? item.sku ?? item.product_id}:${suffix}`;
}

function inferUnitType(shipment: Pick<Shipment, 'units'> | undefined): ShipmentUnitType {
  const unitTypes = (shipment?.units ?? []).map((u) => u.type).filter(Boolean);
  return unitTypes.includes('pallet') ? 'pallet' : 'product';
}

/**
 * Identifies one issue *instance* within a session: `unidentified_product`/
 * `wrong_product` carry a flat `metadata.annotation_id` and can have several
 * rows of the same type per session, one per detected instance, so the type
 * alone does not identify a row. `damage`/`wrong_load`/`no_identifiers` carry
 * no `annotation_id` and are genuinely one-per-session, so the type alone is
 * enough — and is also all the realtime feed sends for them.
 */
function issueInstanceKey(issue: Pick<ShipmentIssue, 'issue_type' | 'metadata'>): string {
  const annotationId = issue.metadata?.['annotation_id'];
  return annotationId != null ? `${issue.issue_type}:${String(annotationId)}` : issue.issue_type;
}

/**
 * Flattens issue rows out of a shipment's units, keeping only the current
 * session per unit and one row per instance (see {@link issueInstanceKey}) —
 * a defensive dedupe against a duplicate row, not a collapse of distinct
 * detected instances.
 */
export function collectIssues(shipment: Pick<Shipment, 'units'> | undefined): ShipmentIssue[] {
  const out: ShipmentIssue[] = [];
  for (const unit of shipment?.units ?? []) {
    const session = unit.quality_sessions?.[0];
    if (!session) continue;
    const seen = new Set<string>();
    for (const issue of session.issues ?? []) {
      const key = issueInstanceKey(issue);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...issue, unit_id: unit.id, unit_session_id: session.id });
    }
  }
  return out;
}

/**
 * Turns a shipment into the normalised exception list an operator screen needs.
 *
 * Pass the shipment exactly as the API returned it. Realtime unit payloads can
 * be merged in first with {@link mergeRealtimeIssues}.
 */
export function deriveExceptions(
  shipment: Pick<Shipment, 'line_items' | 'units' | 'status'> | undefined,
  options: DeriveOptions = {},
): NormalizedException[] {
  if (!shipment) return [];

  const copy = options.copy ?? DEFAULT_EXCEPTION_COPY;
  const unitType = options.unitType ?? inferUnitType(shipment);
  const exclude = new Set(options.exclude ?? []);
  const countsFinal =
    options.countsFinal ?? (shipment.status === 'review' || shipment.status === 'completed');
  const shortageBlocks = countsFinal && !options.autoCompleted;
  const out: NormalizedException[] = [];

  const push = (e: NormalizedException) => {
    if (!exclude.has(e.type)) out.push(e);
  };

  /**
   * When an item cannot be identified the API records it twice: an
   * `unidentified_product` issue row against the unit, and an `unknown`
   * sentinel line item carrying the count. They describe one physical problem,
   * so the quantity is folded into the issue-backed exception and the sentinel
   * row is not reported again.
   */
  const unknownRow = (shipment.line_items ?? []).find(
    (i) => i.sku?.toLowerCase().trim() === 'unknown' && (i.actual_quantity ?? 0) > 0,
  );
  let unknownRowConsumed = false;

  // 1. Stored issue rows -----------------------------------------------------
  for (const issue of collectIssues(shipment)) {
    const type = ISSUE_TO_EXCEPTION[issue.issue_type];
    const palletOnly = PALLET_ONLY_EXCEPTIONS.includes(type);
    if (palletOnly && unitType !== 'pallet') continue;

    // A wrong_load closed by cancelling the unit is reported as its own
    // exception — the unit left the inspection, which downstream systems need
    // to see even though the load issue itself is closed.
    const resolvedType: ExceptionType =
      type === 'wrong_load' && issue.status === 'canceled' ? 'unit_removed' : type;

    const mergesUnknownRow = resolvedType === 'unidentified_product' && unknownRow !== undefined;
    if (mergesUnknownRow) unknownRowConsumed = true;
    const quantity = mergesUnknownRow ? (unknownRow!.actual_quantity ?? 0) : undefined;

    push({
      key: `issue:${issue.id}`,
      type: resolvedType,
      status: issue.status,
      severity: severityFor(resolvedType, issue.status, shortageBlocks),
      title: copy.titles[resolvedType],
      description: quantity
        ? `${quantity} item(s) could not be identified.`
        : describeIssue(resolvedType, issue),
      resolutions: resolutionsFor(resolvedType, copy),
      blocksCompletion: false,
      issue,
      lineItem: mergesUnknownRow ? unknownRow : undefined,
      unitId: issue.unit_id,
      unitSessionId: issue.unit_session_id,
      palletOnly: PALLET_ONLY_EXCEPTIONS.includes(resolvedType),
      ...(quantity !== undefined ? { quantities: { expected: 0, actual: quantity, delta: quantity } } : {}),
    });
  }

  // 2. Off-order sentinel line items ----------------------------------------
  for (const item of shipment.line_items ?? []) {
    if (!isSentinelLineItem(item)) continue;
    if (item.actual_quantity <= 0) continue;
    if (item === unknownRow && unknownRowConsumed) continue;

    const sku = item.sku.toLowerCase().trim();
    const type: ExceptionType = sku === 'wrong' ? 'wrong_product' : 'unidentified_product';
    push({
      key: lineItemKey(item, type),
      type,
      status: 'open',
      severity: 'warning',
      title: copy.titles[type],
      description:
        type === 'wrong_product'
          ? `${item.actual_quantity} item(s) not on this order were counted.`
          : `${item.actual_quantity} item(s) could not be identified.`,
      // No issue row backs a sentinel-only row (see `resolve()`'s per-type
      // action map) — same reasoning as the overage/shortage case below:
      // empty, not a set of buttons guaranteed to fail.
      resolutions: [],
      blocksCompletion: false,
      lineItem: item,
      palletOnly: false,
      quantities: { expected: 0, actual: item.actual_quantity, delta: item.actual_quantity },
    });
  }

  // 3. Quantity variance on real order lines --------------------------------
  for (const item of orderedLineItems(shipment.line_items)) {
    const expected = item.expected_quantity ?? 0;
    const actual = item.actual_quantity ?? 0;
    const delta = actual - expected;

    if (delta !== 0) {
      const type: ExceptionType = delta > 0 ? 'overage' : 'shortage';
      const provisional = type === 'shortage' && !countsFinal;
      const blocks = type === 'shortage' && shortageBlocks;

      // `overage`/`shortage` are real stored rows on `line_items[].issue` —
      // session-less, one open row per line item. When one is present and
      // matches the direction of the variance, the exception is issue-backed
      // (resolvable via the issue actions); otherwise it is still reported
      // from the quantity math alone, e.g. before the server has created the
      // row yet (always true right after start — nothing has been counted,
      // so every ordered line reads as short, well before `detectShortages`
      // ever runs). `resolve()` requires a real issue row for these two
      // types, so `resolutions` must actually be empty here too, not just
      // documented as such — offering buttons that are guaranteed to fail
      // with "no issue row to resolve" is worse than offering none.
      const storedIssue =
        item.issue && item.issue.issue_type === type ? item.issue : undefined;
      const open = storedIssue ? OPEN_STATUSES.includes(storedIssue.status) : true;

      push({
        key: storedIssue ? `issue:${storedIssue.id}` : lineItemKey(item, type),
        type,
        status: storedIssue ? storedIssue.status : 'open',
        severity: !open ? 'info' : blocks ? 'blocking' : provisional ? 'info' : 'warning',
        title: copy.titles[type],
        description: provisional
          ? `${item.name || item.sku}: expected ${expected}, ${actual} counted so far — still counting.`
          : `${item.name || item.sku}: expected ${expected}, counted ${actual} ` +
            `(${delta > 0 ? '+' : ''}${delta}).`,
        resolutions: storedIssue ? resolutionsFor(type, copy) : [],
        blocksCompletion: open && blocks,
        issue: storedIssue,
        lineItem: item,
        palletOnly: false,
        quantities: { expected, actual, delta },
      });
    }

    // A hand-edited count is reported even when it reconciles, because the
    // count stopped being machine-verified the moment it was overridden.
    if (item.is_edited) {
      push({
        key: lineItemKey(item, 'manual_count_correction'),
        type: 'manual_count_correction',
        status: 'resolved',
        severity: 'info',
        title: copy.titles.manual_count_correction,
        description: `${item.name || item.sku}: count set to ${actual} by an operator.`,
        resolutions: resolutionsFor('manual_count_correction', copy),
        blocksCompletion: false,
        lineItem: item,
        palletOnly: false,
        quantities: { expected, actual, delta },
      });
    }
  }

  return out.sort(bySeverityThenType);
}

function severityFor(
  type: ExceptionType,
  status: IssueStatus,
  shortageBlocks: boolean,
): ExceptionSeverity {
  if (!OPEN_STATUSES.includes(status)) return 'info';
  if (type === 'shortage' && shortageBlocks) return 'blocking';
  if (type === 'manual_count_correction' || type === 'unit_removed') return 'info';
  return 'warning';
}

function describeIssue(type: ExceptionType, issue: ShipmentIssue): string {
  if (issue.description) return issue.description;
  const meta = issue.metadata ?? {};
  switch (type) {
    case 'wrong_load': {
      const id = meta.pallet_identifier ?? meta.identifier;
      return id ? `Pallet ${String(id)} belongs to a different load.` : 'Pallet belongs to a different load.';
    }
    case 'missing_identifiers':
      return 'No pallet identifier could be read from this unit.';
    case 'unit_removed':
      return 'This unit was removed from the inspection.';
    case 'damage': {
      const count = Array.isArray(meta.damages) ? meta.damages.length : undefined;
      return count ? `${count} damage finding(s) on this unit.` : 'Damage was detected on this unit.';
    }
    case 'unidentified_product':
      return 'An item was detected that could not be matched to a product.';
    default:
      return '';
  }
}

const SEVERITY_ORDER: Record<ExceptionSeverity, number> = { blocking: 0, warning: 1, info: 2 };
const TYPE_ORDER: ExceptionType[] = [
  'shortage', 'wrong_product', 'unidentified_product', 'wrong_load',
  'missing_identifiers', 'overage', 'damage', 'unit_removed', 'manual_count_correction',
];

function bySeverityThenType(a: NormalizedException, b: NormalizedException): number {
  const openDiff = Number(isExceptionOpen(b)) - Number(isExceptionOpen(a));
  if (openDiff !== 0) return openDiff;
  const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  if (sev !== 0) return sev;
  return TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type);
}

// ---------------------------------------------------------------------------
// Realtime merge
// ---------------------------------------------------------------------------

/**
 * Realtime unit payloads carry issues keyed `type` rather than `issue_type`,
 * and without ids. This folds them into a shipment so a single
 * {@link deriveExceptions} call covers both sources.
 */
export function mergeRealtimeIssues<T extends Pick<Shipment, 'units'>>(
  shipment: T,
  update: { unit_id?: string; unit_session_id?: number; issues?: unknown[] },
): T {
  if (!update.issues?.length || !update.unit_id) return shipment;

  const incoming: ShipmentIssue[] = update.issues.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const r = raw as Record<string, unknown>;
    const issueType = (r.issue_type ?? r.type) as IssueType | undefined;
    if (!issueType) return [];
    return [{
      id: typeof r.id === 'number' ? r.id : -1,
      issue_type: issueType,
      status: (r.status as IssueStatus) ?? 'open',
      description: typeof r.description === 'string' ? r.description : undefined,
      metadata: (r.metadata as Record<string, unknown>) ?? undefined,
      created_at: (r.created_at as string) ?? new Date().toISOString(),
      updated_at: (r.updated_at as string) ?? new Date().toISOString(),
      unit_id: update.unit_id,
      unit_session_id: update.unit_session_id,
    }];
  });

  if (!incoming.length) return shipment;

  const units = (shipment.units ?? []).map((unit) => {
    if (unit.id !== update.unit_id) return unit;
    const [current, ...rest] = unit.quality_sessions ?? [];
    const session = current ?? {
      id: update.unit_session_id ?? -1,
      shipment_unit_id: unit.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      issues: [],
    };
    // Replace by instance — the feed sends the authoritative state for an
    // instance, it does not append to it. Keyed the same way `collectIssues`
    // dedupes, so a per-instance type (`unidentified_product`/`wrong_product`)
    // can carry several rows here without one overwriting another.
    const byInstance = new Map(
      (session.issues ?? []).map((i) => [issueInstanceKey(i), i] as const),
    );
    for (const i of incoming) byInstance.set(issueInstanceKey(i), i);
    return {
      ...unit,
      quality_sessions: [{ ...session, issues: [...byInstance.values()] }, ...rest],
    };
  });

  return { ...shipment, units };
}
