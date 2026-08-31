import { useMemo, useState } from 'react';
import { ArvistProvider, type ArvistClientConfig } from '@arvist/react';
import { createMockBackend } from './mock/backend';
import { PackStation } from './pack-station';

/**
 * Wires the SDK up the way an integrator would.
 *
 * Two things are worth copying out of here. First, `config` is memoised — the
 * provider rebuilds its client whenever that object's identity changes, so an
 * inline literal would tear down the connection on every render. Second,
 * `autoCompleted` is set to match how shipments actually close in this
 * workflow, which is what decides whether a shortage blocks the operator.
 */
export function App() {
  // Real deployments pass no `fetch`/`transport` — the SDK uses the network.
  const backend = useMemo(() => createMockBackend(), []);
  const liveUrl = import.meta.env.VITE_ARVIST_URL as string | undefined;

  const [autoCompleted, setAutoCompleted] = useState(false);

  const config = useMemo<ArvistClientConfig>(
    () =>
      liveUrl
        ? {
            baseUrl: liveUrl,
            token: import.meta.env.VITE_ARVIST_TOKEN as string | undefined,
            // Both layers are independent: Access authenticates the device at
            // the edge, the bearer token authenticates the caller.
            cloudflareAccess:
              import.meta.env.VITE_CF_ACCESS_CLIENT_ID && import.meta.env.VITE_CF_ACCESS_CLIENT_SECRET
                ? {
                    clientId: import.meta.env.VITE_CF_ACCESS_CLIENT_ID as string,
                    clientSecret: import.meta.env.VITE_CF_ACCESS_CLIENT_SECRET as string,
                  }
                : undefined,
            siteId: 1,
          }
        : { baseUrl: 'https://mock.arvist.local', siteId: 1, fetch: backend.fetch, retries: 0 },
    [liveUrl, backend],
  );

  const realtime = useMemo(
    () => (liveUrl ? undefined : { transport: backend.transport }),
    [liveUrl, backend],
  );

  return (
    <ArvistProvider
      config={config}
      realtime={realtime}
      autoCompleted={autoCompleted}
      // Warehouse copy differs from the SDK defaults in places; override rather
      // than fork the components.
      copy={{ actions: { remove_item: 'Pulled from tote' } }}
    >
      <PackStation
        backend={backend}
        live={Boolean(liveUrl)}
        autoCompleted={autoCompleted}
        onAutoCompletedChange={setAutoCompleted}
      />
    </ArvistProvider>
  );
}
