import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_EXCEPTION_COPY,
  resolutionsFor,
  type NormalizedException,
} from '../core/exceptions';
import { reconcile } from '../core/reconcile';
import type { LineItem } from '../core/types';
import { cn } from '../ui/cn';
import { ExceptionCard } from '../ui/components/exception-card';
import { ExceptionList } from '../ui/components/exception-list';
import { InspectionStatus } from '../ui/components/inspection-status';
import { MediaGallery } from '../ui/components/media-gallery';
import { ReconciliationTable } from '../ui/components/reconciliation-table';
import { StationStatus } from '../ui/components/station-status';

afterEach(cleanup);

function exception(over: Partial<NormalizedException> = {}): NormalizedException {
  const type = over.type ?? 'shortage';
  return {
    key: 'issue:1',
    status: 'open',
    severity: 'blocking',
    title: DEFAULT_EXCEPTION_COPY.titles[type],
    description: 'Mug: expected 4, counted 2 (-2).',
    blocksCompletion: true,
    palletOnly: false,
    ...over,
    type,
    // Derived from the final type so a fixture can never offer resolutions
    // that belong to a different exception.
    resolutions: over.resolutions ?? resolutionsFor(type, DEFAULT_EXCEPTION_COPY),
  };
}

const line = (over: Partial<LineItem> = {}): LineItem => ({
  name: 'Widget',
  sku: 'SKU-1',
  product_id: 'P1',
  expected_quantity: 10,
  actual_quantity: 10,
  ...over,
});

describe('cn', () => {
  it('joins strings and drops falsy values', () => {
    expect(cn('a', null, undefined, false, '', 'b')).toBe('a b');
  });

  it('accepts conditional objects and nested arrays', () => {
    expect(cn(['a', ['b']], { c: true, d: false })).toBe('a b c');
  });

  it('returns an empty string for nothing', () => {
    expect(cn()).toBe('');
  });
});

