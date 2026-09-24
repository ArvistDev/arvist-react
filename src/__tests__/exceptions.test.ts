import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXCEPTION_COPY,
  collectIssues,
  deriveExceptions,
  isSentinelLineItem,
  mergeRealtimeIssues,
  resolutionsFor,
  type ExceptionType,
} from '../core/exceptions';
import type { LineItem, Shipment, ShipmentIssue } from '../core/types';

function line(over: Partial<LineItem> = {}): LineItem {
  return {
    name: 'Widget',
    sku: 'SKU-1',
    product_id: 'P1',
    expected_quantity: 10,
    actual_quantity: 10,
    ...over,
  };
}

function issue(over: Partial<ShipmentIssue> = {}): ShipmentIssue {
  return {
    id: 1,
    issue_type: 'damage',
    status: 'open',
    created_at: '2026-08-18T10:00:00Z',
    updated_at: '2026-08-18T10:00:00Z',
    ...over,
  };
}

function shipment(over: Partial<Shipment> = {}): Shipment {
  return {
    id: 1,
    shipment_key: 'key-1',
    type: 'outbound',
    status: 'in_progress',
    site_id: 1,
    confidence: null,
    order_numbers: ['ORD-1'],
    supplier: 'ACME',
    created_at: '2026-08-18T10:00:00Z',
    updated_at: '2026-08-18T10:00:00Z',
    line_items: [],
    ...over,
  };
}

function withUnit(
  issues: ShipmentIssue[],
  type: 'pallet' | 'product' = 'pallet',
  over: Partial<Shipment> = {},
): Shipment {
  return shipment({
    units: [
      {
        id: 'unit-1',
        shipment_id: 1,
        type,
        created_at: '2026-08-18T10:00:00Z',
        updated_at: '2026-08-18T10:00:00Z',
        quality_sessions: [
          {
            id: 99,
            shipment_unit_id: 'unit-1',
            created_at: '2026-08-18T10:00:00Z',
            updated_at: '2026-08-18T10:00:00Z',
            issues,
          },
        ],
      },
    ],
    ...over,
  });
}

const typesOf = (s: Shipment, opts = {}) =>
  deriveExceptions(s, opts).map((e) => e.type as ExceptionType);

describe('sentinel line items', () => {
  it('recognises the off-order SKUs case-insensitively', () => {
    expect(isSentinelLineItem(line({ sku: 'unknown' }))).toBe(true);
    expect(isSentinelLineItem(line({ sku: 'WRONG' }))).toBe(true);
    expect(isSentinelLineItem(line({ sku: ' wrong ' }))).toBe(true);
    expect(isSentinelLineItem(line({ sku: 'SKU-1' }))).toBe(false);
  });
});

