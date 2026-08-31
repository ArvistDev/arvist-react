/**
 * A scripted Arvist backend.
 *
 * Response envelopes here mirror the real API exactly, including its
 * inconsistencies: reads return their payload bare, `start` returns
 * `{ message, shipment }`, and several writes return a plain JSON string. That
 * is deliberate — a mock that normalises the API would hide the very bugs this
 * example exists to catch.
 *
 * The example runs against this by default so it can be opened and driven
 * without credentials or a live site. It implements the handful of endpoints
 * the SDK touches and emits the same realtime topics the API does, which makes
 * it a genuine test of the SDK's wiring rather than a picture of one.
 *
 * Point the app at a real deployment by setting `VITE_ARVIST_URL` — nothing
 * else in the app changes.
 */

import type {
  ConnectionState,
  LineItem,
  QualityStation,
  RealtimeTransport,
  Shipment,
  ShipmentIssue,
} from '@arvist/react';

export const STATION: QualityStation = {
  id: 1,
  name: 'Packstation 1',
  area_id: 42,
  area_name: 'Z01-PS-001',
  type: 'packing_table',
  station_configuration: 'single_products',
  location: 'Dock A',
};

/** UPC is populated on only some lines — the SDK must fall back to SKU. */
const ORDER_LINES: LineItem[] = [
  {
    id: 1, name: 'Cotton Tee — Navy / M', sku: 'APP-TEE-NVY-M', product_id: 'P-1001',
    expected_quantity: 3, actual_quantity: 0, additional_data: { upc: '036000291452' },
  },
  {
    id: 2, name: 'Canvas Tote', sku: 'ACC-TOTE-STD', product_id: 'P-1002',
    expected_quantity: 2, actual_quantity: 0, additional_data: { upc: '4006381333931' },
  },
  {
    id: 3, name: 'Enamel Mug 12oz', sku: 'HOM-MUG-12', product_id: 'P-1003',
    expected_quantity: 4, actual_quantity: 0, additional_data: null,
  },
];

let nextIssueId = 100;

function issue(type: ShipmentIssue['issue_type'], description: string): ShipmentIssue {
  const now = new Date().toISOString();
  return { id: nextIssueId++, issue_type: type, status: 'open', description, created_at: now, updated_at: now };
}

export interface MockBackend {
  fetch: typeof globalThis.fetch;
  transport: RealtimeTransport;
  /** Simulates an upstream tote scan calling Start Shipment Processing. */
  simulateTotescan: (orderNumber: string) => Promise<void>;
  /** Advances the scripted inspection by one unit. */
  advance: () => void;
  reset: () => void;
  onLog: (handler: (line: string) => void) => () => void;
}

