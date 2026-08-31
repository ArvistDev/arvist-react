/**
 * Error normalisation.
 *
 * The API returns errors in a few shapes depending on which layer rejected the
 * request (edge, auth middleware, controller). Everything the SDK throws is an
 * {@link ArvistError} with a stable `code`, so integrators can branch on the
 * code and show `message` to an operator without parsing strings.
 */

export type ArvistErrorCode =
  // transport / edge
  | 'network_error'
  | 'timeout'
  | 'edge_forbidden'
  // auth
  | 'unauthorized'
  | 'forbidden'
  // request
  | 'bad_request'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'validation_failed'
  // domain
  | 'station_not_found'
  | 'station_not_bound'
  | 'shipment_not_found'
  | 'shipment_already_open'
  | 'completion_blocked'
  | 'issue_not_found'
  // server
  | 'server_error'
  | 'unknown';

export interface ArvistErrorInit {
  code: ArvistErrorCode;
  message: string;
  status?: number;
  /** Raw body the API returned, for logging. Never render this to operators. */
  detail?: unknown;
  requestId?: string;
  /** `true` when retrying the identical request could plausibly succeed. */
  retryable?: boolean;
  cause?: unknown;
}

export class ArvistError extends Error {
  readonly code: ArvistErrorCode;
  readonly status?: number;
  readonly detail?: unknown;
  readonly requestId?: string;
  readonly retryable: boolean;

  constructor(init: ArvistErrorInit) {
    super(init.message, init.cause ? { cause: init.cause } : undefined);
    this.name = 'ArvistError';
    this.code = init.code;
    this.status = init.status;
    this.detail = init.detail;
    this.requestId = init.requestId;
    this.retryable = init.retryable ?? false;
  }

  static is(err: unknown): err is ArvistError {
    return err instanceof ArvistError;
  }
}

/**
 * Operator-facing copy for each error code.
 *
 * These are deliberately plain and actionable — they are written to be shown on
 * a packstation screen, not to a developer. Override any of them via
 * `errorMessages` on the client config, or localise with
 * {@link createErrorMessageResolver}.
 */
export const DEFAULT_ERROR_MESSAGES: Record<ArvistErrorCode, string> = {
  network_error: 'Cannot reach Arvist. Check the network connection and try again.',
  timeout: 'Arvist did not respond in time. Try again.',
  edge_forbidden: 'This device is not allowed to reach Arvist. Contact your administrator.',

  unauthorized: 'Your session has expired. Sign in again.',
  forbidden: 'You do not have permission to do that.',

  bad_request: 'That request was not valid. Check the details and try again.',
  not_found: 'That record no longer exists.',
  conflict: 'Someone else changed this record. Refresh and try again.',
  rate_limited: 'Too many requests. Wait a moment and try again.',
  validation_failed: 'Some required information is missing or incorrect.',

  station_not_found: 'That station name is not configured in Arvist.',
  station_not_bound:
    'No screen is currently set to this station, so the inspection cannot open. ' +
    'Select the station in Shipment Inspection Settings.',
  shipment_not_found: 'That shipment could not be found.',
  shipment_already_open: 'An inspection is already open at this station.',
  completion_blocked: 'This inspection cannot be completed while a shortage is unresolved.',
  issue_not_found: 'That exception has already been closed.',

  server_error: 'Arvist hit an unexpected error. Try again, and report it if it repeats.',
  unknown: 'Something went wrong.',
};

export type ErrorMessageResolver = (code: ArvistErrorCode, fallback: string) => string;

/** Builds a resolver from a partial override map, falling back to the defaults. */
export function createErrorMessageResolver(
  overrides?: Partial<Record<ArvistErrorCode, string>>,
): ErrorMessageResolver {
  return (code, fallback) => overrides?.[code] ?? DEFAULT_ERROR_MESSAGES[code] ?? fallback;
}

/** Copy for a caught error. Safe to call with anything, including non-Errors. */
export function getDisplayMessage(err: unknown, resolve?: ErrorMessageResolver): string {
  const resolver = resolve ?? ((code, fallback) => DEFAULT_ERROR_MESSAGES[code] ?? fallback);
  if (ArvistError.is(err)) return resolver(err.code, err.message);
  return resolver('unknown', DEFAULT_ERROR_MESSAGES.unknown);
}

const STATUS_CODES: Record<number, ArvistErrorCode> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  422: 'validation_failed',
  429: 'rate_limited',
};

/**
 * Domain hints. The API reports most controller failures as 400 with a prose
 * message, so we narrow those to a specific code by matching the message.
 * Ordering matters — the first match wins.
 */
const DOMAIN_HINTS: [RegExp, ArvistErrorCode][] = [
  [/quality ?station .*(not found|does not exist)|invalid area/i, 'station_not_found'],
  [/no (browser|client|screen).*(station|selected)|station .*not (selected|bound|responding)/i, 'station_not_bound'],
  [/shipment .*not found/i, 'shipment_not_found'],
  [/already (in progress|started|open)/i, 'shipment_already_open'],
  [/shortage|cannot complete|open issues/i, 'completion_blocked'],
  [/issue .*not found/i, 'issue_not_found'],
  [/required|must be|invalid/i, 'validation_failed'],
];

function extractMessage(body: unknown): string | undefined {
  if (typeof body === 'string' && body.trim()) return body.trim();
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    for (const key of ['error', 'message', 'detail']) {
      const v = b[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  return undefined;
}

/** Maps an HTTP response (plus its parsed body) onto an {@link ArvistError}. */
export function errorFromResponse(
  status: number,
  body: unknown,
  requestId?: string,
): ArvistError {
  const raw = extractMessage(body);
  let code: ArvistErrorCode = STATUS_CODES[status] ?? (status >= 500 ? 'server_error' : 'unknown');

  // Cloudflare Access rejects the handshake before the API sees it; the body is
  // HTML rather than JSON, so a 403 with no JSON error is an edge rejection.
  if (status === 403 && !raw) code = 'edge_forbidden';

  if (raw && (status === 400 || status === 404 || status === 409)) {
    for (const [pattern, hinted] of DOMAIN_HINTS) {
      if (pattern.test(raw)) {
        code = hinted;
        break;
      }
    }
  }

  return new ArvistError({
    code,
    message: DEFAULT_ERROR_MESSAGES[code],
    status,
    detail: raw ?? body,
    requestId,
    retryable: status === 429 || status >= 500,
  });
}
