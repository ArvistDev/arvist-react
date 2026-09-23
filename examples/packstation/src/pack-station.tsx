import { useEffect, useState } from 'react';
import {
  getDisplayMessage,
  upcCoverage,
  useArvist,
  useExceptions,
  useInspection,
  useScanMatch,
  useShipmentMedia,
  useStationBinding,
} from '@arvist/react';
import {
  ExceptionList,
  InspectionStatus,
  MediaGallery,
  ReconciliationTable,
  StationStatus,
} from '@arvist/react/ui';
import '@arvist/react/styles.css';
import type { MockBackend } from './mock/backend';

const STATION_NAME = 'Z01-PS-001';

export interface PackStationProps {
  backend: MockBackend;
  live: boolean;
  autoCompleted: boolean;
  onAutoCompletedChange: (value: boolean) => void;
}

/**
 * The packstation screen: one station, one inspection at a time, exceptions
 * handled in place.
 *
 * Everything here is SDK state — this component owns no inspection logic of its
 * own, which is the point. Swapping the mock backend for a live URL changes
 * nothing below.
 */
export function PackStation({ backend, live, autoCompleted, onAutoCompletedChange }: PackStationProps) {
  const { resolveErrorMessage } = useArvist();

  // Poll the binding so a station that drops out of configuration is caught
  // before the next tote arrives rather than after it goes missing.
  const binding = useStationBinding(STATION_NAME, { pollMs: 30_000 });

  const inspection = useInspection({
    areaName: STATION_NAME,
    areaId: binding.station?.area_id,
    onCompleted: (shipment, reconciliation) => {
      // The reconciliation point. Counts before this are provisional.
      console.info('[completed]', shipment.shipment_key, reconciliation.totals);
    },
  });

  const exceptions = useExceptions(inspection.shipment, { onResolved: inspection.refresh });
  // Pass the shipment, not the id — media arrives unit by unit.
  const media = useShipmentMedia(inspection.shipment);

  const [toast, setToast] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => backend.onLog((line) => setLog((l) => [line, ...l].slice(0, 60))), [backend]);

  // A tote scan when nothing is open starts an inspection; a scan that matches
  // a line while one is running is just a confirmation beep.
  useScanMatch(inspection.shipment?.line_items, {
    enabled: inspection.phase !== 'starting',
    onMatch: (item) => setToast(`Matched ${item.name}`),
    onUnmatched: (scan) => {
      if (inspection.phase === 'idle') void startFromScan(scan.value);
      else setToast(`${scan.value} is not on this order`);
    },
  });

  const startFromScan = async (orderNumber: string) => {
    try {
      await inspection.start({ order_numbers: [orderNumber] });
    } catch (err) {
      setToast(getDisplayMessage(err, resolveErrorMessage));
    }
  };

  const complete = async () => {
    try {
      await inspection.finish();
      await inspection.submit();
    } catch (err) {
      setToast(getDisplayMessage(err, resolveErrorMessage));
    }
  };

  const coverage = upcCoverage(inspection.shipment?.line_items);

  return (
    <div className="arvist-root arvist-touch mx-auto grid max-w-[1400px] gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Packstation</h1>
            <p className="text-sm text-arvist-text-muted">
              {live ? 'Connected to a live Arvist deployment' : 'Running against the scripted mock backend'}
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-arvist-text-muted">
            <input
              type="checkbox"
              checked={autoCompleted}
              onChange={(e) => onAutoCompletedChange(e.target.checked)}
            />
            Shipment auto-completed upstream
          </label>
        </header>

        <div className="grid gap-4 sm:grid-cols-2">
          <StationStatus areaName={STATION_NAME} {...binding} />
          <InspectionStatus
            phase={inspection.phase}
            progress={inspection.progress}
            connection={inspection.connection}
            detail={
              inspection.shipment
                ? `${inspection.shipment.order_numbers.join(', ')} · ${inspection.shipment.shipment_key}`
                : 'Scan a tote to begin'
            }
          />
        </div>

        {inspection.error ? (
          <p
            role="alert"
            className="rounded-[var(--arvist-radius)] border border-arvist-blocking/40 bg-arvist-blocking-surface px-4 py-3 text-sm"
          >
            {getDisplayMessage(inspection.error, resolveErrorMessage)}
          </p>
        ) : null}

        {coverage.total > 0 && coverage.ratio < 1 ? (
          <p className="rounded-[var(--arvist-radius)] border border-arvist-warning/40 bg-arvist-warning-surface px-4 py-2 text-sm">
            {coverage.withUpc} of {coverage.total} lines carry a UPC — the rest fall back to SKU
            matching.
          </p>
        ) : null}

        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-arvist-text-muted">
            Exceptions
          </h2>
          <ExceptionList
            exceptions={exceptions.exceptions}
            resolvingKey={exceptions.resolving}
            onResolve={async (exception, resolution, reason) => {
              await exceptions.resolve({
                exception,
                resolution,
                reason,
                // A real screen collects these from the operator; the shapes are
                // what each action needs. `identify_product`/`correct_product`
                // need the sku the operator picked from a product search; the
                // issue itself already pins which detected instance that's for.
                sku:
                  resolution.action === 'identify_product' || resolution.action === 'correct_product'
                    ? 'SKU-1'
                    : undefined,
                // `reassign_product` (overage) is the one action that can't
                // infer its target instance from the issue — a real screen
                // sources this from the image overlay the operator tapped.
                annotationId: resolution.action === 'reassign_product' ? 1 : undefined,
                targetSku: resolution.action === 'reassign_product' ? 'SKU-1' : undefined,
                identifier: resolution.action === 'submit_identifiers' ? 'LPN-000123' : undefined,
                quantity:
                  resolution.action === 'correct_count' ? exception.quantities?.expected : undefined,
              });
              setToast(`${exception.title} — ${resolution.label}`);
            }}
          />
        </section>

        {inspection.shipment ? (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-arvist-text-muted">
              Counts
            </h2>
            <div className="rounded-[var(--arvist-radius)] border border-arvist-border bg-arvist-surface p-3">
              <ReconciliationTable
                reconciliation={inspection.reconciliation}
                final={inspection.phase === 'completed'}
                showBarcode
              />
            </div>
          </section>
        ) : null}

        {media.items.length > 0 ? (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-arvist-text-muted">
              Capture
            </h2>
            <MediaGallery items={media.items} stale={media.stale} onRefresh={media.refresh} />
          </section>
        ) : null}

        <footer className="flex flex-wrap items-center gap-3">
          {inspection.corrections.length > 0 ? (
            <span className="text-sm text-arvist-text-muted">
              {inspection.corrections.length} count correction(s) will be sent on submit.
            </span>
          ) : null}
          <button
            type="button"
            onClick={complete}
            disabled={!inspection.completion.canComplete || !inspection.shipment || inspection.loading}
            className="rounded-[var(--arvist-radius)] bg-arvist-info px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Complete inspection
          </button>
          {inspection.completion.reason ? (
            <span className="text-sm text-arvist-blocking">{inspection.completion.reason}</span>
          ) : null}
        </footer>
      </div>

      <aside className="space-y-4">
        <DriverPanel backend={backend} live={live} onStart={() => startFromScan('ORD-77421')} />
        <div className="rounded-[var(--arvist-radius)] border border-arvist-border bg-arvist-surface p-3">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-arvist-text-muted">
            Event log
          </h2>
          <ol className="max-h-96 space-y-1 overflow-y-auto font-mono text-[11px] leading-relaxed text-arvist-text-muted">
            {log.length === 0 ? <li>Nothing yet.</li> : log.map((line, i) => <li key={i}>{line}</li>)}
          </ol>
        </div>
      </aside>

      {toast ? (
        <div
          role="status"
          onAnimationEnd={() => setToast(null)}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-arvist-text px-4 py-2 text-sm text-arvist-surface shadow-lg"
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}

/** Stands in for the upstream system and the operator's scanner. */
function DriverPanel({
  backend,
  live,
  onStart,
}: {
  backend: MockBackend;
  live: boolean;
  onStart: () => void;
}) {
  if (live) {
    return (
      <div className="rounded-[var(--arvist-radius)] border border-arvist-border bg-arvist-surface p-3 text-sm text-arvist-text-muted">
        Connected to a live deployment. Start an inspection from the upstream system, or scan a
        tote — the page listens for scanner input anywhere on screen.
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-[var(--arvist-radius)] border border-arvist-border bg-arvist-surface p-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-arvist-text-muted">
        Simulate
      </h2>
      <p className="text-xs text-arvist-text-muted">
        Stands in for the upstream tote scan and the inspection running on the floor. A real
        handheld scanner also works — the page reads scanner input directly.
      </p>
      <div className="flex flex-wrap gap-2">
        <Btn onClick={onStart}>Scan tote</Btn>
        <Btn onClick={backend.advance}>Next unit</Btn>
        <Btn onClick={backend.reset}>Reset</Btn>
      </div>
    </div>
  );
}

function Btn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[var(--arvist-radius)] border border-arvist-border px-3 py-1.5 text-sm font-medium hover:bg-arvist-surface-muted"
    >
      {children}
    </button>
  );
}
