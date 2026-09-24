/**
 * Reconciliation and completion gating.
 *
 * `completed` from the realtime feed carries final counts, and the rule for
 * reading them is always the same: compare `expected_quantity` against
 * `actual_quantity` per line, and treat sentinel-SKU rows as off-order. This
 * module implements that once so every integration reads the numbers the same
 * way.
 */

import { deriveExceptions, isExceptionOpen, isSentinelLineItem, orderedLineItems, type DeriveOptions, type NormalizedException } from './exceptions';
import type { LineItem, Shipment } from './types';

// ---------------------------------------------------------------------------
// Barcodes
// ---------------------------------------------------------------------------

/**
 * The scannable barcode for a line item.
 *
 * Convention is `additional_data.upc`, falling back to the SKU. Upstream
 * systems do not always populate the UPC, so the fallback is load-bearing —
 * never assume the first key is present.
 */
export function getLineItemBarcode(item: LineItem): string | undefined {
  const upc = item.additional_data?.['upc'];
  if (typeof upc === 'string' && upc.trim()) return upc.trim();
  if (typeof upc === 'number') return String(upc);
  return item.sku?.trim() || undefined;
}

/** Index of barcode → line item, for wedge-scanner lookups. */
export function buildBarcodeIndex(items: LineItem[] | undefined): Map<string, LineItem> {
  const index = new Map<string, LineItem>();
  for (const item of items ?? []) {
    if (isSentinelLineItem(item)) continue;
    const code = getLineItemBarcode(item);
    if (code) index.set(normalizeBarcode(code), item);
    if (item.sku) index.set(normalizeBarcode(item.sku), item);
  }
  return index;
}

/** Strips whitespace and leading zeros so UPC-A and EAN-13 forms match. */
export function normalizeBarcode(code: string): string {
  const trimmed = code.trim().toUpperCase();
  return /^\d+$/.test(trimmed) ? trimmed.replace(/^0+(?=\d)/, '') : trimmed;
}

/** How many line items are missing a real UPC — a useful data-quality signal. */
export function upcCoverage(items: LineItem[] | undefined): {
  total: number;
  withUpc: number;
  ratio: number;
  missing: LineItem[];
} {
  const ordered = orderedLineItems(items);
  const missing = ordered.filter((i) => {
    const upc = i.additional_data?.['upc'];
    return !(typeof upc === 'string' && upc.trim()) && typeof upc !== 'number';
  });
  const withUpc = ordered.length - missing.length;
  return {
    total: ordered.length,
    withUpc,
    ratio: ordered.length === 0 ? 1 : withUpc / ordered.length,
    missing,
  };
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export type LineVariance = 'match' | 'over' | 'short';

export interface ReconciledLine {
  item: LineItem;
  expected: number;
  actual: number;
  delta: number;
  variance: LineVariance;
  /** `true` when an operator overrode the counted quantity. */
  manuallyCorrected: boolean;
  barcode?: string;
}

export interface Reconciliation {
  lines: ReconciledLine[];
  /** Counted items that are not on the order, keyed by their sentinel SKU. */
  offOrder: { sku: 'unknown' | 'wrong'; item: LineItem; quantity: number }[];
  totals: { expected: number; actual: number; delta: number };
  counts: { matched: number; over: number; short: number; manuallyCorrected: number };
  /** `true` when every ordered line matches and nothing is off-order. */
  isClean: boolean;
}

/**
 * Reconciles a shipment's line items. Safe to call on a provisional shipment,
 * but only the `completed` payload carries final counts — anything earlier can
 * still change.
 */
export function reconcile(shipment: Pick<Shipment, 'line_items'> | undefined): Reconciliation {
  const all = shipment?.line_items ?? [];

  const lines: ReconciledLine[] = orderedLineItems(all).map((item) => {
    const expected = item.expected_quantity ?? 0;
    const actual = item.actual_quantity ?? 0;
    const delta = actual - expected;
    return {
      item,
      expected,
      actual,
      delta,
      variance: delta === 0 ? 'match' : delta > 0 ? 'over' : 'short',
      manuallyCorrected: item.is_edited === true,
      barcode: getLineItemBarcode(item),
    };
  });

  const offOrder = all
    .filter((i) => isSentinelLineItem(i) && (i.actual_quantity ?? 0) > 0)
    .map((item) => ({
      sku: item.sku.toLowerCase().trim() as 'unknown' | 'wrong',
      item,
      quantity: item.actual_quantity ?? 0,
    }));

  const totals = lines.reduce(
    (acc, l) => ({
      expected: acc.expected + l.expected,
      actual: acc.actual + l.actual,
      delta: acc.delta + l.delta,
    }),
    { expected: 0, actual: 0, delta: 0 },
  );

  const counts = {
    matched: lines.filter((l) => l.variance === 'match').length,
    over: lines.filter((l) => l.variance === 'over').length,
    short: lines.filter((l) => l.variance === 'short').length,
    manuallyCorrected: lines.filter((l) => l.manuallyCorrected).length,
  };

  return {
    lines,
    offOrder,
    totals,
    counts,
    isClean: counts.over === 0 && counts.short === 0 && offOrder.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Completion gating
// ---------------------------------------------------------------------------

export interface CompletionCheck {
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
export function checkCompletion(
  shipment: Pick<Shipment, 'line_items' | 'units' | 'status'> | undefined,
  options: DeriveOptions = {},
): CompletionCheck {
  const open = deriveExceptions(shipment, options).filter(isExceptionOpen);
  const blockers = open.filter((e) => e.blocksCompletion);
  const warnings = open.filter((e) => !e.blocksCompletion);

  return {
    canComplete: blockers.length === 0,
    blockers,
    warnings,
    reason: blockers.length
      ? `${blockers.length} exception(s) must be resolved before completing.`
      : undefined,
  };
}
