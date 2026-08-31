'use client';

import * as React from 'react';
import { ArvistClient, type ArvistClientConfig } from '../core/client';
import {
  createErrorMessageResolver,
  type ArvistErrorCode,
  type ErrorMessageResolver,
} from '../core/errors';
import {
  DEFAULT_EXCEPTION_COPY,
  type ExceptionCopy,
  type PartialExceptionCopy,
} from '../core/exceptions';
import {
  InspectionFeed,
  createSocketIoTransport,
  type RealtimeTransport,
  type SocketIoFactory,
} from '../core/realtime';

export interface ArvistProviderProps extends React.PropsWithChildren {
  /** Client config, or a pre-built client if you need to share one. */
  config?: ArvistClientConfig;
  client?: ArvistClient;
  /**
   * Realtime setup. Omit to run REST-only — hooks that need the feed will
   * report `realtimeAvailable: false` rather than throwing.
   */
  realtime?: ArvistRealtimeConfig;
  /** Override any operator-facing error copy, e.g. for localisation. */
  errorMessages?: Partial<Record<ArvistErrorCode, string>>;
  /** Override exception titles and resolution labels. Partial — unset strings keep their defaults. */
  copy?: PartialExceptionCopy;
  /**
   * Treat shortages as non-blocking because an upstream system completes the
   * shipment out of band (a box-closure scan, for example).
   */
  autoCompleted?: boolean;
}

export type ArvistRealtimeConfig =
  | {
      /**
       * `socket.io-client`'s `io`. Passing it explicitly keeps socket.io an
       * optional dependency of this package.
       */
      io: SocketIoFactory;
      /** Defaults to the client's `baseUrl`. */
      url?: string;
      path?: string;
      auth?: Record<string, unknown>;
      withCredentials?: boolean;
    }
  | { transport: RealtimeTransport };

export interface ArvistContextValue {
  client: ArvistClient;
  feed: InspectionFeed | null;
  realtimeAvailable: boolean;
  resolveErrorMessage: ErrorMessageResolver;
  copy: ExceptionCopy;
  autoCompleted: boolean;
}

const ArvistContext = React.createContext<ArvistContextValue | null>(null);

/**
 * Supplies the API client, the realtime feed, and display copy to every hook.
 *
 * ```tsx
 * import { io } from 'socket.io-client';
 *
 * <ArvistProvider
 *   config={{ baseUrl: 'https://arvist.example.com', token: getToken }}
 *   realtime={{ io }}
 * >
 *   <PackStation />
 * </ArvistProvider>
 * ```
 */
export function ArvistProvider({
  children,
  config,
  client: providedClient,
  realtime,
  errorMessages,
  copy,
  autoCompleted = false,
}: ArvistProviderProps) {
  if (!providedClient && !config) {
    throw new Error('ArvistProvider: pass either `config` or `client`.');
  }

  const client = React.useMemo(
    () => providedClient ?? new ArvistClient(config!),
    // A new client per config identity; memoise `config` upstream to keep it stable.
    [providedClient, config],
  );

  const feed = React.useMemo(() => {
    if (!realtime) return null;
    const transport =
      'transport' in realtime
        ? realtime.transport
        : createSocketIoTransport({
            url: realtime.url ?? config?.baseUrl ?? '',
            path: realtime.path,
            auth: realtime.auth,
            withCredentials: realtime.withCredentials ?? true,
            io: realtime.io,
          });
    return new InspectionFeed({ transport });
  }, [realtime, config?.baseUrl]);

  React.useEffect(() => {
    if (!feed) return;
    feed.connect();
    return () => feed.close();
  }, [feed]);

  const value = React.useMemo<ArvistContextValue>(
    () => ({
      client,
      feed,
      realtimeAvailable: feed !== null,
      resolveErrorMessage: createErrorMessageResolver(errorMessages),
      copy: {
        titles: { ...DEFAULT_EXCEPTION_COPY.titles, ...copy?.titles },
        actions: { ...DEFAULT_EXCEPTION_COPY.actions, ...copy?.actions },
      },
      autoCompleted,
    }),
    [client, feed, errorMessages, copy, autoCompleted],
  );

  return <ArvistContext.Provider value={value}>{children}</ArvistContext.Provider>;
}

export function useArvist(): ArvistContextValue {
  const ctx = React.useContext(ArvistContext);
  if (!ctx) throw new Error('useArvist must be used inside <ArvistProvider>.');
  return ctx;
}

/** The API client on its own, for calls the hooks do not wrap. */
export function useArvistClient(): ArvistClient {
  return useArvist().client;
}
