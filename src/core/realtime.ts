/**
 * Realtime inspection feed.
 *
 * The API publishes inspection activity on a socket channel where each topic is
 * keyed by the thing it concerns — station name for starts, station id for
 * per-unit activity, shipment id for lifecycle changes. Subscribing correctly
 * means knowing which key goes with which topic and re-subscribing when the
 * shipment in progress changes.
 *
 * {@link InspectionFeed} does that bookkeeping and emits one typed event union.
 * The transport is pluggable — {@link createSocketIoTransport} ships in the box,
 * and any other duplex channel can be adapted by implementing
 * {@link RealtimeTransport}.
 */

import type { IssueType, Shipment, ShipmentStatus } from './types';

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed';

export interface RealtimeTransport {
  connect(): void;
  close(): void;
  on(topic: string, handler: (payload: unknown) => void): void;
  off(topic: string, handler?: (payload: unknown) => void): void;
  onStateChange(handler: (state: ConnectionState, error?: Error) => void): () => void;
  readonly state: ConnectionState;
}

export interface SocketIoTransportConfig {
  url: string;
  /** Defaults to `/socket.io`. */
  path?: string;
  auth?: Record<string, unknown>;
  extraHeaders?: Record<string, string>;
  withCredentials?: boolean;
  /**
   * `socket.io-client`'s `io` function. Pass it explicitly to keep the SDK's
   * dependency on socket.io optional and avoid bundler resolution surprises:
   *
   * ```ts
   * import { io } from 'socket.io-client';
   * createSocketIoTransport({ url, io });
   * ```
   */
  io: SocketIoFactory;
}

/** Structural type for `socket.io-client`'s `io`, so it is not a hard dependency. */
export type SocketIoFactory = (url: string, opts?: Record<string, unknown>) => SocketLike;

export interface SocketLike {
  connected: boolean;
  connect(): void;
  disconnect(): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
  off(event: string, handler?: (...args: unknown[]) => void): void;
}

export function createSocketIoTransport(config: SocketIoTransportConfig): RealtimeTransport {
  let socket: SocketLike | null = null;
  let state: ConnectionState = 'idle';
  const stateHandlers = new Set<(s: ConnectionState, e?: Error) => void>();
  const topicHandlers = new Map<string, Set<(p: unknown) => void>>();

  const setState = (next: ConnectionState, error?: Error) => {
    state = next;
    for (const h of stateHandlers) h(next, error);
  };

  const bind = (topic: string) => {
    socket?.on(topic, (...args: unknown[]) => {
      const payload = args[0];
      for (const h of topicHandlers.get(topic) ?? []) h(payload);
    });
  };

  return {
    get state() {
      return state;
    },
    connect() {
      if (socket) {
        if (!socket.connected) socket.connect();
        return;
      }
      setState('connecting');
      socket = config.io(config.url, {
        path: config.path ?? '/socket.io',
        transports: ['websocket', 'polling'],
        withCredentials: config.withCredentials ?? true,
        auth: config.auth,
        extraHeaders: config.extraHeaders,
      });
      socket.on('connect', () => setState('connected'));
      socket.on('disconnect', () => setState('reconnecting'));
      socket.on('connect_error', (err: unknown) =>
        setState('reconnecting', err instanceof Error ? err : new Error(String(err))),
      );
      for (const topic of topicHandlers.keys()) bind(topic);
    },
    close() {
      socket?.disconnect();
      socket = null;
      topicHandlers.clear();
      setState('closed');
    },
    on(topic, handler) {
      const existing = topicHandlers.get(topic);
      if (existing) {
        existing.add(handler);
        return;
      }
      topicHandlers.set(topic, new Set([handler]));
      if (socket) bind(topic);
    },
    off(topic, handler) {
      if (!handler) {
        topicHandlers.delete(topic);
        socket?.off(topic);
        return;
      }
      const set = topicHandlers.get(topic);
      set?.delete(handler);
      if (set && set.size === 0) {
        topicHandlers.delete(topic);
        socket?.off(topic);
      }
    },
    onStateChange(handler) {
      stateHandlers.add(handler);
      return () => stateHandlers.delete(handler);
    },
  };
}

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

/**
 * Topic names, with the key each one is scoped by. Getting the key wrong is a
 * silent failure — you subscribe successfully and never receive anything — so
 * these are centralised rather than interpolated at call sites.
 */
