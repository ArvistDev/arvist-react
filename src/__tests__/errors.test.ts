import { describe, expect, it } from 'vitest';
import {
  ArvistError,
  DEFAULT_ERROR_MESSAGES,
  createErrorMessageResolver,
  errorFromResponse,
  getDisplayMessage,
} from '../core/errors';

describe('errorFromResponse', () => {
  it('maps standard statuses onto codes', () => {
    expect(errorFromResponse(401, { error: 'Unauthorized' }).code).toBe('unauthorized');
    expect(errorFromResponse(429, {}).code).toBe('rate_limited');
    expect(errorFromResponse(500, {}).code).toBe('server_error');
  });

  it('reads a 403 with no JSON body as an edge rejection', () => {
    expect(errorFromResponse(403, '').code).toBe('edge_forbidden');
    expect(errorFromResponse(403, { error: 'Forbidden' }).code).toBe('forbidden');
  });

  it('narrows a prose 400 to a domain code', () => {
    expect(errorFromResponse(400, { error: 'Shipment not found' }).code).toBe('shipment_not_found');
    expect(errorFromResponse(400, { error: 'Quality station not found' }).code).toBe('station_not_found');
    expect(errorFromResponse(400, { error: 'Unit session ID is required' }).code).toBe('validation_failed');
  });

  it('marks 429 and 5xx retryable, and 4xx not', () => {
    expect(errorFromResponse(429, {}).retryable).toBe(true);
    expect(errorFromResponse(503, {}).retryable).toBe(true);
    expect(errorFromResponse(400, {}).retryable).toBe(false);
  });

  it('keeps the raw body for logging but shows operator copy', () => {
    const err = errorFromResponse(500, { error: 'ECONNREFUSED postgres:5432' });
    expect(err.detail).toBe('ECONNREFUSED postgres:5432');
    expect(err.message).toBe(DEFAULT_ERROR_MESSAGES.server_error);
  });

  it('carries the request id through', () => {
    expect(errorFromResponse(500, {}, 'req-1').requestId).toBe('req-1');
  });
});

describe('message resolution', () => {
  it('has copy for every code', () => {
    for (const [code, message] of Object.entries(DEFAULT_ERROR_MESSAGES)) {
      expect(message, code).toBeTruthy();
    }
  });

  it('applies overrides and falls back for the rest', () => {
    const resolve = createErrorMessageResolver({ unauthorized: 'Sesión expirada.' });
    expect(resolve('unauthorized', '')).toBe('Sesión expirada.');
    expect(resolve('timeout', '')).toBe(DEFAULT_ERROR_MESSAGES.timeout);
  });

  it('handles non-Arvist errors without throwing', () => {
    expect(getDisplayMessage(new TypeError('boom'))).toBe(DEFAULT_ERROR_MESSAGES.unknown);
    expect(getDisplayMessage(undefined)).toBe(DEFAULT_ERROR_MESSAGES.unknown);
  });

  it('narrows with the type guard', () => {
    const err: unknown = new ArvistError({ code: 'timeout', message: 'x' });
    expect(ArvistError.is(err)).toBe(true);
    expect(ArvistError.is(new Error('x'))).toBe(false);
  });
});
