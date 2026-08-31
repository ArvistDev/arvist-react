'use client';

import * as React from 'react';
import type { ReconciledLine, Reconciliation } from '../../core/reconcile';
import { cn } from '../cn';
import { createSlots, type StyleableProps } from '../slots';

export type ReconciliationTableSlot =
  | 'root' | 'scroll' | 'table' | 'caption' | 'head' | 'headCell' | 'body' | 'row' | 'cell'
  | 'name' | 'sku' | 'flag' | 'barcode' | 'delta' | 'footer' | 'total' | 'offOrder';

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

/**
 * Expected versus counted, per line.
 *
 * Off-order items are listed separately below rather than mixed into the order
 * lines — they have no expected quantity, so showing them as a variance against
 * zero reads as an overage when it is a different problem entirely.
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

  const headCell = (extra?: string) => slot('headCell', 'arvist-recon__head-cell', extra);
  const cell = (extra?: string) => slot('cell', 'arvist-recon__cell', extra);
  const num = 'arvist-recon__num';

  const deltaText = (line: ReconciledLine) =>
    line.delta > 0 ? `+${line.delta}` : line.delta === 0 ? '—' : String(line.delta);

  return (
    <div className={cn(slot('root', 'arvist-root'), className)}>
      <div className={slot('scroll', 'arvist-scroll-x')}>
        <table className={slot('table', 'arvist-recon__table')}>
          {!final ? (
            <caption className={slot('caption', 'arvist-recon__caption')}>
              Provisional — counts are final only once the inspection completes.
            </caption>
          ) : null}
          <thead className={slot('head', 'arvist-recon__head')}>
            <tr>
              <th scope="col" className={headCell()}>Item</th>
              {showBarcode ? <th scope="col" className={headCell()}>Barcode</th> : null}
              <th scope="col" className={headCell(num)}>Expected</th>
              <th scope="col" className={headCell(num)}>Counted</th>
              <th scope="col" className={headCell(num)}>Δ</th>
            </tr>
          </thead>
          <tbody className={slot('body')}>
            {rows.map((line) => (
              <tr
                key={line.item.id ?? line.item.sku}
                data-variance={line.variance}
                className={slot('row', 'arvist-recon__row', `arvist-recon__row--${line.variance}`)}
              >
                <td className={cell()}>
                  <span className={slot('name', 'arvist-recon__name')}>
                    {line.item.name || line.item.sku}
                  </span>
                  <span className={slot('sku', 'arvist-recon__sku')}>
                    {line.item.sku}
                    {line.manuallyCorrected ? (
                      <span className={slot('flag', 'arvist-recon__flag')}>hand-corrected</span>
                    ) : null}
                  </span>
                </td>
                {showBarcode ? (
                  <td className={cell(slot('barcode', 'arvist-recon__barcode'))}>
                    {line.barcode ?? '—'}
                  </td>
                ) : null}
                <td className={cell(num)}>{line.expected}</td>
                <td className={cell(num)}>{line.actual}</td>
                <td
                  className={cell(
                    cn(num, slot('delta', `arvist-recon__delta--${line.variance}`)),
                  )}
                >
                  {deltaText(line)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className={slot('footer', 'arvist-recon__footer')}>
            <tr>
              <td className={cell()} colSpan={showBarcode ? 2 : 1}>
                {counts.matched}/{lines.length} matched
              </td>
              <td className={cell(num)}>{totals.expected}</td>
              <td className={cell(num)}>{totals.actual}</td>
              <td
                className={cell(
                  cn(
                    num,
                    slot(
                      'total',
                      totals.delta === 0
                        ? 'arvist-recon__total--balanced'
                        : 'arvist-recon__total--unbalanced',
                    ),
                  ),
                )}
              >
                {totals.delta > 0 ? `+${totals.delta}` : totals.delta}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {offOrder.length > 0 ? (
        <div className={slot('offOrder', 'arvist-recon__off-order')}>
          <p className="arvist-recon__off-order-title">Not on this order</p>
          <ul className="arvist-recon__off-order-list">
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
