import { describe, expect, it } from 'vitest';
import {
  buildBarcodeIndex,
  checkCompletion,
  getLineItemBarcode,
  normalizeBarcode,
  reconcile,
  upcCoverage,
} from '../core/reconcile';
import type { LineItem, Shipment, ShipmentIssue } from '../core/types';

const issue = (over: Partial<ShipmentIssue> = {}): ShipmentIssue => ({
  id: 9,
  issue_type: 'shortage',
  status: 'open',
  created_at: '2026-08-18T10:00:00Z',
  updated_at: '2026-08-18T10:00:00Z',
  ...over,
});

const line = (over: Partial<LineItem> = {}): LineItem => ({
  name: 'Widget',
  sku: 'SKU-1',
  product_id: 'P1',
  expected_quantity: 10,
  actual_quantity: 10,
  ...over,
});

const shipment = (items: LineItem[]): Pick<Shipment, 'line_items' | 'units' | 'status'> => ({
  line_items: items,
  status: 'in_progress',
});

describe('getLineItemBarcode', () => {
  it('prefers the UPC in additional_data', () => {
    expect(getLineItemBarcode(line({ additional_data: { upc: '012345678905' } }))).toBe('012345678905');
  });

  it('accepts a numeric UPC', () => {
    expect(getLineItemBarcode(line({ additional_data: { upc: 12345678 } }))).toBe('12345678');
  });

  it('falls back to the SKU when the UPC is missing or blank', () => {
    expect(getLineItemBarcode(line({ additional_data: null }))).toBe('SKU-1');
    expect(getLineItemBarcode(line({ additional_data: { upc: '  ' } }))).toBe('SKU-1');
  });
});

describe('normalizeBarcode', () => {
  it('strips leading zeros from numeric codes so UPC-A matches EAN-13', () => {
    expect(normalizeBarcode('0012345678905')).toBe('12345678905');
    expect(normalizeBarcode('012345678905')).toBe(normalizeBarcode('0012345678905'));
  });

  it('upper-cases and trims alphanumeric codes without touching zeros', () => {
    expect(normalizeBarcode(' sku-0a1 ')).toBe('SKU-0A1');
  });
});

describe('buildBarcodeIndex', () => {
  it('indexes by both UPC and SKU, and skips off-order rows', () => {
    const index = buildBarcodeIndex([
      line({ sku: 'SKU-1', additional_data: { upc: '012345678905' } }),
      line({ sku: 'unknown', expected_quantity: 0, actual_quantity: 2 }),
    ]);
    expect(index.get(normalizeBarcode('012345678905'))?.sku).toBe('SKU-1');
    expect(index.get('SKU-1')?.sku).toBe('SKU-1');
    expect(index.get('UNKNOWN')).toBeUndefined();
  });
});

describe('upcCoverage', () => {
  it('reports how many ordered lines actually carry a UPC', () => {
    const coverage = upcCoverage([
      line({ sku: 'A', additional_data: { upc: '1' } }),
      line({ sku: 'B' }),
      line({ sku: 'unknown', expected_quantity: 0, actual_quantity: 1 }),
    ]);
    expect(coverage.total).toBe(2);
    expect(coverage.withUpc).toBe(1);
    expect(coverage.ratio).toBe(0.5);
    expect(coverage.missing.map((i) => i.sku)).toEqual(['B']);
  });

  it('treats an empty order as fully covered rather than dividing by zero', () => {
    expect(upcCoverage([]).ratio).toBe(1);
  });
});

describe('reconcile', () => {
  it('classifies each line and totals them', () => {
    const result = reconcile(
      shipment([
        line({ sku: 'A', expected_quantity: 10, actual_quantity: 10 }),
        line({ sku: 'B', expected_quantity: 5, actual_quantity: 7 }),
        line({ sku: 'C', expected_quantity: 4, actual_quantity: 1 }),
      ]),
    );
    expect(result.counts).toMatchObject({ matched: 1, over: 1, short: 1 });
    expect(result.totals).toEqual({ expected: 19, actual: 18, delta: -1 });
    expect(result.isClean).toBe(false);
  });

  it('separates off-order items from ordered lines', () => {
    const result = reconcile(
      shipment([
        line({ sku: 'A' }),
        line({ sku: 'wrong', expected_quantity: 0, actual_quantity: 2 }),
        line({ sku: 'unknown', expected_quantity: 0, actual_quantity: 1 }),
      ]),
    );
    expect(result.lines).toHaveLength(1);
    expect(result.offOrder.map((o) => o.sku).sort()).toEqual(['unknown', 'wrong']);
    expect(result.isClean).toBe(false);
  });

  it('is clean when every line matches and nothing is off-order', () => {
    expect(reconcile(shipment([line()])).isClean).toBe(true);
  });

  it('tolerates an undefined shipment', () => {
    const result = reconcile(undefined);
    expect(result.lines).toEqual([]);
    expect(result.isClean).toBe(true);
  });
});

describe('checkCompletion', () => {
  it('blocks on an open, real shortage issue', () => {
    const openShortage = issue({ issue_type: 'shortage', shipment_data_id: 1 });
    const result = checkCompletion(shipment([line({ id: 1, actual_quantity: 3, issue: openShortage })]));
    expect(result.canComplete).toBe(false);
    expect(result.blockers).toHaveLength(1);
    expect(result.reason).toMatch(/must be resolved/);
  });

  it('does not block on quantity math alone — no shortage exists until the API creates one', () => {
    const result = checkCompletion(shipment([line({ actual_quantity: 3 })]));
    expect(result.canComplete).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it('allows completion when the shipment is auto-completed upstream', () => {
    const openShortage = issue({ issue_type: 'shortage', shipment_data_id: 1 });
    const result = checkCompletion(
      shipment([line({ id: 1, actual_quantity: 3, issue: openShortage })]),
      { autoCompleted: true },
    );
    expect(result.canComplete).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });

  it('treats an overage issue as a warning, not a blocker', () => {
    const openOverage = issue({ issue_type: 'overage', shipment_data_id: 1 });
    const result = checkCompletion(shipment([line({ id: 1, actual_quantity: 12, issue: openOverage })]));
    expect(result.canComplete).toBe(true);
    expect(result.warnings.map((w) => w.type)).toEqual(['overage']);
  });

  it('blocks on an open shortage issue regardless of shipment status', () => {
    const openShortage = issue({ issue_type: 'shortage', shipment_data_id: 1 });
    const result = checkCompletion({
      line_items: [line({ id: 1, actual_quantity: 0, issue: openShortage })],
      status: 'in_progress',
    });
    expect(result.canComplete).toBe(false);
    expect(result.blockers[0]!.type).toBe('shortage');
  });

  it('allows completion on a clean shipment', () => {
    const result = checkCompletion(shipment([line()]));
    expect(result.canComplete).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.reason).toBeUndefined();
  });
});
