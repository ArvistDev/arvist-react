import { act, renderHook } from '@testing-library/react';
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

function wrapper(transport: RealtimeTransport) {
  const client = new ArvistClient({ baseUrl: 'https://arvist.example.com', fetch: (async () => new Response('{}')) as never });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(ArvistProvider, { client, realtime: { transport } }, children);
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