describe('ExceptionCard', () => {
  it('renders the title, description and blocking notice', () => {
    render(<ExceptionCard exception={exception()} />);
    expect(screen.getByText('Shortage Detected')).toBeTruthy();
    expect(screen.getByText(/expected 4, counted 2/)).toBeTruthy();
    expect(screen.getByText(/Blocks completion/)).toBeTruthy();
  });

  it('exposes type, severity and status as data attributes for host styling', () => {
    const { container } = render(<ExceptionCard exception={exception()} />);
    const root = container.querySelector('article')!;
    expect(root.getAttribute('data-exception-type')).toBe('shortage');
    expect(root.getAttribute('data-severity')).toBe('blocking');
    expect(root.getAttribute('data-status')).toBe('open');
  });

  it('renders one button per resolution and reports which was picked', async () => {
    const onResolve = vi.fn();
    render(<ExceptionCard exception={exception()} onResolve={onResolve} />);

    fireEvent.click(screen.getByRole('button', { name: /Missing Product Added/ }));
    await waitFor(() => expect(onResolve).toHaveBeenCalled());
    expect(onResolve.mock.calls[0]![0].action).toBe('locate_stock');
  });

  it('asks for a reason before submitting a resolution that requires one', async () => {
    // `shortage` dropped `mark_unresolved` (no backend action for it) — use
    // `damage`, which still resolves through the older status-write endpoint
    // and keeps the generic "escalate with a reason" option.
    const onResolve = vi.fn();
    render(<ExceptionCard exception={exception({ type: 'damage' })} onResolve={onResolve} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cannot resolve' }));
    // First click reveals the field rather than submitting an empty reason.
    await waitFor(() => expect(screen.getByRole('textbox')).toBeTruthy());
    expect(onResolve).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Stock not on site' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cannot resolve' }));

    await waitFor(() => expect(onResolve).toHaveBeenCalled());
    expect(onResolve.mock.calls[0]![1]).toBe('Stock not on site');
  });

  it('surfaces a rejected resolution instead of swallowing it', async () => {
    const onResolve = vi.fn().mockRejectedValue(new Error('Issue already closed'));
    render(<ExceptionCard exception={exception()} onResolve={onResolve} />);

    fireEvent.click(screen.getByRole('button', { name: /Missing Product Added/ }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Issue already closed'));
  });

  it('hides actions on a closed exception', () => {
    render(<ExceptionCard exception={exception({ status: 'resolved' })} onResolve={vi.fn()} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Resolved')).toBeTruthy();
  });

  it('hides actions in read-only mode', () => {
    render(<ExceptionCard exception={exception()} onResolve={vi.fn()} readOnly />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('disables actions while busy', () => {
    render(<ExceptionCard exception={exception()} onResolve={vi.fn()} busy />);
    for (const button of screen.getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('marks pallet-only exceptions', () => {
    render(<ExceptionCard exception={exception({ type: 'wrong_load', palletOnly: true })} />);
    expect(screen.getByText('pallet')).toBeTruthy();
  });

  it('drops built-in classes under `unstyled` but keeps structure and slots', () => {
    const { container } = render(
      <ExceptionCard exception={exception()} unstyled classNames={{ title: 'mine' }} />,
    );
    const root = container.querySelector('article')!;
    expect(root.className).not.toContain('arvist-exception');
    expect(container.querySelector('.mine')).toBeTruthy();
    // Structure survives.
    expect(screen.getByText('Shortage Detected')).toBeTruthy();
  });

  it('appends caller classes alongside the defaults', () => {
    const { container } = render(<ExceptionCard exception={exception()} className="mine" />);
    const root = container.querySelector('article')!;
    expect(root.className).toContain('arvist-exception');
    expect(root.className).toContain('mine');
  });
});

describe('ExceptionList', () => {
  const blocking = exception({ key: 'a' });
  const warning = exception({
    key: 'b',
    type: 'overage',
    severity: 'warning',
    blocksCompletion: false,
  });

  it('shows the empty state when there is nothing to report', () => {
    render(<ExceptionList exceptions={[]} />);
    expect(screen.getByText(/This inspection is clean/)).toBeTruthy();
  });

  it('accepts a custom empty state', () => {
    render(<ExceptionList exceptions={[]} emptyState="All good" />);
    expect(screen.getByText('All good')).toBeTruthy();
  });

  it('summarises the counts, calling out blockers', () => {
    render(<ExceptionList exceptions={[blocking, warning]} />);
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('1 blocking')).toBeTruthy();
  });

  it('groups blockers above everything else', () => {
    render(<ExceptionList exceptions={[warning, blocking]} />);
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Must resolve', 'Also flagged']);
  });

  it('skips grouping when nothing is blocking', () => {
    render(<ExceptionList exceptions={[warning]} />);
    expect(screen.queryByText('Must resolve')).toBeNull();
  });

  it('filters closed exceptions with openOnly', () => {
    render(
      <ExceptionList exceptions={[blocking, exception({ key: 'c', status: 'resolved' })]} openOnly />,
    );
    expect(screen.getAllByRole('article').length).toBe(1);
  });

  it('routes a resolution back with the exception it belongs to', async () => {
    const onResolve = vi.fn();
    render(<ExceptionList exceptions={[warning]} onResolve={onResolve} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Product' }));
    await waitFor(() => expect(onResolve).toHaveBeenCalled());
    expect(onResolve.mock.calls[0]![0].key).toBe('b');
    expect(onResolve.mock.calls[0]![1].action).toBe('remove_item');
  });

  it('lets the host render its own card', () => {
    render(
      <ExceptionList
        exceptions={[blocking]}
        renderException={(p) => <div data-testid="custom">{p.exception.title}</div>}
      />,
    );
    expect(screen.getByTestId('custom').textContent).toBe('Shortage Detected');
  });
});

describe('ReconciliationTable', () => {
  const recon = reconcile({
    line_items: [
      line({ sku: 'A', name: 'Alpha', expected_quantity: 3, actual_quantity: 3 }),
      line({ sku: 'B', name: 'Bravo', expected_quantity: 4, actual_quantity: 2 }),
      line({ sku: 'wrong', expected_quantity: 0, actual_quantity: 1 }),
    ],
  });

  it('warns that counts are provisional until the inspection completes', () => {
    render(<ReconciliationTable reconciliation={recon} />);
    expect(screen.getByText(/Provisional/)).toBeTruthy();
  });

  it('drops the warning once counts are final', () => {
    render(<ReconciliationTable reconciliation={recon} final />);
    expect(screen.queryByText(/Provisional/)).toBeNull();
  });

  it('renders a row per ordered line and tags its variance', () => {
    const { container } = render(<ReconciliationTable reconciliation={recon} />);
    const variances = [...container.querySelectorAll('tbody tr')].map((r) =>
      r.getAttribute('data-variance'),
    );
    expect(variances).toEqual(['match', 'short']);
  });

  it('lists off-order items separately from the order lines', () => {
    render(<ReconciliationTable reconciliation={recon} />);
    expect(screen.getByText('Not on this order')).toBeTruthy();
    expect(screen.getByText(/item\(s\) from another order/)).toBeTruthy();
  });

  it('totals the ordered lines only', () => {
    const { container } = render(<ReconciliationTable reconciliation={recon} />);
    const footer = container.querySelector('tfoot')!.textContent!;
    expect(footer).toContain('1/2 matched');
    expect(footer).toContain('7'); // expected 3 + 4
    expect(footer).toContain('-2');
  });

  it('hides matching rows with variancesOnly', () => {
    const { container } = render(<ReconciliationTable reconciliation={recon} variancesOnly />);
    expect(container.querySelectorAll('tbody tr').length).toBe(1);
  });

  it('shows the barcode column on request, falling back to SKU', () => {
    const withUpc = reconcile({
      line_items: [line({ sku: 'A', additional_data: { upc: '036000291452' } }), line({ sku: 'B' })],
    });
    render(<ReconciliationTable reconciliation={withUpc} showBarcode />);
    expect(screen.getByText('036000291452')).toBeTruthy();
    expect(screen.getAllByText('B').length).toBeGreaterThan(0);
  });

  it('flags a hand-corrected count', () => {
    const edited = reconcile({ line_items: [line({ is_edited: true })] });
    render(<ReconciliationTable reconciliation={edited} />);
    expect(screen.getByText('hand-corrected')).toBeTruthy();
  });
});

describe('InspectionStatus', () => {
  it('labels the phase and exposes it as a data attribute', () => {
    const { container } = render(<InspectionStatus phase="in_progress" />);
    expect(screen.getByText('Inspecting')).toBeTruthy();
    expect(container.querySelector('[data-phase="in_progress"]')).toBeTruthy();
  });

  it('shows the connection state, so a dead socket is distinguishable from a quiet station', () => {
    render(<InspectionStatus phase="in_progress" connection="reconnecting" />);
    expect(screen.getByText('Reconnecting…')).toBeTruthy();
  });

  it('can hide the connection indicator', () => {
    render(<InspectionStatus phase="idle" connection="connected" hideConnection />);
    expect(screen.queryByText('Live')).toBeNull();
  });

  it('renders an accessible progress bar', () => {
    render(<InspectionStatus phase="in_progress" progress={0.5} />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('50');
    expect(screen.getByText('50%')).toBeTruthy();
  });

  it('omits progress when the total is not yet known', () => {
    render(<InspectionStatus phase="in_progress" progress={null} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('clamps out-of-range progress rather than overflowing the bar', () => {
    render(<InspectionStatus phase="completed" progress={1.4} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
  });
});

describe('StationStatus', () => {
  const base = { loading: false, error: undefined, refresh: async () => {} };
  const station = { id: 1, name: 'PS 1', area_id: 42, area_name: 'Z01-PS-001' };

  it('reports a ready station', () => {
    render(
      <StationStatus
        areaName="Z01-PS-001"
        station={station}
        resolved
        hasOpenInspection={false}
        {...base}
      />,
    );
    expect(screen.getByText('Ready')).toBeTruthy();
    expect(screen.getByText('Z01-PS-001')).toBeTruthy();
  });

  it('explains the silent failure when the station is not configured', () => {
    render(
      <StationStatus
        areaName="Z09-PS-999"
        station={undefined}
        resolved={false}
        hasOpenInspection={false}
        {...base}
      />,
    );
    expect(screen.getByText('Not configured')).toBeTruthy();
    expect(screen.getByText(/created but never opened/)).toBeTruthy();
  });

  it('warns when an inspection is already running', () => {
    render(
      <StationStatus areaName="Z01-PS-001" station={station} resolved hasOpenInspection {...base} />,
    );
    expect(screen.getByText('Inspection open')).toBeTruthy();
  });

  it('offers the action only when the station is unresolved', () => {
    const { rerender } = render(
      <StationStatus
        areaName="Z01"
        station={undefined}
        resolved={false}
        hasOpenInspection={false}
        action={<a href="/settings">Configure</a>}
        {...base}
      />,
    );
    expect(screen.getByText('Configure')).toBeTruthy();

    rerender(
      <StationStatus
        areaName="Z01"
        station={station}
        resolved
        hasOpenInspection={false}
        action={<a href="/settings">Configure</a>}
        {...base}
      />,
    );
    expect(screen.queryByText('Configure')).toBeNull();
  });
});

describe('MediaGallery', () => {
  const items = [
    { id: 1, side: 'front', url: 'https://e.com/1.jpg', unitSessionId: 1, damageCount: 2 },
    { id: 2, side: 'back', url: 'https://e.com/2.jpg', unitSessionId: 1, damageCount: 0 },
  ];

  it('shows the empty state with no media', () => {
    render(<MediaGallery items={[]} />);
    expect(screen.getByText(/No images captured yet/)).toBeTruthy();
  });

  it('renders an image per item with a readable side label', () => {
    render(<MediaGallery items={items} />);
    expect(screen.getByAltText('Front view')).toBeTruthy();
    expect(screen.getByAltText('Back view')).toBeTruthy();
  });

  it('badges damage findings', () => {
    render(<MediaGallery items={items} />);
    expect(screen.getByLabelText('2 damage finding(s)')).toBeTruthy();
  });

  it('offers a refresh when the links are going stale', () => {
    const onRefresh = vi.fn();
    render(<MediaGallery items={items} stale onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onRefresh).toHaveBeenCalled();
  });

  it('falls back to a placeholder when an expired URL fails to load', () => {
    render(<MediaGallery items={items} />);
    fireEvent.error(screen.getByAltText('Front view'));
    expect(screen.getByText('Link expired')).toBeTruthy();
  });

  it('treats a missing URL as already expired', () => {
    render(<MediaGallery items={[{ id: 3, side: 'top', unitSessionId: 1, damageCount: 0 }]} />);
    expect(screen.getByText('Link expired')).toBeTruthy();
  });

  it('only makes items interactive when a handler is given', () => {
    const { rerender } = render(<MediaGallery items={items} />);
    expect(screen.queryAllByRole('button').length).toBe(0);

    const onSelect = vi.fn();
    rerender(<MediaGallery items={items} onSelect={onSelect} />);
    fireEvent.click(screen.getAllByRole('button')[0]!);
    expect(onSelect).toHaveBeenCalledWith(items[0]);
  });
});