export const topics = {
  /** Global. Every shipment lifecycle transition. */
  update: () => 'shipment-status/update',
  /** Keyed by station *name*, because that is what upstream systems address. */
  start: (areaName: string) => `shipment-status/start/${areaName}`,
  /** Keyed by station *id*. */
  unitProcessing: (areaId: number) => `shipment-status/unit-processing/${areaId}`,
  unitCompleted: (areaId: number) => `shipment-status/unit-completed/${areaId}`,
  damagesDetected: (areaId: number) => `shipment-status/damages-detected/${areaId}`,
  stationStateChange: (areaId: number) => `shipment-status/state-change/station/${areaId}`,
  /** Keyed by shipment id. */
  shipmentStateChange: (shipmentId: number) => `shipment-status/state-change/shipment/${shipmentId}`,
  error: (shipmentId: number) => `shipment-status/error/${shipmentId}`,
  complete: (shipmentId: number) => `shipment-status/complete/${shipmentId}`,
} as const;

// ---------------------------------------------------------------------------
// Normalised events
// ---------------------------------------------------------------------------

export interface RealtimeIssue {
  type: IssueType;
  status?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface UnitPayload {
  shipment_id: number;
  unit_id?: string;
  unit_session_id?: number;
  increment_by?: number;
  images?: unknown[];
  issues?: RealtimeIssue[];
  identifiers?: { order_numbers?: string[]; total_pallets?: number; [k: string]: unknown };
  [k: string]: unknown;
}

export type InspectionEvent =
  /** An inspection opened at this station. */
  | { kind: 'started'; shipment: Shipment; raw: unknown }
  /** A unit is being captured. Images are arriving; counts are not final. */
  | { kind: 'unit-processing'; payload: UnitPayload; raw: unknown }
  /**
   * A unit finished. `issues` is the authoritative state for that unit —
   * replace rather than append. Empty means the unit was clean.
   */
  | { kind: 'unit-completed'; payload: UnitPayload; issues: RealtimeIssue[]; raw: unknown }
  /** Damage findings for a unit, which may arrive after `unit-completed`. */
  | { kind: 'damages-detected'; payload: UnitPayload; raw: unknown }
  /** Lifecycle transition. `progress` is 0–1, or null when not applicable. */
  | { kind: 'status'; shipmentId: number; status: ShipmentStatus | string; progress: number | null; raw: unknown }
  /** Paused or resumed, manually or by inactivity. */
  | { kind: 'state-change'; scope: 'shipment' | 'station'; payload: UnitPayload; raw: unknown }
  /** Final counts. This is the one to reconcile against. */
  | { kind: 'completed'; shipmentId: number; raw: unknown }
  | { kind: 'canceled'; shipmentId: number; raw: unknown }
  | { kind: 'error'; shipmentId: number; message?: string; raw: unknown };

export type InspectionEventKind = InspectionEvent['kind'];

export interface FeedBinding {
  /** Station name — required for `started`. */
  areaName?: string;
  /** Station id — required for every per-unit event. */
  areaId?: number;
  /** Shipment id — required for per-shipment lifecycle events. Set as it changes. */
  shipmentId?: number;
}

export interface InspectionFeedOptions {
  transport: RealtimeTransport;
  /**
   * Events received before any listener attaches are buffered and replayed to
   * the first listener. Prevents losing the `started` event to a React mount
   * race. Defaults to 50; set 0 to disable.
   */
  bufferSize?: number;
  onError?: (error: Error) => void;
}

type Listener = (event: InspectionEvent) => void;

/**
 * Subscribes to the topics a station needs and emits {@link InspectionEvent}.
 *
 * Rebinding is cheap: call {@link InspectionFeed.bind} whenever the station or
 * the shipment in progress changes and it diffs the subscriptions for you.
 */
export class InspectionFeed {
  private readonly transport: RealtimeTransport;
  private readonly listeners = new Set<Listener>();
  private readonly bound = new Map<string, (p: unknown) => void>();
  private readonly buffer: InspectionEvent[] = [];
  private readonly bufferSize: number;
  private readonly onError?: (error: Error) => void;
  private binding: FeedBinding = {};

  constructor(options: InspectionFeedOptions) {
    this.transport = options.transport;
    this.bufferSize = options.bufferSize ?? 50;
    this.onError = options.onError;
  }

  get state(): ConnectionState {
    return this.transport.state;
  }

  get currentBinding(): Readonly<FeedBinding> {
    return this.binding;
  }

  connect(): void {
    this.transport.connect();
  }

  onStateChange(handler: (state: ConnectionState, error?: Error) => void): () => void {
    return this.transport.onStateChange(handler);
  }