describe('deriveExceptions', () => {
  it('derives an overage from a line counted above expected', () => {
    const result = deriveExceptions(
      shipment({ line_items: [line({ expected_quantity: 5, actual_quantity: 8 })] }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('overage');
    expect(result[0]!.quantities).toEqual({ expected: 5, actual: 8, delta: 3 });
    expect(result[0]!.blocksCompletion).toBe(false);
  });

  it('derives a shortage and blocks completion once counting is done', () => {
    const [ex] = deriveExceptions(
      shipment({ status: 'review', line_items: [line({ expected_quantity: 10, actual_quantity: 4 })] }),
    );
    expect(ex!.type).toBe('shortage');
    expect(ex!.severity).toBe('blocking');
    expect(ex!.blocksCompletion).toBe(true);
  });

  it('stops a shortage blocking when the shipment is auto-completed upstream', () => {
    const [ex] = deriveExceptions(
      shipment({ status: 'review', line_items: [line({ actual_quantity: 4 })] }),
      { autoCompleted: true },
    );
    expect(ex!.type).toBe('shortage');
    expect(ex!.blocksCompletion).toBe(false);
    expect(ex!.severity).toBe('warning');
  });

  it('maps the `wrong` sentinel SKU to a wrong-product exception', () => {
    const types = typesOf(
      shipment({
        line_items: [line({ sku: 'wrong', expected_quantity: 0, actual_quantity: 2 })],
      }),
    );
    expect(types).toEqual(['wrong_product']);
  });

  it('maps the `unknown` sentinel SKU to an unidentified-product exception', () => {
    const types = typesOf(
      shipment({
        line_items: [line({ sku: 'unknown', expected_quantity: 0, actual_quantity: 1 })],
      }),
    );
    expect(types).toEqual(['unidentified_product']);
  });

  it('ignores sentinel rows that were never counted', () => {
    expect(
      typesOf(shipment({ line_items: [line({ sku: 'unknown', expected_quantity: 0, actual_quantity: 0 })] })),
    ).toEqual([]);
  });

  it('excludes sentinel rows from quantity variance', () => {
    // A `wrong` row with expected 0 must not also read as an overage.
    const types = typesOf(
      shipment({ line_items: [line({ sku: 'wrong', expected_quantity: 0, actual_quantity: 3 })] }),
    );
    expect(types).toEqual(['wrong_product']);
    expect(types).not.toContain('overage');
  });

  it('reports a hand-edited count even when the line reconciles', () => {
    const types = typesOf(
      shipment({ line_items: [line({ expected_quantity: 10, actual_quantity: 10, is_edited: true })] }),
    );
    expect(types).toEqual(['manual_count_correction']);
  });

  it('reports both the variance and the correction when an edited line still differs', () => {
    const types = typesOf(
      shipment({ line_items: [line({ expected_quantity: 10, actual_quantity: 12, is_edited: true })] }),
    );
    expect(types).toContain('overage');
    expect(types).toContain('manual_count_correction');
  });

  it('maps stored issue rows onto their exception types', () => {
    const types = typesOf(
      withUnit([
        issue({ id: 1, issue_type: 'unidentified_product' }),
        issue({ id: 2, issue_type: 'wrong_load' }),
        issue({ id: 3, issue_type: 'no_identifiers' }),
        issue({ id: 4, issue_type: 'damage' }),
        issue({ id: 5, issue_type: 'wrong_product', metadata: { annotation_id: 501 } }),
      ]),
    );
    expect(types).toContain('unidentified_product');
    expect(types).toContain('wrong_load');
    expect(types).toContain('missing_identifiers');
    expect(types).toContain('damage');
    expect(types).toContain('wrong_product');
  });

  it('keeps multiple instances of the same per-instance issue type', () => {
    // unidentified_product/wrong_product are one row per detected annotation —
    // unlike damage/wrong_load/no_identifiers, several can coexist per session.
    const types = typesOf(
      withUnit(
        [
          issue({ id: 1, issue_type: 'wrong_product', metadata: { annotation_id: 1 } }),
          issue({ id: 2, issue_type: 'wrong_product', metadata: { annotation_id: 2 } }),
        ],
        'product',
      ),
    );
    expect(types).toEqual(['wrong_product', 'wrong_product']);
  });

  it('derives overage/shortage from the line item\'s own stored issue when present', () => {
    const openOverage = issue({ id: 9, issue_type: 'overage', status: 'open', shipment_data_id: 1 });
    const result = deriveExceptions(
      shipment({ line_items: [line({ id: 1, expected_quantity: 5, actual_quantity: 8, issue: openOverage })] }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('overage');
    expect(result[0]!.issue).toBe(openOverage);
    expect(result[0]!.key).toBe('issue:9');
    // Issue-backed — resolving it is meaningful, so the actions are offered.
    expect(result[0]!.resolutions.length).toBeGreaterThan(0);
  });

  it('reports a resolved overage issue as closed even though the count still varies', () => {
    const resolvedOverage = issue({ id: 9, issue_type: 'overage', status: 'resolved', shipment_data_id: 1 });
    const [ex] = deriveExceptions(
      shipment({ line_items: [line({ id: 1, expected_quantity: 5, actual_quantity: 8, issue: resolvedOverage })] }),
    );
    expect(ex!.status).toBe('resolved');
    expect(ex!.blocksCompletion).toBe(false);
  });

  it('falls back to quantity math when no stored issue exists yet, and offers no resolutions', () => {
    const [ex] = deriveExceptions(
      shipment({ line_items: [line({ id: 1, expected_quantity: 5, actual_quantity: 8, issue: null })] }),
    );
    expect(ex!.type).toBe('overage');
    expect(ex!.issue).toBeUndefined();
    expect(ex!.status).toBe('open');
    // No issue row exists to resolve — offering buttons here would just fail
    // with "no issue row to resolve" the moment anyone clicked one. This is
    // also, concretely, every ordered line's state right after an inspection
    // starts and nothing has been counted yet (delta is never 0), so this
    // path is hit immediately, not just in some rare timing gap.
    expect(ex!.resolutions).toEqual([]);
  });

  it('reports a canceled wrong-load as a removed unit', () => {
    const types = typesOf(withUnit([issue({ issue_type: 'wrong_load', status: 'canceled' })]));
    expect(types).toEqual(['unit_removed']);
  });

  it('drops pallet-only exceptions for product inspections', () => {
    const types = typesOf(
      withUnit([issue({ issue_type: 'wrong_load' }), issue({ id: 2, issue_type: 'no_identifiers' })], 'product'),
    );
    expect(types).toEqual([]);
  });

  it('honours the exclude option', () => {
    const types = typesOf(
      shipment({ line_items: [line({ actual_quantity: 4 })] }),
      { exclude: ['shortage'] },
    );
    expect(types).toEqual([]);
  });

  it('sorts open before closed, and blocking first', () => {
    const result = deriveExceptions(
      withUnit([issue({ issue_type: 'damage', status: 'resolved' })], 'pallet', {
        status: 'review',
        line_items: [
          line({ sku: 'A', expected_quantity: 5, actual_quantity: 7 }),
          line({ sku: 'B', expected_quantity: 5, actual_quantity: 2 }),
        ],
      }),
    );
    expect(result[0]!.type).toBe('shortage');
    expect(result.at(-1)!.type).toBe('damage');
  });

  it('covers all nine operator-facing types', () => {
    const all: ExceptionType[] = [
      'unidentified_product', 'wrong_product', 'overage', 'shortage',
      'manual_count_correction', 'wrong_load', 'missing_identifiers',
      'unit_removed', 'damage',
    ];
    for (const type of all) {
      expect(resolutionsFor(type, DEFAULT_EXCEPTION_COPY).length).toBeGreaterThan(0);
      expect(DEFAULT_EXCEPTION_COPY.titles[type]).toBeTruthy();
    }
  });

  it('returns nothing for a clean shipment', () => {
    expect(deriveExceptions(shipment({ line_items: [line()] }))).toEqual([]);
  });

  it('tolerates an undefined shipment', () => {
    expect(deriveExceptions(undefined)).toEqual([]);
  });
});

describe('collectIssues', () => {
  it('keeps only the current session and the first row per session-scoped type', () => {
    // damage/wrong_load carry no annotation_id and are genuinely one-per-session.
    const s = withUnit([
      issue({ id: 1, issue_type: 'damage' }),
      issue({ id: 2, issue_type: 'damage' }),
      issue({ id: 3, issue_type: 'wrong_load' }),
    ]);
    const collected = collectIssues(s);
    expect(collected.map((i) => i.id)).toEqual([1, 3]);
    expect(collected[0]!.unit_id).toBe('unit-1');
    expect(collected[0]!.unit_session_id).toBe(99);
  });

  it('keeps every distinct instance of a per-instance type', () => {
    const s = withUnit([
      issue({ id: 1, issue_type: 'wrong_product', metadata: { annotation_id: 1 } }),
      issue({ id: 2, issue_type: 'wrong_product', metadata: { annotation_id: 2 } }),
    ]);
    expect(collectIssues(s).map((i) => i.id)).toEqual([1, 2]);
  });
});

describe('mergeRealtimeIssues', () => {
  it('folds feed issues into the shipment, keyed on `type`', () => {
    const merged = mergeRealtimeIssues(withUnit([]), {
      unit_id: 'unit-1',
      unit_session_id: 99,
      issues: [{ type: 'wrong_load', status: 'open' }],
    });
    expect(typesOf(merged as Shipment)).toEqual(['wrong_load']);
  });

  it('replaces rather than appends for a type already present', () => {
    const merged = mergeRealtimeIssues(withUnit([issue({ issue_type: 'damage', status: 'open' })]), {
      unit_id: 'unit-1',
      unit_session_id: 99,
      issues: [{ type: 'damage', status: 'resolved' }],
    });
    const damage = deriveExceptions(merged as Shipment).filter((e) => e.type === 'damage');
    expect(damage).toHaveLength(1);
    expect(damage[0]!.status).toBe('resolved');
  });

  it('is a no-op for an unknown unit', () => {
    const original = withUnit([]);
    const merged = mergeRealtimeIssues(original, {
      unit_id: 'other-unit',
      issues: [{ type: 'damage' }],
    });
    expect(typesOf(merged as Shipment)).toEqual([]);
  });
});

describe('provisional shortages', () => {
  // Counts climb from zero as units complete, so mid-inspection every uncounted
  // line looks short. Those are not exceptions yet.
  const shortLine = [line({ expected_quantity: 10, actual_quantity: 0 })];

  it('reports a mid-inspection shortage as provisional and non-blocking, with no resolutions', () => {
    // This is what shows up the instant an inspection starts and nothing has
    // been counted yet — every ordered line reads as short. It's purely a
    // client-side quantity-math artifact at this point (no `detectShortages`
    // row exists), so there's nothing real to resolve against yet.
    const [ex] = deriveExceptions(shipment({ status: 'in_progress', line_items: shortLine }));
    expect(ex!.type).toBe('shortage');
    expect(ex!.severity).toBe('info');
    expect(ex!.blocksCompletion).toBe(false);
    expect(ex!.description).toMatch(/still counting/);
    expect(ex!.resolutions).toEqual([]);
  });

  it('promotes it to blocking once the shipment reaches review', () => {
    const [ex] = deriveExceptions(shipment({ status: 'review', line_items: shortLine }));
    expect(ex!.severity).toBe('blocking');
    expect(ex!.blocksCompletion).toBe(true);
  });

  it('honours an explicit countsFinal over the status', () => {
    const [ex] = deriveExceptions(
      shipment({ status: 'in_progress', line_items: shortLine }),
      { countsFinal: true },
    );
    expect(ex!.blocksCompletion).toBe(true);
  });

  it('treats an overage as real immediately — counting more than ordered is not provisional', () => {
    const [ex] = deriveExceptions(
      shipment({ status: 'in_progress', line_items: [line({ expected_quantity: 2, actual_quantity: 5 })] }),
    );
    expect(ex!.type).toBe('overage');
    expect(ex!.severity).toBe('warning');
  });
});

describe('unidentified product is reported once', () => {
  // The API records an unidentified item twice — an issue row against the unit
  // and an `unknown` sentinel line carrying the count. That is one problem.
  const unknownLine = line({ sku: 'unknown', expected_quantity: 0, actual_quantity: 2 });

  it('folds the sentinel count into the issue-backed exception', () => {
    const result = deriveExceptions(
      withUnit([issue({ issue_type: 'unidentified_product' })], 'product', {
        line_items: [unknownLine],
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('unidentified_product');
    expect(result[0]!.quantities).toEqual({ expected: 0, actual: 2, delta: 2 });
    expect(result[0]!.description).toBe('2 item(s) could not be identified.');
    // Resolution still routes through the issue row.
    expect(result[0]!.unitSessionId).toBe(99);
    expect(result[0]!.lineItem?.sku).toBe('unknown');
    expect(result[0]!.resolutions.length).toBeGreaterThan(0);
  });

  it('still reports the sentinel row on its own when no issue row exists, with no resolutions', () => {
    const result = deriveExceptions(shipment({ line_items: [unknownLine] }));
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('unidentified_product');
    expect(result[0]!.issue).toBeUndefined();
    // No issue row backs a sentinel-only row — same "don't offer a button
    // guaranteed to fail" reasoning as the overage/shortage case.
    expect(result[0]!.resolutions).toEqual([]);
  });

  it('does not swallow a `wrong` row alongside an unidentified issue', () => {
    const types = typesOf(
      withUnit([issue({ issue_type: 'unidentified_product' })], 'product', {
        line_items: [unknownLine, line({ sku: 'wrong', expected_quantity: 0, actual_quantity: 1 })],
      }),
    );
    expect(types.sort()).toEqual(['unidentified_product', 'wrong_product']);
  });
});
