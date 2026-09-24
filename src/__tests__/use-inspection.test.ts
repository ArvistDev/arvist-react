import { act, renderHook, waitFor } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';
import { ArvistClient } from '../core/client';
import { topics, type RealtimeTransport } from '../core/realtime';
import { useInspection } from '../react/hooks/use-inspection';
import { ArvistProvider } from '../react/provider';

/**
 * A transport whose `on`/`off` behave like `createSocketIoTransport`'s, but
 * `emit` drives handlers synchronously and directly — no socket, no network.
 */
function fakeTransport(): RealtimeTransport & { emit: (topic: string, payload: unknown) => void } {
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  return {
    state: 'connected',
    connect() {},
    close() {},
    on(topic, handler) {
      const set = handlers.get(topic) ?? new Set();
      set.add(handler);
      handlers.set(topic, set);
    },
    off(topic, handler) {
      if (!handler) {
        handlers.delete(topic);
        return;
      }
      handlers.get(topic)?.delete(handler);
    },
    onStateChange() {
      return () => {};
    },
    emit(topic, payload) {
      for (const h of handlers.get(topic) ?? []) h(payload);
    },
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function wrapper(transport: RealtimeTransport, fetchImpl?: typeof globalThis.fetch) {
  const client = new ArvistClient({
    baseUrl: 'https://arvist.example.com',
    fetch: (fetchImpl ?? (async () => jsonResponse({}))) as never,
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(ArvistProvider, { client, realtime: { transport } }, children);
}

function minimalShipment(id: number, over: Record<string, unknown> = {}) {
  return {
    id,
    shipment_key: `k${id}`,
    type: 'outbound',
    status: 'in_progress',
    site_id: 1,
    confidence: null,
    order_numbers: [],
    supplier: 'ACME',
    created_at: '',
    updated_at: '',
    line_items: [],
    ...over,
  };
}

describe('useInspection: global status topic scoping', () => {
  it('does not apply the global status/completed/canceled topic before a shipment is bound', () => {
    const transport = fakeTransport();
    const { result } = renderHook(() => useInspection({ areaName: 'Z01', areaId: 42 }), {
      wrapper: wrapper(transport),
    });

    expect(result.current.phase).toBe('idle');

    // No `started` event has matched this station yet — `shipment` is still
    // unset. A `shipment-status/update` for some *other*, unrelated shipment
    // must not be able to drive this hook's phase/progress: that topic has no
    // per-station or per-shipment scoping at all, so it fires for every
    // shipment in the deployment.
    act(() => {
      transport.emit(topics.update(), { shipment_id: 999, status: 'in_progress', progress: 0.4 });
    });

    expect(result.current.phase).toBe('idle');
    expect(result.current.progress).toBeNull();
    expect(result.current.shipment).toBeUndefined();
  });

  it('applies the global status topic once a shipment is bound via `started`', () => {
    const transport = fakeTransport();
    const { result } = renderHook(() => useInspection({ areaName: 'Z01', areaId: 42 }), {
      wrapper: wrapper(transport),
    });

    act(() => {
      transport.emit(topics.start('Z01'), { shipment: minimalShipment(5) });
    });
    expect(result.current.phase).toBe('in_progress');

    // A status update for a *different* shipment is still ignored...
    act(() => {
      transport.emit(topics.update(), { shipment_id: 999, status: 'review', progress: 1 });
    });
    expect(result.current.phase).toBe('in_progress');

    // ...but one for the bound shipment applies normally.
    act(() => {
      transport.emit(topics.update(), { shipment_id: 5, status: 'review', progress: 0.75 });
    });
    expect(result.current.phase).toBe('review');
    expect(result.current.progress).toBe(0.75);
  });
});

describe('useInspection: adopting a shipment via the status-triggered station lookup', () => {
  // `started` is only ever emitted for an M2M-initiated start — a
  // dashboard/user-authenticated one never sends it (see
  // `startShipmentProcessing`'s own comment on that emit in arvist/api).
  // Without this fallback, `shipment` would never populate for that case no
  // matter how correctly everything else here is wired.

  function fetchRouter(routes: { listShipments?: unknown; getShipment?: Record<number, unknown> }) {
    return async (url: RequestInfo | URL) => {
      const href = String(url);
      if (href.includes('/quality/inspection/shipment/')) {
        const id = Number(href.split('/quality/inspection/shipment/')[1]!.split(/[/?]/)[0]);
        const body = routes.getShipment?.[id];
        return body ? jsonResponse(body) : jsonResponse({ message: 'not found' }, 404);
      }
      if (href.includes('/quality/inspection/shipment')) {
        return jsonResponse(routes.listShipments ?? { data: [], total: 0, page: 1, limit: 1 });
      }
      return jsonResponse({});
    };
  }

  it('adopts the station\'s in-progress shipment on an unscoped status event', async () => {
    const transport = fakeTransport();
    const shipment7 = minimalShipment(7, { status: 'in_progress' });
    const fetchImpl = fetchRouter({
      listShipments: { data: [{ id: 7 }], total: 1, page: 1, limit: 1 },
      getShipment: { 7: shipment7 },
    });
    const { result } = renderHook(() => useInspection({ areaName: 'Mobile' }), {
      wrapper: wrapper(transport, fetchImpl as never),
    });

    expect(result.current.shipment).toBeUndefined();

    // No `started` event — as if this inspection was started from the
    // dashboard, not an M2M device — only the unscoped `status` broadcast
    // that always accompanies a start regardless of who triggered it.
    act(() => {
      transport.emit(topics.update(), { shipment_id: 7, status: 'in_progress', progress: 0 });
    });

    await waitFor(() => expect(result.current.shipment?.id).toBe(7));
    expect(result.current.phase).toBe('in_progress');
  });

  it('does not adopt anything when no shipment is actually in progress at this station', async () => {
    const transport = fakeTransport();
    let listResolved = false;
    const fetchImpl = async (url: RequestInfo | URL) => {
      const href = String(url);
      if (href.includes('/quality/inspection/shipment')) {
        listResolved = true;
        return jsonResponse({ data: [], total: 0, page: 1, limit: 1 });
      }
      return jsonResponse({});
    };
    const { result } = renderHook(() => useInspection({ areaName: 'Mobile' }), {
      wrapper: wrapper(transport, fetchImpl as never),
    });

    // A genuinely unrelated shipment's status update — the station-scoped
    // lookup comes back empty, so nothing gets adopted.
    act(() => {
      transport.emit(topics.update(), { shipment_id: 999, status: 'in_progress', progress: 0 });
    });

    await waitFor(() => expect(listResolved).toBe(true));
    expect(result.current.shipment).toBeUndefined();
    expect(result.current.phase).toBe('idle');
  });

  it('does not run the station lookup when an explicit shipmentId is given', async () => {
    const transport = fakeTransport();
    let listCalled = false;
    const fetchImpl = async (url: RequestInfo | URL) => {
      const href = String(url);
      if (href.includes('/quality/inspection/shipment/9')) {
        return jsonResponse(minimalShipment(9));
      }
      if (href.includes('/quality/inspection/shipment')) {
        listCalled = true;
        return jsonResponse({ data: [], total: 0, page: 1, limit: 1 });
      }
      return jsonResponse({});
    };
    const { result } = renderHook(() => useInspection({ areaName: 'Mobile', shipmentId: 9 }), {
      wrapper: wrapper(transport, fetchImpl as never),
    });

    await waitFor(() => expect(result.current.shipment?.id).toBe(9));

    act(() => {
      transport.emit(topics.update(), { shipment_id: 999, status: 'in_progress', progress: 0 });
    });

    expect(listCalled).toBe(false);
    expect(result.current.shipment?.id).toBe(9);
  });
});