  /** Points the feed at a station and, optionally, the shipment in progress. */
  bind(binding: FeedBinding): void {
    this.binding = binding;
    const wanted = new Map<string, InspectionEventKind | 'update'>();

    wanted.set(topics.update(), 'update');
    if (binding.areaName) wanted.set(topics.start(binding.areaName), 'started');
    if (binding.areaId != null) {
      wanted.set(topics.unitProcessing(binding.areaId), 'unit-processing');
      wanted.set(topics.unitCompleted(binding.areaId), 'unit-completed');
      wanted.set(topics.damagesDetected(binding.areaId), 'damages-detected');
      wanted.set(topics.stationStateChange(binding.areaId), 'state-change');
    }
    if (binding.shipmentId != null) {
      wanted.set(topics.shipmentStateChange(binding.shipmentId), 'state-change');
      wanted.set(topics.error(binding.shipmentId), 'error');
      wanted.set(topics.complete(binding.shipmentId), 'completed');
    }

    for (const topic of [...this.bound.keys()]) {
      if (!wanted.has(topic)) this.unbindTopic(topic);
    }
    for (const [topic, kind] of wanted) {
      if (!this.bound.has(topic)) this.bindTopic(topic, kind);
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    if (this.buffer.length) {
      const replay = this.buffer.splice(0, this.buffer.length);
      for (const event of replay) listener(event);
    }
    return () => this.listeners.delete(listener);
  }

  close(): void {
    for (const topic of [...this.bound.keys()]) this.unbindTopic(topic);
    this.listeners.clear();
    this.buffer.length = 0;
    this.transport.close();
  }

  private bindTopic(topic: string, kind: InspectionEventKind | 'update'): void {
    const handler = (payload: unknown) => {
      try {
        const event = normalize(kind, payload, topic);
        if (event) this.emit(event);
      } catch (err) {
        this.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    };
    this.bound.set(topic, handler);
    this.transport.on(topic, handler);
  }

  private unbindTopic(topic: string): void {
    const handler = this.bound.get(topic);
    if (handler) this.transport.off(topic, handler);
    this.bound.delete(topic);
  }

  private emit(event: InspectionEvent): void {
    if (this.listeners.size === 0) {
      if (this.bufferSize > 0) {
        this.buffer.push(event);
        if (this.buffer.length > this.bufferSize) this.buffer.shift();
      }
      return;
    }
    for (const listener of this.listeners) listener(event);
  }
}

const CANCEL_STATUSES = new Set(['canceled', 'cancelled', 'deleted']);

function normalize(
  kind: InspectionEventKind | 'update',
  raw: unknown,
  topic: string,
): InspectionEvent | null {
  const payload = (raw ?? {}) as Record<string, unknown>;

  switch (kind) {
    case 'started': {
      const shipment = (payload['shipment'] ?? payload) as Shipment;
      return shipment?.id ? { kind: 'started', shipment, raw } : null;
    }

    case 'update': {
      const shipmentId = Number(payload['shipment_id']);
      if (!Number.isFinite(shipmentId)) return null;
      const status = String(payload['status'] ?? '');
      const progressRaw = payload['progress'];
      const progress = typeof progressRaw === 'number' ? progressRaw : null;

      if (status === 'completed') return { kind: 'completed', shipmentId, raw };
      if (CANCEL_STATUSES.has(status)) return { kind: 'canceled', shipmentId, raw };
      return { kind: 'status', shipmentId, status, progress, raw };
    }

    case 'unit-processing':
      return { kind: 'unit-processing', payload: payload as UnitPayload, raw };

    case 'unit-completed': {
      const issues = Array.isArray(payload['issues'])
        ? (payload['issues'] as RealtimeIssue[])
        : [];
      return { kind: 'unit-completed', payload: payload as UnitPayload, issues, raw };
    }

    case 'damages-detected':
      return { kind: 'damages-detected', payload: payload as UnitPayload, raw };

    case 'state-change':
      return {
        kind: 'state-change',
        scope: topic.includes('/station/') ? 'station' : 'shipment',
        payload: payload as UnitPayload,
        raw,
      };

    case 'completed': {
      const shipmentId = Number(payload['shipment_id']);
      return Number.isFinite(shipmentId) ? { kind: 'completed', shipmentId, raw } : null;
    }

    case 'error': {
      const shipmentId = Number(payload['shipment_id']);
      const message = typeof payload['message'] === 'string' ? payload['message'] : undefined;
      return { kind: 'error', shipmentId, message, raw };
    }

    default:
      return null;
  }
}
