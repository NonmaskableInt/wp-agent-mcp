/**
 * fetch() that never lets credentials leave the origin they were meant for.
 *
 * Plain fetch drops `Authorization` on a cross-origin redirect but keeps custom headers such as
 * `X-Agent-Authorization`, which would hand the application password to whoever the redirect points at.
 * So redirects are followed here by hand, and only to the SAME origin; a redirect anywhere else is not
 * followed and comes back as the 3xx response for the caller to report.
 */
const MAX_HOPS = 5;

export function is_redirect(status: number): boolean {
  return status >= 300 && status < 400 && status !== 304;
}

export async function fetch_same_origin(url: string, init: RequestInit = {}): Promise<Response> {
  const origin = new URL(url).origin;
  let current = url;
  let req: RequestInit = { ...init, redirect: 'manual' };

  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const res = await fetch(current, req);
    const location = res.headers.get('location');
    if (!is_redirect(res.status) || !location) return res;

    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      return res;
    }
    if (next.origin !== origin) return res; // never follow off-origin with credentials

    const method = (req.method ?? 'GET').toUpperCase();
    const to_get = res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST');
    req = to_get ? { ...req, method: 'GET', body: undefined } : req;
    current = next.toString();
  }
  throw new Error(`too many redirects from ${url}`);
}

/** Message for a redirect that was not followed. */
export function redirect_message(res: Response, url: string): string {
  const to = res.headers.get('location') ?? '(no Location header)';
  return `${url} redirected to ${to}, which is a different origin, so no credentials were sent there. Set WP_BASE_URL to the final address (https, correct www/apex host, no trailing /wp-json).`;
}
