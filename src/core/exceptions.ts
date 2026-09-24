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
export const DEFAULT_EXCEPTION_COPY: ExceptionCopy = {
  titles: {
    unidentified_product: 'Unidentified Product Detected',
    wrong_product: 'Wrong Product Detected',
    overage: 'Overage Detected',
    shortage: 'Shortage Detected',
    manual_count_correction: 'Manual count correction',
    wrong_load: 'Wrong Load Detected',
    missing_identifiers: 'Pallet Identifier Not Detected',
    unit_removed: 'Unit removed from inspection',
    damage: 'Damages Detected',
  },
  actions: {
    identify_product: 'Assign Product',
    remove_item: 'Remove Product',
    accept_substitute: 'Keep in Order',
    accept_count: 'Accept count',
    correct_count: 'Wrong Counting',
    locate_stock: 'Missing Product Added',
    redirect_load: 'Redirected to correct load',
    cancel_unit: 'Remove unit from inspection',
    submit_identifiers: 'Enter identifiers',
    acknowledge: 'Acknowledge',
    flag_false_positive: "That's Not a Product",
    mark_unresolved: 'Cannot resolve',
    correct_product: 'It Is a Correct Product',
    reassign_product: 'Reassign to a Different Product',
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
    const quantity = mergesUnknownRow ? (unknownRow!.actual_quantity ?? 0) : undefined;

    push({
      key: `issue:${issue.id}`,
      type: resolvedType,
      status: issue.status,
      severity: severityFor(resolvedType, issue.status),
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

  // 2. Overage/shortage issue rows -------------------------------------------
  // Session-less, one open row per line item (`line_items[].issue`). Reported
  // only when that row actually exists — see the module comment for why a
  // line simply reading over/under `expected_quantity` is never enough on its
  // own. `unidentified_product`/`wrong_product` sentinel counts (SKU `unknown`/
  // `wrong`) get the identical treatment: their count is folded into the
  // issue-backed exception above when one exists (see `unknownRow`) and
  // otherwise reported nowhere here — a sentinel-bucket count with no issue
  // row behind it is a backend data gap, not something for the client to
  // invent an exception for.
  for (const item of orderedLineItems(shipment.line_items)) {
    const expected = item.expected_quantity ?? 0;
    const actual = item.actual_quantity ?? 0;
    const delta = actual - expected;
    const issueType = item.issue?.issue_type;

    if (item.issue && (issueType === 'overage' || issueType === 'shortage')) {
      const storedIssue = item.issue;
      const type = issueType;
      const open = OPEN_STATUSES.includes(storedIssue.status);
      const blocks = type === 'shortage' && open && !options.autoCompleted;

      push({
        key: `issue:${storedIssue.id}`,
        type,
        status: storedIssue.status,
        severity: !open ? 'info' : blocks ? 'blocking' : 'warning',
        title: copy.titles[type],
        description: `${item.name || item.sku}: expected ${expected}, counted ${actual} ` +
          `(${delta > 0 ? '+' : ''}${delta}).`,
        resolutions: resolutionsFor(type, copy),
        blocksCompletion: blocks,
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

function severityFor(type: ExceptionType, status: IssueStatus): ExceptionSeverity {
  if (!OPEN_STATUSES.includes(status)) return 'info';
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
