'use client';

import * as React from 'react';
import type { Reconciliation, ReconciledLine } from '../../core/reconcile';
import { cn } from '../cn';
import { createSlots, type StyleableProps } from '../slots';

export type ReconciliationTableSlot =
  | 'root' | 'table' | 'head' | 'headCell' | 'body' | 'row' | 'cell'
  | 'sku' | 'delta' | 'flag' | 'footer' | 'offOrder' | 'caption';

export interface ReconciliationTableProps extends StyleableProps<ReconciliationTableSlot> {
  reconciliation: Reconciliation;
  /**
   * Counts before `completed` are provisional. Leave `false` while an
   * inspection is running so the table says so rather than implying finality.
   */
  final?: boolean;
  /** Hide rows where expected and actual already match. */
  variancesOnly?: boolean;
  /** Show the barcode used for scan matching. */
  showBarcode?: boolean;
}

const VARIANCE_STYLES: Record<ReconciledLine['variance'], string> = {
  match: 'text-arvist-text-muted',
  over: 'text-arvist-warning font-semibold',
  short: 'text-arvist-blocking font-semibold',
};

/**
 * Expected versus counted, per line.
 *
 * Off-order items are listed separately at the bottom rather than mixed into
 * the order lines — they have no expected quantity, so showing them as a
 * variance against zero reads as an overage when it is a different problem.
 */
export function ReconciliationTable({
  reconciliation,
  final = false,
  variancesOnly = false,
  showBarcode = false,
  className,
  classNames,
  unstyled,
}: ReconciliationTableProps) {
  const slot = createSlots<ReconciliationTableSlot>({ classNames, unstyled });
  const { lines, offOrder, totals, counts } = reconciliation;

  const rows = React.useMemo(
    () => (variancesOnly ? lines.filter((l) => l.variance !== 'match') : lines),
    [lines, variancesOnly],
  );

  const headCell = slot(
    'headCell',
    'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-arvist-text-muted',
  );
  const cell = slot('cell', 'px-3 py-2 text-sm');

  return (
    <div className={cn(slot('root', 'arvist-root text-arvist-text'), className)}>
      <div className="overflow-x-auto">
        <table className={slot('table', 'w-full border-collapse')}>
          {!final ? (
            <caption className={slot('caption', 'caption-bottom pt-2 text-xs text-arvist-text-muted')}>
              Provisional — counts are final only once the inspection completes.
            </caption>
          ) : null}
          <thead className={slot('head', 'border-b border-arvist-border')}>
            <tr>
              <th className={headCell}>Item</th>
              {showBarcode ? <th className={headCell}>Barcode</th> : null}
              <th className={cn(headCell, 'text-right')}>Expected</th>
              <th className={cn(headCell, 'text-right')}>Counted</th>
              <th className={cn(headCell, 'text-right')}>Δ</th>
            </tr>
          </thead>
          <tbody className={slot('body', 'divide-y divide-arvist-border')}>
            {rows.map((line) => (
              <tr
                key={line.item.id ?? line.item.sku}
                data-variance={line.variance}
                className={slot('row', line.variance !== 'match' ? 'bg-arvist-surface-muted' : '')}
              >
                <td className={cell}>
                  <span className="block truncate">{line.item.name || line.item.sku}</span>
                  <span className={slot('sku', 'block text-xs text-arvist-text-muted')}>
                    {line.item.sku}
                    {line.manuallyCorrected ? (
                      <span className={slot('flag', 'ml-2 text-arvist-info')}>hand-corrected</span>
                    ) : null}
                  </span>
                </td>
                {showBarcode ? (
                  <td className={cn(cell, 'font-mono text-xs text-arvist-text-muted')}>
                    {line.barcode ?? '—'}
                  </td>
                ) : null}
                <td className={cn(cell, 'text-right tabular-nums')}>{line.expected}</td>
                <td className={cn(cell, 'text-right tabular-nums')}>{line.actual}</td>
                <td
                  className={cn(
                    cell,
                    'text-right tabular-nums',
                    slot('delta', VARIANCE_STYLES[line.variance]),
                  )}
                >
                  {line.delta > 0 ? `+${line.delta}` : line.delta === 0 ? '—' : line.delta}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className={slot('footer', 'border-t border-arvist-border font-medium')}>
            <tr>
              <td className={cell} colSpan={showBarcode ? 2 : 1}>
                {counts.matched}/{lines.length} matched
              </td>
              <td className={cn(cell, 'text-right tabular-nums')}>{totals.expected}</td>
              <td className={cn(cell, 'text-right tabular-nums')}>{totals.actual}</td>
              <td
                className={cn(
                  cell,
                  'text-right tabular-nums',
                  totals.delta === 0 ? 'text-arvist-ok' : 'text-arvist-warning',
                )}
              >
                {totals.delta > 0 ? `+${totals.delta}` : totals.delta}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {offOrder.length > 0 ? (
        <div
          className={slot(
            'offOrder',
            'mt-3 rounded-[--radius-arvist] border border-arvist-warning/40',
            'bg-arvist-warning-surface px-3 py-2 text-sm',
          )}
        >
          <p className="font-medium">Not on this order</p>
          <ul className="mt-1 space-y-0.5 text-arvist-text-muted">
            {offOrder.map((entry) => (
              <li key={entry.sku}>
                {entry.quantity} ×{' '}
                {entry.sku === 'wrong' ? 'item(s) from another order' : 'unidentified item(s)'}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