export function createMockBackend(): MockBackend {
  let shipment: Shipment | null = null;
  let step = 0;
  const logHandlers = new Set<(line: string) => void>();

  const log = (line: string) => {
    for (const h of logHandlers) h(`${new Date().toLocaleTimeString()}  ${line}`);
  };

  // --- transport ------------------------------------------------------------
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  const stateHandlers = new Set<(s: ConnectionState) => void>();
  let state: ConnectionState = 'idle';

  const setState = (next: ConnectionState) => {
    state = next;
    for (const h of stateHandlers) h(next);
  };

  const publish = (topic: string, payload: unknown) => {
    log(`→ ${topic}`);
    for (const h of handlers.get(topic) ?? []) h(payload);
  };

  const transport: RealtimeTransport = {
    get state() {
      return state;
    },
    connect() {
      setState('connecting');
      setTimeout(() => setState('connected'), 150);
    },
    close() {
      handlers.clear();
      setState('closed');
    },
    on(topic, handler) {
      if (!handlers.has(topic)) handlers.set(topic, new Set());
      handlers.get(topic)!.add(handler);
    },
    off(topic, handler) {
      if (!handler) {
        handlers.delete(topic);
        return;
      }
      const set = handlers.get(topic);
      set?.delete(handler);
      if (set && set.size === 0) handlers.delete(topic);
    },
    onStateChange(handler) {
      stateHandlers.add(handler);
      return () => stateHandlers.delete(handler);
    },
  };

  // --- scripted inspection --------------------------------------------------
  /**
   * Each step completes a unit and pushes the shipment further out of true, so
   * the UI has to handle every exception family: a clean unit, an unidentified
   * item, an off-order item, damage, and finally a shortage that blocks
   * completion.
   */
  const STEPS: { label: string; apply: (s: Shipment) => void }[] = [
    {
      label: 'Unit 1 — clean',
      apply: (s) => {
        setActual(s, 'APP-TEE-NVY-M', 3);
        addUnit(s, 'unit-1', []);
      },
    },
    {
      label: 'Unit 2 — an item could not be identified',
      apply: (s) => {
        setActual(s, 'ACC-TOTE-STD', 2);
        upsertSentinel(s, 'unknown', 1);
        addUnit(s, 'unit-2', [issue('unidentified_product', 'An item was detected that could not be matched to a product.')]);
      },
    },
    {
      label: 'Unit 3 — an item from another order, and damage',
      apply: (s) => {
        upsertSentinel(s, 'wrong', 1);
        addUnit(s, 'unit-3', [issue('damage', 'Crushed corner on the outer carton.')]);
      },
    },
    {
      label: 'Unit 4 — short on mugs, blocks completion',
      apply: (s) => {
        setActual(s, 'HOM-MUG-12', 2);
        addUnit(s, 'unit-4', []);
      },
    },
  ];

  function setActual(s: Shipment, sku: string, qty: number) {
    const item = s.line_items.find((i) => i.sku === sku);
    if (item) item.actual_quantity = qty;
  }

  function upsertSentinel(s: Shipment, sku: 'unknown' | 'wrong', qty: number) {
    const existing = s.line_items.find((i) => i.sku === sku);
    if (existing) existing.actual_quantity += qty;
    else
      s.line_items.push({
        id: sku === 'wrong' ? 900 : 901,
        name: sku === 'wrong' ? 'Off-order item' : 'Unidentified item',
        sku,
        product_id: sku,
        expected_quantity: 0,
        actual_quantity: qty,
      });
  }

  function addUnit(s: Shipment, unitId: string, issues: ShipmentIssue[]) {
    const now = new Date().toISOString();
    const sessionId = 500 + (s.units?.length ?? 0);
    s.units = [
      ...(s.units ?? []),
      {
        id: unitId,
        shipment_id: s.id,
        type: 'product',
        created_at: now,
        updated_at: now,
        quality_sessions: [
          {
            id: sessionId,
            shipment_unit_id: unitId,
            created_at: now,
            updated_at: now,
            issues,
            images: ['front', 'back', 'top'].map((side, i) => ({
              id: sessionId * 10 + i,
              side,
              shipment_unit_session_id: sessionId,
              media: {
                content_id: `${unitId}-${side}`,
                filename: `${unitId}-${side}.jpg`,
                mime_type: 'image/jpeg',
                // Inline SVG stands in for a presigned URL so the gallery has
                // something to render offline.
                url: placeholderImage(`${unitId} · ${side}`),
                expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
              },
              damages: issues.some((x) => x.issue_type === 'damage') && side === 'front'
                ? [{ id: 1, type: 'Crushed corner', category: 'Carton', category_type: 'damage', description: '', damaged_box_qty: 1, created_at: now }]
                : [],
            })),
          },
        ],
      },
    ];
  }

  const advance = () => {
    if (!shipment || step >= STEPS.length) return;
    const current = STEPS[step]!;
    step += 1;
    current.apply(shipment);
    log(`· ${current.label}`);

    const unit = shipment.units!.at(-1)!;
    const session = unit.quality_sessions![0]!;

    publish(`shipment-status/unit-processing/${STATION.area_id}`, {
      shipment_id: shipment.id, unit_id: unit.id, unit_session_id: session.id,
    });
    publish(`shipment-status/unit-completed/${STATION.area_id}`, {
      shipment_id: shipment.id,
      unit_id: unit.id,
      unit_session_id: session.id,
      increment_by: 1,
      issues: (session.issues ?? []).map((i) => ({
        type: i.issue_type, status: i.status, description: i.description,
      })),
    });
    // The real API moves the shipment's own status too, not just the event —
    // and that transition is what promotes a provisional shortage to a blocker.
    shipment.status = step >= STEPS.length ? 'review' : 'in_progress';
    publish('shipment-status/update', {
      shipment_id: shipment.id,
      status: shipment.status,
      progress: step / STEPS.length,
    });
  };

  const simulateTotescan = async (orderNumber: string) => {
    const now = new Date().toISOString();
    step = 0;
    shipment = {
      id: 9001,
      shipment_key: `SK-${orderNumber}`,
      type: 'outbound',
      status: 'in_progress',
      site_id: 1,
      confidence: null,
      order_numbers: [orderNumber],
      supplier: 'Retail Co',
      created_at: now,
      updated_at: now,
      line_items: ORDER_LINES.map((l) => ({ ...l, actual_quantity: 0 })),
      units: [],
      quality_station: STATION,
    };
    log(`· tote scanned — Start Shipment Processing at ${STATION.area_name}`);
    publish(`shipment-status/start/${STATION.area_name}`, { shipment });
  };

  const reset = () => {
    shipment = null;
    step = 0;
    log('· reset');
  };

  // --- fetch ----------------------------------------------------------------
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const path = url.pathname.replace('/v1/api', '');
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    log(`← ${method} ${path}`);

    // Latency, so loading states are visible rather than theoretical.
    await new Promise((r) => setTimeout(r, 120));

    if (path === '/locations/quality-stations') return json([STATION]);

    if (path === '/quality/inspection/shipment' && method === 'GET') {
      const match = shipment && shipment.status === 'in_progress' ? [shipment] : [];
      return json({ data: match, total: match.length, page: 1, limit: 20 });
    }

    if (path === '/quality/inspection/shipment' && method === 'POST') {
      await simulateTotescan(body.order_numbers?.[0] ?? 'ORD-UNKNOWN');
      return json({ message: 'Initiating Shipment Inspection', shipment });
    }

    if (/^\/quality\/inspection\/shipment\/\d+$/.test(path) && method === 'GET') {
      return shipment ? json(shipment) : json({ message: 'Shipment not found' }, 404);
    }

    if (path.startsWith('/quality/inspection/shipment-issue/unit/') && method === 'PUT') {
      const sessionId = Number(path.split('/').pop());
      const session = shipment?.units
        ?.flatMap((u) => u.quality_sessions ?? [])
        .find((s) => s.id === sessionId);
      const target = session?.issues?.find((i) => i.issue_type === body.issue_type);
      if (!target) return json({ message: 'Issue not found' }, 404);
      target.status = body.status;
      target.updated_at = new Date().toISOString();
      log(`· ${body.issue_type} → ${body.status}${body.reason ? ` ("${body.reason}")` : ''}`);
      return json(`Issue has been set to ${body.status}`);
    }

    if (path === '/quality/inspection/shipment/unknown-product/update' && method === 'PUT') {
      if (!shipment) return json({ message: 'Shipment not found' }, 404);
      const unknown = shipment.line_items.find((i) => i.sku === 'unknown');
      if (!unknown || unknown.actual_quantity <= 0) {
        return json({ message: 'Unknown product bucket not found or empty' }, 400);
      }
      // Mirrors the real controller: the action is inferred from the annotation.
      const { category_id, identifiers = {} } = body.annotation ?? {};
      const hasIdentifier = Object.entries(identifiers).some(
        ([k, v]) => !k.endsWith('quantity') && v !== null && v !== undefined,
      );
      const qty = Math.max(1, Number(identifiers.items_quantity ?? 1) || 1);

      if (category_id === 'remove') {
        unknown.actual_quantity -= 1;
        log('· unidentified item removed from the count');
      } else if (hasIdentifier) {
        unknown.actual_quantity -= 1;
        upsertSentinel(shipment, 'wrong', 1);
        log('· unidentified item moved to the wrong-product bucket');
      } else {
        const target = shipment.line_items.find((i) => i.id === category_id);
        if (!target) return json({ message: `Category with ID ${category_id} not found` }, 400);
        unknown.actual_quantity -= qty;
        target.actual_quantity += qty;
        log(`· unidentified item identified as ${target.sku}`);
      }
      shipment.line_items = shipment.line_items.filter(
        (i) => !(i.sku === 'unknown' && i.actual_quantity <= 0),
      );
      return json({ message: 'Unknown product updated successfully', shipment });
    }

    if (path === '/quality/inspection/shipment/finished' && method === 'POST') {
      log('· finished');
      return json('Shipment count processing');
    }

    if (path === '/quality/inspection/shipment/submit' && method === 'POST') {
      // Corrections ride along with the submission, as the real endpoint does.
      for (const correction of body.line_items ?? []) {
        const line = shipment?.line_items.find((i) => i.id === correction.id);
        if (line) {
          line.actual_quantity = correction.actual_quantity;
          line.is_edited = correction.is_edited;
        }
      }
      if (body.line_items?.length) log(`· ${body.line_items.length} count correction(s) applied`);
      if (shipment) shipment.status = 'completed';
      publish('shipment-status/update', {
        shipment_id: shipment?.id, status: 'completed', progress: null,
      });
      return json('Shipment count submitted');
    }

    if (path === '/quality/inspection/shipment/cancel-shipment' && method === 'POST') {
      publish('shipment-status/update', { shipment_id: shipment?.id, status: 'canceled' });
      return json('Shipment inspection cancelled', 200);
    }

    return json({ message: `Mock backend has no route for ${method} ${path}` }, 404);
  };

  return {
    fetch: fetchImpl,
    transport,
    simulateTotescan,
    advance,
    reset,
    onLog: (handler) => {
      logHandlers.add(handler);
      return () => logHandlers.delete(handler);
    },
  };
}

function placeholderImage(label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240">
    <rect width="320" height="240" fill="#e2e8f0"/>
    <text x="160" y="125" font-family="sans-serif" font-size="15" fill="#475569"
      text-anchor="middle">${label}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
