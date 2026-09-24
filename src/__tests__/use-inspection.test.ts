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
      transport.emit(topics.start('Z01'), {
        shipment: {
          id: 5,
          shipment_key: 'k',
          type: 'outbound',
          status: 'in_progress',
          site_id: 1,
          confidence: null,
          order_numbers: [],
          supplier: 'ACME',
          created_at: '',
          updated_at: '',
          line_items: [],
        },
      });
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
