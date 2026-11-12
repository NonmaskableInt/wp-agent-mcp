import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { enrich_error, explain_http_failure, explain_network_error } from './errors.js';
import { BridgeError, BridgeEnvelope } from './types.js';
import { fetch_same_origin, is_redirect, redirect_message } from './safe-fetch.js';

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;

/**
 * The same Basic credentials twice: `Authorization`, and `X-Agent-Authorization` for networks that strip the
 * former (the bridge only uses the second when the first is absent).
 */
function auth_headers(): Record<string, string> {
  const creds = `Basic ${Buffer.from(`${config.wp.username}:${config.wp.appPassword}`).toString('base64')}`;
  return { Authorization: creds, 'X-Agent-Authorization': creds };
}

function log_debug(method: string, path: string, status: number, elapsed: number): void {
  if (config.logLevel === 'debug') {
    process.stderr.write(`[debug] ${method} ${path} → ${status} (${elapsed}ms)\n`);
  }
}

async function parse_response<T>(res: Response): Promise<T> {
  let text = '';
  let body: BridgeEnvelope<T> | undefined;
  try {
    text = await res.text();
    body = JSON.parse(text) as BridgeEnvelope<T>;
  } catch {
    body = undefined;
  }

  if (!body || typeof body !== 'object') {
    const e = explain_http_failure({ status: res.status, url: res.url, contentType: res.headers.get('content-type') ?? '', body: text });
    throw new BridgeError(e.code, e.message, res.status);
  }

  if (!body.ok) {
    const code = body.code ?? 'unknown_error';
    throw new BridgeError(code, enrich_error(code, body.message ?? 'Unknown error', res.status), res.status);
  }

  return body.data as T;
}

async function fetch_with_retry(
  url: string,
  init: RequestInit,
  attempt = 1,
): Promise<Response> {
  try {
    const res = await fetch_same_origin(url, init);
    if (is_redirect(res.status)) throw new BridgeError('redirect_blocked', redirect_message(res, url), res.status);
    if (res.status >= 500 && attempt < MAX_RETRIES) {
      const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
      await new Promise(r => setTimeout(r, delay));
      return fetch_with_retry(url, init, attempt + 1);
    }
    return res;
  } catch (err) {
    if (err instanceof BridgeError) throw err; // e.g. a blocked redirect: retrying cannot help
    if (attempt < MAX_RETRIES) {
      const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
      await new Promise(r => setTimeout(r, delay));
      return fetch_with_retry(url, init, attempt + 1);
    }
    const e = explain_network_error(err, url);
    throw new BridgeError(e.code, e.message, 0);
  }
}

export class BridgeClient {
  private base: string;

  constructor() {
    this.base = `${config.wp.baseUrl}/wp-json/agent/v1`;
  }

  private url(path: string, params?: Record<string, string | string[]>): string {
    const u = new URL(`${this.base}${path}`);
    if (params) {
      for (const [key, val] of Object.entries(params)) {
        if (Array.isArray(val)) {
          for (const v of val) u.searchParams.append(`${key}[]`, v);
        } else {
          u.searchParams.set(key, val);
        }
      }
    }
    return u.toString();
  }

  async get<T>(path: string, params?: Record<string, string | string[]>): Promise<T> {
    const url = this.url(path, params);
    const start = Date.now();
    const res = await fetch_with_retry(url, {
      headers: auth_headers(),
    });
    log_debug('GET', path, res.status, Date.now() - start);
    return parse_response<T>(res);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const url = this.url(path);
    const start = Date.now();
    const res = await fetch_with_retry(url, {
      method: 'POST',
      headers: {
        ...auth_headers(),
        'Content-Type': 'application/json',
        'X-Idempotency-Key': randomUUID(),
      },
      body: JSON.stringify(body),
    });
    log_debug('POST', path, res.status, Date.now() - start);
    return parse_response<T>(res);
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    const url = this.url(path);
    const start = Date.now();
    const res = await fetch_with_retry(url, {
      method: 'PATCH',
      headers: {
        ...auth_headers(),
        'Content-Type': 'application/json',
        'X-Idempotency-Key': randomUUID(),
      },
      body: JSON.stringify(body),
    });
    log_debug('PATCH', path, res.status, Date.now() - start);
    return parse_response<T>(res);
  }

  async delete<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = this.url(path, params);
    const start = Date.now();
    const res = await fetch_with_retry(url, {
      method: 'DELETE',
      headers: {
        ...auth_headers(),
        'X-Idempotency-Key': randomUUID(),
      },
    });
    log_debug('DELETE', path, res.status, Date.now() - start);
    return parse_response<T>(res);
  }

  async upload_media<T>(
    path: string,
    file: Buffer,
    mime_type: string,
    filename: string,
    meta?: Record<string, string>,
  ): Promise<T> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(file)], { type: mime_type }), filename);
    if (meta) {
      for (const [k, v] of Object.entries(meta)) {
        if (v !== undefined) form.append(k, v);
      }
    }
    const url = this.url(path);
    const start = Date.now();
    const res = await fetch_with_retry(url, {
      method: 'POST',
      headers: {
        ...auth_headers(),
        'X-Idempotency-Key': randomUUID(),
      },
      body: form,
    });
    log_debug('POST(multipart)', path, res.status, Date.now() - start);
    return parse_response<T>(res);
  }

  async upload_media_base64<T>(path: string, body: unknown): Promise<T> {
    return this.post<T>(path, body);
  }
}
