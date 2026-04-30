import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { BridgeError, BridgeEnvelope } from './types.js';

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;

function auth_header(): string {
  const creds = Buffer.from(`${config.wp.username}:${config.wp.appPassword}`).toString('base64');
  return `Basic ${creds}`;
}

function log_debug(method: string, path: string, status: number, elapsed: number): void {
  if (config.logLevel === 'debug') {
    process.stderr.write(`[debug] ${method} ${path} → ${status} (${elapsed}ms)\n`);
  }
}

async function parse_response<T>(res: Response): Promise<T> {
  let body: BridgeEnvelope<T>;
  try {
    body = await res.json() as BridgeEnvelope<T>;
  } catch {
    throw new BridgeError('parse_error', `Non-JSON response (status ${res.status})`, res.status);
  }

  if (!body.ok) {
    throw new BridgeError(body.code ?? 'unknown_error', body.message ?? 'Unknown error', res.status);
  }

  return body.data as T;
}

async function fetch_with_retry(
  url: string,
  init: RequestInit,
  attempt = 1,
): Promise<Response> {
  try {
    const res = await fetch(url, init);
    if (res.status >= 500 && attempt < MAX_RETRIES) {
      const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
      await new Promise(r => setTimeout(r, delay));
      return fetch_with_retry(url, init, attempt + 1);
    }
    return res;
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
      await new Promise(r => setTimeout(r, delay));
      return fetch_with_retry(url, init, attempt + 1);
    }
    throw err;
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
      headers: { Authorization: auth_header() },
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
        Authorization: auth_header(),
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
        Authorization: auth_header(),
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
        Authorization: auth_header(),
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
        Authorization: auth_header(),
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
