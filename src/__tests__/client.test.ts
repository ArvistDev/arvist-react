import { describe, expect, it, vi } from 'vitest';
import { ArvistClient } from '../core/client';
import { ArvistError } from '../core/errors';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function makeClient(fetchImpl: typeof globalThis.fetch, over = {}) {
  return new ArvistClient({
    baseUrl: 'https://arvist.example.com',
    retries: 0,
    fetch: fetchImpl,
    ...over,
  });
}

describe('request construction', () => {
  it('prefixes the API path and merges the default site id', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse([]));
    await makeClient(fetchImpl as never, { siteId: 3 }).listStations();

    const [url] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(
      'https://arvist.example.com/v1/api/locations/quality-stations?site_id=3',
    );
  });

  it('does not override an explicit site id', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse([]));
    await makeClient(fetchImpl as never, { siteId: 3 }).listStations({ site_id: 9 });
    expect(String(fetchImpl.mock.calls[0]![0])).toContain('site_id=9');
  });

  it('repeats array params rather than joining them', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ data: [], total: 0, page: 1, limit: 20 }));
    await makeClient(fetchImpl as never).listShipments({ orderNumbers: ['A', 'B'] });
    const url = String(fetchImpl.mock.calls[0]![0]);
    expect(url).toContain('orderNumbers=A');
    expect(url).toContain('orderNumbers=B');
  });

  it('sends the bearer token and Cloudflare Access headers', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse([]));
    await makeClient(fetchImpl as never, {
      token: async () => 'tok',
      cloudflareAccess: { clientId: 'cf-id', clientSecret: 'cf-secret' },
    }).listStations();

    const headers = fetchImpl.mock.calls[0]![1]!.headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer tok');
    expect(headers.get('CF-Access-Client-Id')).toBe('cf-id');
    expect(headers.get('CF-Access-Client-Secret')).toBe('cf-secret');
  });
});

describe('response envelopes', () => {
  // The API is inconsistent here by design of its own history: reads return
  // their payload bare, writes return a string, `{ message }`, or
  // `{ message, shipment }`. These pin the client to the real shapes.

  it('returns a bare array from a list read', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse([{ id: 1 }]));
    await expect(makeClient(fetchImpl as never).listStations()).resolves.toEqual([{ id: 1 }]);
  });

  it('returns a bare object from a single read', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ id: 9, shipment_key: 'k', progress: 0.5 }),
    );
    await expect(makeClient(fetchImpl as never).getShipment(9)).resolves.toMatchObject({
      id: 9,
      progress: 0.5,
    });
  });

  it('keeps the envelope on paginated responses', async () => {
    const body = { data: [{ id: 1 }], total: 1, page: 1, limit: 20 };
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse(body));
    await expect(makeClient(fetchImpl as never).listShipments()).resolves.toEqual(body);
  });

  it('pulls the shipment out of the start envelope, which keys it `shipment`', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ message: 'Initiating Shipment Inspection', shipment: { id: 9001 } }),
    );
    await expect(
      makeClient(fetchImpl as never).startInspection({ area_name: 'Z01' }),
    ).resolves.toMatchObject({ id: 9001 });
  });

  it('fails loudly when start returns no shipment', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ message: 'ok' }),
    );
    await expect(
      makeClient(fetchImpl as never).startInspection({ area_name: 'Z01' }),
    ).rejects.toMatchObject({ code: 'server_error' });
  });

  it('flattens a bare-string write response', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse('Shipment count submitted'),
    );
    await expect(makeClient(fetchImpl as never).submitInspection(1)).resolves.toEqual({
      message: 'Shipment count submitted',
      raw: 'Shipment count submitted',
    });
  });

  it('surfaces the updated shipment a write hands back', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ message: 'Shipment inspection resumed', shipment: { id: 9001 } }),
    );
    const result = await makeClient(fetchImpl as never).resumeShipment(9001);
    expect(result.message).toBe('Shipment inspection resumed');
    expect(result.shipment).toMatchObject({ id: 9001 });
  });

  it('accepts the { message, data } form some writes use', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ message: 'Shipment inspection cancelled', data: { id: 9001 } }),
    );
    const result = await makeClient(fetchImpl as never).cancelShipment(9001);
    expect(result.shipment).toMatchObject({ id: 9001 });
  });

  it('throws a normalised ArvistError on failure', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ message: 'Shipment not found' }, 400));
    await expect(makeClient(fetchImpl as never).getShipment(1)).rejects.toMatchObject({
      name: 'ArvistError',
      code: 'shipment_not_found',
    });
  });

  it('reports an unreachable API as a network error', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => {
      throw new TypeError('fetch failed');
    });
    await expect(makeClient(fetchImpl as never).getShipment(1)).rejects.toMatchObject({
      code: 'network_error',
    });
  });
});

