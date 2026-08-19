// HTTP transport for the Directus SDK client.
//
// The SDK accepts an injected `fetch` via `globals.fetch`. We supply an
// axios-backed one rather than Node's global fetch for two reasons:
//
//   1. TLS. Node's fetch has no httpsAgent and undici's Agent is not
//      importable without adding a dependency, so the DIRECTUS_HTTPS_*
//      configuration would otherwise stop working.
//   2. `meta`. The SDK's extractData() returns only the envelope's `data`,
//      discarding `meta` before any SDK-level hook can observe it. Several
//      tools render meta.total_count for pagination, so the envelope has to be
//      captured here — this is the last point that still sees the raw body.
//
// Retry/backoff also lives here, with a per-call attempt counter (the previous
// implementation kept it on the client instance, where it was never reset on
// success and leaked across requests).

import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { logger } from '../utils/logger.js';
import { createHttpsAgent } from './https-agent.js';
import { SERVER_NAME, SERVER_VERSION } from '../version.js';
import { DirectusConfig, DirectusResponse } from '../types/directus.js';

export interface Envelope {
  data?: unknown;
  meta?: DirectusResponse['meta'];
}

export type EnvelopeListener = (envelope: Envelope) => void;

/** Matches the SDK's FetchInterface. */
export type FetchLike = (input: string | any, init?: any) => Promise<unknown>;

function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

/**
 * Build a Response the SDK's extractData() can consume.
 *
 * Empty bodies need care: a 204 carries no body at all (passing one to the
 * Response constructor throws), and an empty error body still has to look like
 * a Directus error so isDirectusError() stays true downstream.
 */
function toResponse(res: AxiosResponse<string>): Response {
  const headers = new Headers();
  for (const [key, value] of Object.entries(res.headers ?? {})) {
    if (typeof value === 'string') headers.set(key, value);
  }

  const body = typeof res.data === 'string' ? res.data : '';
  const ok = res.status >= 200 && res.status < 300;

  if (res.status === 204 || body === '') {
    if (res.status === 204) {
      // extractData() inspects Content-Type before it checks for 204, so a
      // bodyless response still advertising JSON would be handed to .json()
      // and throw. Dropping the header lets it take the 204 -> null path.
      headers.delete('content-type');
      return new Response(null, { status: 204, headers });
    }

    headers.set('content-type', 'application/json');
    const synthetic = ok
      ? '{"data":null}'
      : JSON.stringify({
          errors: [
            {
              message: `HTTP ${res.status} ${res.statusText || ''}`.trim(),
              extensions: { code: 'UNKNOWN', status: res.status },
            },
          ],
        });
    return new Response(synthetic, { status: res.status, headers });
  }

  return new Response(body, { status: res.status, headers });
}

/**
 * Observe the response body: hand `meta` to the listener, and stamp the HTTP
 * status onto error extensions so callers can distinguish e.g. a 413 from an
 * import that exceeded IMPORT_MAX_FILE_SIZE.
 */
function inspectBody(res: AxiosResponse<string>, onEnvelope?: EnvelopeListener): AxiosResponse<string> {
  const contentType = String(res.headers?.['content-type'] ?? '').toLowerCase();
  if (!contentType.includes('json') || typeof res.data !== 'string' || res.data === '') return res;

  let parsed: any;
  try {
    parsed = JSON.parse(res.data);
  } catch {
    return res;
  }
  if (!parsed || typeof parsed !== 'object') return res;

  if (onEnvelope && 'meta' in parsed) onEnvelope({ data: parsed.data, meta: parsed.meta });

  if (Array.isArray(parsed.errors)) {
    let touched = false;
    for (const err of parsed.errors) {
      if (err && typeof err === 'object') {
        err.extensions = { ...(err.extensions ?? {}) };
        if (err.extensions.status === undefined) {
          err.extensions.status = res.status;
          touched = true;
        }
      }
    }
    if (touched) return { ...res, data: JSON.stringify(parsed) };
  }

  return res;
}

/**
 * Create the fetch implementation handed to the SDK.
 *
 * `onEnvelope` is called once per response that carries a `meta` block.
 */
export function createDirectusFetch(config: DirectusConfig, onEnvelope?: EnvelopeListener): FetchLike {
  const httpsAgent = createHttpsAgent(config.https);
  const maxRetries = config.retries ?? 3;
  const baseDelay = config.retryDelay ?? 1000;
  const maxDelay = config.maxRetryDelay ?? 10000;

  const instance: AxiosInstance = axios.create({
    timeout: config.timeout,
    ...(httpsAgent && { httpsAgent }),
    // Never throw on status: the SDK's extractData() turns non-2xx bodies into
    // its own RequestError, which parseDirectusError() then maps.
    validateStatus: () => true,
    // Keep the body as text so the envelope can be inspected before the SDK
    // consumes it, and so non-JSON responses pass through untouched.
    responseType: 'text',
    transitional: { silentJSONParsing: false, forcedJSONParsing: false, clarifyTimeoutError: true },
    maxRedirects: 5,
  });

  return async (input: string | any, init: any = {}): Promise<unknown> => {
    const url = String(input);
    const method = String(init.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {
      'User-Agent': `${SERVER_NAME}/${SERVER_VERSION}`,
      ...(init.headers ?? {}),
    };

    let attempt = 0;

    for (;;) {
      const requestId = generateRequestId();
      const startTime = Date.now();
      logger.apiRequest(method, url, { requestId });

      let res: AxiosResponse<string> | undefined;
      let transportError: unknown;

      try {
        res = await instance.request<string>({
          url,
          method,
          headers,
          ...(init.body !== undefined && init.body !== null && { data: init.body }),
          ...(httpsAgent && { httpsAgent }),
        });
      } catch (error) {
        transportError = error;
      }

      const duration = Date.now() - startTime;

      if (res) {
        logger.apiResponse(method, url, res.status, duration, { requestId });
      } else {
        logger.apiResponse(method, url, 0, duration, {
          requestId,
          error: transportError instanceof Error ? transportError.message : 'Unknown error',
        });
      }

      const retryable = res ? isRetryableStatus(res.status) : true;

      if (retryable && attempt < maxRetries) {
        attempt++;
        const delay = Math.min(baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000, maxDelay);
        logger.info('Retrying request', { attempt, delay, maxRetries });
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      if (!res) throw transportError;

      return toResponse(inspectBody(res, onEnvelope));
    }
  };
}
