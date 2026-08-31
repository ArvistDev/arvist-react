import { describe, expect, it, vi } from 'vitest';
import {
  InspectionFeed,
  topics,
  type ConnectionState,
  type InspectionEvent,
  type RealtimeTransport,
} from '../core/realtime';

/** In-memory transport so the feed can be driven without a socket. */
function fakeTransport() {
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  let state: ConnectionState = 'idle';
  const stateHandlers = new Set<(s: ConnectionState) => void>();

  const transport: RealtimeTransport = {
    get state() {
      return state;
    },
    connect() {
      state = 'connected';
      for (const h of stateHandlers) h(state);
    },
    close() {
      state = 'closed';
      handlers.clear();
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
      // Mirror the real transport: an empty set means the topic is unsubscribed.
      if (set && set.size === 0) handlers.delete(topic);
    },
    onStateChange(handler) {
      stateHandlers.add(handler);
      return () => stateHandlers.delete(handler);
    },
  };

  return {
    transport,
    emit: (topic: string, payload: unknown) => {
      for (const h of handlers.get(topic) ?? []) h(payload);
    },
    topics: () => [...handlers.keys()].sort(),
  };
}

describe('topics', () => {
  it('keys starts on station name and per-unit events on station id', () => {
    expect(topics.start('Z01-PS-001')).toBe('shipment-status/start/Z01-PS-001');
    expect(topics.unitCompleted(42)).toBe('shipment-status/unit-completed/42');
    expect(topics.error(7)).toBe('shipment-status/error/7');
  });
});

describe('InspectionFeed binding', () => {
  it('subscribes to the topics a binding implies', () => {
    const fake = fakeTransport();
    const feed = new InspectionFeed({ transport: fake.transport });
    feed.bind({ areaName: 'Z01-PS-001', areaId: 42, shipmentId: 7 });

    expect(fake.topics()).toEqual(
      [
        'shipment-status/complete/7',
        'shipment-status/damages-detected/42',
        'shipment-status/error/7',
        'shipment-status/start/Z01-PS-001',
        'shipment-status/state-change/shipment/7',
        'shipment-status/state-change/station/42',
        'shipment-status/unit-completed/42',
        'shipment-status/unit-processing/42',
        'shipment-status/update',
      ].sort(),
    );
  });

  it('drops per-shipment topics when the shipment changes', () => {
    const fake = fakeTransport();
    const feed = new InspectionFeed({ transport: fake.transport });
    feed.bind({ areaId: 42, shipmentId: 7 });
    feed.bind({ areaId: 42, shipmentId: 8 });

    expect(fake.topics()).toContain('shipment-status/error/8');
    expect(fake.topics()).not.toContain('shipment-status/error/7');
  });

  it('keeps the global update topic when only the station is known', () => {
    const fake = fakeTransport();
    new InspectionFeed({ transport: fake.transport }).bind({});
    expect(fake.topics()).toEqual(['shipment-status/update']);
  });
});

describe('InspectionFeed events', () => {
  function setup() {
    const fake = fakeTransport();
    const feed = new InspectionFeed({ transport: fake.transport });
    feed.bind({ areaName: 'Z01-PS-001', areaId: 42, shipmentId: 7 });
    const events: InspectionEvent[] = [];
    feed.subscribe((e) => events.push(e));
    return { fake, feed, events };
  }

  it('normalises a start, unwrapping the shipment envelope', () => {
    const { fake, events } = setup();
    fake.emit(topics.start('Z01-PS-001'), { shipment: { id: 7, shipment_key: 'k' } });
    expect(events[0]).toMatchObject({ kind: 'started', shipment: { id: 7 } });
  });

  it('exposes the issues array on unit-completed, empty when clean', () => {
    const { fake, events } = setup();
    fake.emit(topics.unitCompleted(42), { shipment_id: 7, unit_id: 'u1', issues: [] });
    expect(events[0]).toMatchObject({ kind: 'unit-completed', issues: [] });
  });

  it('routes a completed status off the shared update topic', () => {
    const { fake, events } = setup();
    fake.emit(topics.update(), { shipment_id: 7, status: 'completed', progress: null });
    expect(events[0]).toMatchObject({ kind: 'completed', shipmentId: 7 });
  });

  it('routes cancellation and deletion to a canceled event', () => {
    const { fake, events } = setup();
    fake.emit(topics.update(), { shipment_id: 7, status: 'deleted' });
    expect(events[0]!.kind).toBe('canceled');
  });

  it('passes progress through on an in-progress status', () => {
    const { fake, events } = setup();
    fake.emit(topics.update(), { shipment_id: 7, status: 'in_progress', progress: 0.5 });
    expect(events[0]).toMatchObject({ kind: 'status', progress: 0.5 });
  });

  it('labels state-change with the scope it arrived on', () => {
    const { fake, events } = setup();
    fake.emit(topics.stationStateChange(42), { shipment_id: 7, inspection_state: 'paused' });
    fake.emit(topics.shipmentStateChange(7), { shipment_id: 7, inspection_state: 'resumed' });
    expect(events.map((e) => (e.kind === 'state-change' ? e.scope : null))).toEqual([
      'station',
      'shipment',
    ]);
  });

  it('drops malformed payloads instead of emitting garbage', () => {
    const { fake, events } = setup();
    fake.emit(topics.update(), { status: 'in_progress' }); // no shipment_id
    fake.emit(topics.start('Z01-PS-001'), {}); // no shipment
    expect(events).toEqual([]);
  });

  it('buffers events that arrive before a listener attaches', () => {
    const fake = fakeTransport();
    const feed = new InspectionFeed({ transport: fake.transport });
    feed.bind({ areaName: 'Z01-PS-001' });
    fake.emit(topics.start('Z01-PS-001'), { shipment: { id: 7 } });

    const events: InspectionEvent[] = [];
    feed.subscribe((e) => events.push(e));
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('started');
  });

  it('replays the buffer only once', () => {
    const fake = fakeTransport();
    const feed = new InspectionFeed({ transport: fake.transport });
    feed.bind({ areaName: 'Z01-PS-001' });
    fake.emit(topics.start('Z01-PS-001'), { shipment: { id: 7 } });

    feed.subscribe(() => {});
    const second = vi.fn();
    feed.subscribe(second);
    expect(second).not.toHaveBeenCalled();
  });

  it('caps the buffer so a long-idle page cannot grow without bound', () => {
    const fake = fakeTransport();
    const feed = new InspectionFeed({ transport: fake.transport, bufferSize: 2 });
    feed.bind({});
    for (const id of [1, 2, 3]) fake.emit(topics.update(), { shipment_id: id, status: 'in_progress' });

    const events: InspectionEvent[] = [];
    feed.subscribe((e) => events.push(e));
    expect(events).toHaveLength(2);
    expect(events.map((e) => (e.kind === 'status' ? e.shipmentId : null))).toEqual([2, 3]);
  });

  it('unsubscribes cleanly', () => {
    const { fake, feed } = setup();
    const listener = vi.fn();
    const unsubscribe = feed.subscribe(listener);
    unsubscribe();
    fake.emit(topics.update(), { shipment_id: 7, status: 'in_progress' });
    expect(listener).not.toHaveBeenCalled();
  });
});