describe('retries', () => {
  it('retries a 500 and succeeds', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => {
      calls += 1;
      return calls === 1 ? jsonResponse({}, 500) : jsonResponse([{ id: 1 }]);
    });
    await expect(makeClient(fetchImpl as never, { retries: 1 }).listStations()).resolves.toEqual([
      { id: 1 },
    ]);
    expect(calls).toBe(2);
  });

  it('does not retry a 400', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ message: 'bad' }, 400));
    await expect(makeClient(fetchImpl as never, { retries: 3 }).listStations()).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('idempotency', () => {
  it('collapses repeat starts with the same key into one request', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ message: 'started', shipment: { id: 1 } }),
    );
    const client = makeClient(fetchImpl as never);

    const [a, b] = await Promise.all([
      client.startInspection({ area_name: 'Z01', order_numbers: ['ORD-1'] }, { idempotencyKey: 'ORD-1' }),
      client.startInspection({ area_name: 'Z01', order_numbers: ['ORD-1'] }, { idempotencyKey: 'ORD-1' }),
    ]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it('keeps different keys separate', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ message: 'started', shipment: { id: 1 } }),
    );
    const client = makeClient(fetchImpl as never);
    await Promise.all([
      client.startInspection({ order_numbers: ['A'] }, { idempotencyKey: 'A' }),
      client.startInspection({ order_numbers: ['B'] }, { idempotencyKey: 'B' }),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('findStationByName', () => {
  it('matches on area_name or name, case-insensitively', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse([{ id: 1, name: 'PS 1', area_id: 42, area_name: 'Z01-PS-001' }]),
    );
    const station = await makeClient(fetchImpl as never).findStationByName('z01-ps-001');
    expect(station.area_id).toBe(42);
  });

  it('raises station_not_found and lists what does exist', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse([{ id: 1, name: 'PS 1', area_id: 42, area_name: 'Z01-PS-001' }]),
    );
    const err = await makeClient(fetchImpl as never)
      .findStationByName('Z09-PS-999')
      .catch((e) => e);

    expect(ArvistError.is(err)).toBe(true);
    expect(err.code).toBe('station_not_found');
    expect((err.detail as { known: string[] }).known).toEqual(['Z01-PS-001']);
  });
});

describe('submit carries staged count corrections', () => {
  // There is no endpoint for editing a line item's count on its own — the API
  // applies corrections as part of submission.
  it('sends line_items alongside the shipment id', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse('Shipment count submitted'),
    );
    await makeClient(fetchImpl as never).submitInspection(9001, {
      line_items: [{ id: 3, actual_quantity: 4, is_edited: true }],
    });

    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body));
    expect(body).toMatchObject({
      shipment_id: 9001,
      line_items: [{ id: 3, actual_quantity: 4, is_edited: true }],
    });
  });

  it('omits line_items when nothing was corrected', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse('Shipment count submitted'),
    );
    await makeClient(fetchImpl as never).submitInspection(9001);
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body));
    expect(body.line_items).toBeUndefined();
  });
});

describe('resolveIssueById', () => {
  it('PATCHes the keyword action to the per-issue resolve endpoint', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ message: 'Issue resolved' }),
    );
    const result = await makeClient(fetchImpl as never).resolveIssueById({
      issue_id: 42,
      action: 'assign',
      annotation_id: 7,
      sku: 'SKU-1',
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain('/shipment-issue/42/resolve');
    expect(init!.method).toBe('PATCH');
    expect(JSON.parse(String(init!.body))).toMatchObject({
      action: 'assign',
      annotation_id: 7,
      sku: 'SKU-1',
    });
    expect(result.message).toBe('Issue resolved');
  });
});

describe('updateUnknownProduct', () => {
  // Reclassification is annotation-based; the action is inferred server-side
  // from the annotation's shape, so the client must pass it through unaltered.
  it('posts the annotation envelope verbatim', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ message: 'Unknown product updated successfully', shipment: { id: 1 } }),
    );
    const annotation = { id: 7, category_id: 3 as const, identifiers: { items_quantity: 2 } };
    const result = await makeClient(fetchImpl as never).updateUnknownProduct({
      shipment_id: 1,
      image_id: 5,
      annotation,
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain('/shipment/unknown-product/update');
    expect(init!.method).toBe('PUT');
    expect(JSON.parse(String(init!.body))).toMatchObject({ image_id: 5, annotation });
    expect(result.shipment).toMatchObject({ id: 1 });
  });
});
