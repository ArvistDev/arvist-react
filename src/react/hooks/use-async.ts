'use client';

import * as React from 'react';
import { ArvistError } from '../../core/errors';

export interface AsyncState<T> {
  data: T | undefined;
  error: ArvistError | undefined;
  loading: boolean;
}

export interface AsyncResult<T> extends AsyncState<T> {
  refresh: () => Promise<void>;
  setData: React.Dispatch<React.SetStateAction<T | undefined>>;
}

/**
 * Minimal fetch-on-mount helper.
 *
 * Deliberately not a cache: the SDK does not want an opinion about your data
 * layer. If you already run TanStack Query or SWR, call the client directly and
 * keep your own caching — every hook here exposes the underlying client.
 */
export function useAsync<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  deps: React.DependencyList,
  options: { enabled?: boolean } = {},
): AsyncResult<T> {
  const enabled = options.enabled ?? true;
  const [state, setState] = React.useState<AsyncState<T>>({
    data: undefined,
    error: undefined,
    loading: enabled,
  });

  const fnRef = React.useRef(fn);
  fnRef.current = fn;

  const run = React.useCallback(
    async (signal: AbortSignal) => {
      setState((s) => ({ ...s, loading: true, error: undefined }));
      try {
        const data = await fnRef.current(signal);
        if (!signal.aborted) setState({ data, error: undefined, loading: false });
      } catch (err) {
        if (signal.aborted) return;
        setState({
          data: undefined,
          loading: false,
          error: ArvistError.is(err)
            ? err
            : new ArvistError({ code: 'unknown', message: 'Something went wrong.', cause: err }),
        });
      }
    },
    [],
  );

  React.useEffect(() => {
    if (!enabled) {
      setState({ data: undefined, error: undefined, loading: false });
      return;
    }
    const controller = new AbortController();
    void run(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, run, ...deps]);

  const refresh = React.useCallback(async () => {
    const controller = new AbortController();
    await run(controller.signal);
  }, [run]);

  return {
    ...state,
    refresh,
    setData: (update) =>
      setState((s) => ({
        ...s,
        data: typeof update === 'function' ? (update as (p: T | undefined) => T | undefined)(s.data) : update,
      })),
  };
}
