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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
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

describe('useInspection: stale async responses cannot clobber a newer shipment', () => {
  it('refresh() for a shipment that is no longer tracked does not overwrite the new one', async () => {
    const transport = fakeTransport();
    const staleResponse = deferred<Response>();

    const fetchImpl = async (url: RequestInfo | URL) => {
      const href = String(url);
      if (href.includes('/quality/inspection/shipment/32')) {
        // Held open until the test explicitly resolves it, simulating a slow
        // response that lands after a different shipment is already bound.
        return staleResponse.promise;
      }
      return jsonResponse({});
    };

    const { result } = renderHook(() => useInspection({ areaName: 'Z01' }), {
      wrapper: wrapper(transport, fetchImpl as never),
    });

    // Bind shipment 32 the normal way — a real `started` event, not an
    // explicit `shipmentId` option (which would keep falling back to itself
    // and could never let a genuinely different shipment take over).
    act(() => {
      transport.emit(topics.start('Z01'), { shipment: minimalShipment(32) });
    });
    expect(result.current.shipment?.id).toBe(32);

    // Kick off a refresh for 32 — its response will stay pending until
    // resolved below, well after shipment 30 is bound.
    let refreshDone: Promise<void>;
    act(() => {
      refreshDone = result.current.refresh();
    });

    // Cancel drops the tracked shipment (a real app calls `clear()` once it
    // is done with 32 — the mismatch filter above deliberately rejects a
    // `started` event for a *different* shipment while one is still tracked,
    // so this is what actually happens between "done with 32" and "watching
    // for whatever starts next"), then a real `started` event for a
    // different shipment arrives and is bound immediately.
    act(() => {
      result.current.clear();
    });
    act(() => {
      transport.emit(topics.start('Z01'), { shipment: minimalShipment(30) });
    });
    expect(result.current.shipment?.id).toBe(30);

    // Now the stale response for 32 finally lands.
    await act(async () => {
      staleResponse.resolve(jsonResponse(minimalShipment(32)));
      await refreshDone;
    });

    // It must not have overwritten the newer, currently-bound shipment.
    expect(result.current.shipment?.id).toBe(30);
  });

  it('adoptStationShipment() does not overwrite a shipment bound while its own fetch was in flight', async () => {
    const transport = fakeTransport();
    const staleResponse = deferred<Response>();

    const fetchImpl = async (url: RequestInfo | URL) => {
      const href = String(url);
      if (href.includes('/quality/inspection/shipment/7')) {
        // Held open — simulates the station-scoped lookup's own `getShipment`
        // call still being in flight when a real `started` event for a
        // *different* shipment (5) arrives and binds immediately.
        return staleResponse.promise;
      }
      if (href.includes('/quality/inspection/shipment')) {
        return jsonResponse({ data: [{ id: 7 }], total: 1, page: 1, limit: 1 });
      }
      return jsonResponse({});
    };

    const { result } = renderHook(() => useInspection({ areaName: 'Mobile' }), {
      wrapper: wrapper(transport, fetchImpl as never),
    });

    // Unscoped status event, no shipment tracked yet — triggers the
    // station-scoped adoption lookup. Let its `listShipments` call resolve
    // (nothing is bound yet, so its first staleness check passes) and let it
    // reach — and hang on — the stale `getShipment(7)` call above, *before*
    // anything else happens. Otherwise the `started` event below would bind
    // shipment 5 before `listShipments` even resolves, and the lookup would
    // bail out on its *first* staleness check instead of the second one this
    // test targets.
    await act(async () => {
      transport.emit(topics.update(), { shipment_id: 7, status: 'in_progress', progress: 0 });
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });

    // A real `started` event for a genuinely different shipment (5) arrives
    // while the lookup above is still waiting on `getShipment(7)`, and binds
    // immediately — nothing was tracked yet, so it isn't filtered.
    act(() => {
      transport.emit(topics.start('Mobile'), { shipment: minimalShipment(5) });
    });
    expect(result.current.shipment?.id).toBe(5);

    // Now the stale adoption lookup for shipment 7 finally resolves. Several
    // microtask ticks: the fetch promise, then `response.json()`, then the
    // client's own await chain, before `adoptStationShipment` even reaches
    // its post-fetch staleness check.
    await act(async () => {
      staleResponse.resolve(jsonResponse(minimalShipment(7)));
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });

    // It must not have overwritten the shipment bound in the meantime.
    expect(result.current.shipment?.id).toBe(5);
  });
});

describe('useInspection: finish() blocked by a real shortage', () => {
  it('surfaces blocked_by, refreshes so the real issue row shows up, and throws', async () => {
    const transport = fakeTransport();
    const shortageIssue = {
      id: 9,
      issue_type: 'shortage',
      status: 'open',
      shipment_data_id: 1,
      created_at: '',
      updated_at: '',
    };
    // The API's own response shape when `detectShortages` finds open
    // shortages: a 200, not an error, with `blocked_by`/`shortage_issues` and
    // no `shipment` — the finish never actually went through.
    const blockedResponse = {
      message: 'Shipment has unresolved shortages — add the missing item(s) or resolve, then finish again',
      blocked_by: 'shortage',
      shortage_issues: [shortageIssue],
    };
    const shipmentBeforeFinish = minimalShipment(5, {
      line_items: [
        { id: 1, name: 'Widget', sku: 'SKU-1', product_id: 'P1', expected_quantity: 10, actual_quantity: 4 },
      ],
    });
    const shipmentAfterRefresh = minimalShipment(5, {
      line_items: [
        { id: 1, name: 'Widget', sku: 'SKU-1', product_id: 'P1', expected_quantity: 10, actual_quantity: 4, issue: shortageIssue },
      ],
    });

    let shipmentFetchCount = 0;
    const fetchImpl = async (url: RequestInfo | URL) => {
      const href = String(url);
      if (href.includes('/shipment/finished')) return jsonResponse(blockedResponse);
      if (href.includes('/shipment/5')) {
        shipmentFetchCount += 1;
        // First fetch is the initial adopt-by-shipmentId call, before the
        // real issue row exists; the second is the post-block refresh, after
        // `detectShortages` has created it server-side.
        return jsonResponse(shipmentFetchCount === 1 ? shipmentBeforeFinish : shipmentAfterRefresh);
      }
      return jsonResponse({});
    };

    const { result } = renderHook(() => useInspection({ shipmentId: 5 }), {
      wrapper: wrapper(transport, fetchImpl as never),
    });

    await waitFor(() => expect(result.current.shipment?.id).toBe(5));

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.finish();
      } catch (err) {
        caught = err;
      }
    });

    expect(caught).toMatchObject({ code: 'completion_blocked' });
    await waitFor(() => expect(result.current.error?.code).toBe('completion_blocked'));
    await waitFor(() =>
      expect(result.current.shipment?.line_items[0]?.issue?.id).toBe(9),
    );
    // The finish call itself never returned a shipment, so `adopt()` never ran
    // for it — only the follow-up refresh should have updated `shipment`.
    expect(result.current.phase).not.toBe('completed');
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
