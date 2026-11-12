import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bridgeConfigured, connect } from '../helpers/bridge.js';

const BASE = (process.env.BRIDGE_TEST_URL ?? '').replace(/\/$/, '');
const AUTH = 'Basic ' + Buffer.from(`${process.env.BRIDGE_TEST_USER}:${process.env.BRIDGE_TEST_PASSWORD}`).toString('base64');
const FRONT = 'https://frontend.example.test';

const req = async (path: string, init: RequestInit = {}) => {
  const res = await fetch(`${BASE}${path}`, { redirect: 'manual', ...init });
  return { status: res.status, headers: res.headers, text: await res.text() };
};

describe.skipIf(!bridgeConfigured)('contract: headless', () => {
  let s: Awaited<ReturnType<typeof connect>>;
  const reset = () => s.call('headless_set', { frontend_url: null, cors_origins: [], redirect_frontend: false, redirect_status: 302, preview: true });

  beforeAll(async () => {
    s = await connect();
    await reset();
  });
  // Every test starts from the defaults so state can never leak between them.
  beforeEach(async () => {
    const r = await reset();
    expect(r.isError, r.text).toBe(false);
  });
  afterAll(async () => {
    await reset();
    await s?.close();
  });

  it('starts with safe defaults: nothing redirected, no custom CORS', async () => {
    const g = await s.call('headless_get');
    expect(g.isError, g.text).toBe(false);
    expect(g.json).toMatchObject({ config: { frontend_url: null, cors_origins: [], redirect_frontend: false, redirect_status: 302, preview: true } });
    expect((g.json as { status: { rest_url: string } }).status.rest_url).toContain('/wp-json');
  });

  describe('CORS', () => {
    it('answers only allowlisted origins, with Vary: Origin', async () => {
      const set = await s.call('headless_set', { cors_origins: ['https://app.example.test', 'http://localhost:5173'] });
      expect(set.isError, set.text).toBe(false);

      const ok = await req('/wp-json/', { headers: { Origin: 'https://app.example.test' } });
      expect(ok.headers.get('access-control-allow-origin')).toBe('https://app.example.test');
      expect(ok.headers.get('vary') ?? '').toMatch(/origin/i);
      expect((ok.headers.get('access-control-expose-headers') ?? '').toLowerCase()).toContain('x-wp-total');

      const local = await req('/wp-json/', { headers: { Origin: 'http://localhost:5173' } });
      expect(local.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');

      for (const evil of ['https://evil.test', 'https://app.example.test.evil.test', 'http://app.example.test', 'null']) {
        const r = await req('/wp-json/', { headers: { Origin: evil } });
        expect(r.headers.get('access-control-allow-origin'), evil).toBeNull();
      }
    });

    it('answers a preflight for an allowed origin and refuses others', async () => {
      await s.call('headless_set', { cors_origins: ['https://app.example.test'] });
      const pre = await req('/wp-json/wp/v2/posts', {
        method: 'OPTIONS',
        headers: { Origin: 'https://app.example.test', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' },
      });
      expect(pre.status).toBeLessThan(300);
      expect(pre.headers.get('access-control-allow-origin')).toBe('https://app.example.test');
      expect((pre.headers.get('access-control-allow-headers') ?? '').toLowerCase()).toContain('authorization');
      expect(pre.headers.get('access-control-allow-methods') ?? '').toMatch(/POST/);

      const bad = await req('/wp-json/wp/v2/posts', { method: 'OPTIONS', headers: { Origin: 'https://evil.test', 'Access-Control-Request-Method': 'POST' } });
      expect(bad.headers.get('access-control-allow-origin')).toBeNull();
    });

    it.each([
      ['wildcard', ['*']],
      ['null origin', ['null']],
      ['origin with a path', ['https://a.example.test/path']],
      ['origin with a query', ['https://a.example.test?x=1']],
      ['credentials in the origin', ['https://user:pw@a.example.test']],
      ['non-http scheme', ['javascript://a.example.test']],
      ['an empty string', ['']],
      ['not a string', [42]],
      ['more than 20 origins', Array.from({ length: 21 }, (_, i) => `https://o${i}.example.test`)],
    ])('rejects %s and keeps the previous list', async (_l, bad) => {
      await s.call('headless_set', { cors_origins: ['https://keep.example.test'] });
      const r = await s.call('headless_set', { cors_origins: bad as never });
      expect(r.isError).toBe(true);
      const g = await s.call('headless_get');
      expect(g.json).toMatchObject({ config: { cors_origins: ['https://keep.example.test'] } });
    });

    it('normalises case and trailing slash, and empties the list to restore WordPress defaults', async () => {
      await s.call('headless_set', { cors_origins: ['HTTPS://App.Example.Test/'] });
      expect((await s.call('headless_get')).json).toMatchObject({ config: { cors_origins: ['https://app.example.test'] } });
      await s.call('headless_set', { cors_origins: [] });
      const r = await req('/wp-json/', { headers: { Origin: 'https://anything.test' } });
      expect(r.status).toBe(200); // core behaviour restored; we no longer interfere
    });
  });

  describe('front-end redirect', () => {
    it('is off by default and leaves the site alone', async () => {
      const r = await req('/?p=999999');
      expect([200, 404]).toContain(r.status);
    });

    it('redirects public pages to the front end, preserving path and query', async () => {
      const set = await s.call('headless_set', { frontend_url: FRONT, redirect_frontend: true });
      expect(set.isError, set.text).toBe(false);

      const r = await req('/blog/hello-world/?utm=1&x=a%20b');
      expect(r.status).toBe(302);
      expect(r.headers.get('location')).toBe(`${FRONT}/blog/hello-world/?utm=1&x=a%20b`);

      const home = await req('/');
      expect(home.status).toBe(302);
      expect(home.headers.get('location')).toBe(`${FRONT}/`);
    });

    it('honours a 301 and never becomes an open redirect', async () => {
      await s.call('headless_set', { frontend_url: FRONT, redirect_frontend: true, redirect_status: 301 });
      expect((await req('/anything')).status).toBe(301);

      for (const path of ['//evil.test/x', '///evil.test/x', '/\\evil.test/x', '/%2f%2fevil.test/x']) {
        const r = await req(path);
        const loc = r.headers.get('location') ?? '';
        if (loc) expect(new URL(loc).origin, path).toBe(FRONT);
      }
    });

    it('never redirects WordPress-owned entry points', async () => {
      await s.call('headless_set', { frontend_url: FRONT, redirect_frontend: true });
      const api = await req('/wp-json/');
      expect(api.status).toBe(200);
      const login = await req('/wp-login.php');
      expect(login.status).toBe(200);
      const admin = await req('/wp-admin/');
      expect(admin.headers.get('location') ?? '').not.toContain('frontend.example.test');
      const robots = await req('/robots.txt');
      expect(robots.headers.get('location') ?? '').not.toContain('frontend.example.test');
      const post = await req('/wp-json/agent/v1/options', { method: 'GET', headers: { Authorization: AUTH } });
      expect(post.status).toBe(200);
    });

    it('does not shadow an app deployed on the same site', async () => {
      const slug = `hl-${Date.now().toString(36)}`;
      const { zipSync, strToU8 } = await import('fflate');
      const zip = Buffer.from(zipSync({ 'index.html': strToU8('<div id="root">hl-app</div>') })).toString('base64');
      await s.call('app_deploy', { slug, mount: `/${slug}`, archive_base64: zip });
      try {
        await s.call('headless_set', { frontend_url: FRONT, redirect_frontend: true });
        const r = await req(`/${slug}/`);
        expect(r.status).toBe(200);
        expect(r.text).toContain('hl-app');
      } finally {
        await s.call('app_delete', { slug });
      }
    });

    it('stops redirecting when switched off', async () => {
      await s.call('headless_set', { frontend_url: FRONT, redirect_frontend: true });
      await s.call('headless_set', { redirect_frontend: false });
      expect((await req('/?p=999999')).status).not.toBe(302);
    });

    it.each([
      ['the site itself (redirect loop)', BASE],
      ['a non-http scheme', 'ftp://frontend.example.test'],
      ['javascript:', 'javascript:alert(1)'],
      ['credentials in the URL', 'https://user:pw@frontend.example.test'],
      ['a query string', 'https://frontend.example.test/?a=1'],
      ['a fragment', 'https://frontend.example.test/#x'],
      ['garbage', 'not a url'],
    ])('rejects frontend_url %s', async (_l, url) => {
      const r = await s.call('headless_set', { frontend_url: url });
      expect(r.isError, url).toBe(true);
      expect((await s.call('headless_get')).json).toMatchObject({ config: { frontend_url: null } });
    });

    it('allows a same-site path for previews but never with the redirect on (loop)', async () => {
      const ok = await s.call('headless_set', { frontend_url: `${BASE}/app` });
      expect(ok.isError, ok.text).toBe(false);

      const loop = await s.call('headless_set', { redirect_frontend: true });
      expect(loop.isError).toBe(true);
      expect(loop.text).toMatch(/frontend_same_origin/);
      expect((await s.call('headless_get')).json).toMatchObject({ config: { redirect_frontend: false } });

      const both = await s.call('headless_set', { frontend_url: `${BASE}/app`, redirect_frontend: true });
      expect(both.isError).toBe(true);
    });

    it('refuses to enable the redirect without a frontend_url', async () => {
      const r = await s.call('headless_set', { redirect_frontend: true });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/frontend_url_required/);
      expect((await s.call('headless_get')).json).toMatchObject({ config: { redirect_frontend: false } });
    });

    it('refuses to clear frontend_url while the redirect is on', async () => {
      await s.call('headless_set', { frontend_url: FRONT, redirect_frontend: true });
      const r = await s.call('headless_set', { frontend_url: null });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/frontend_url_required/);
    });
  });

  describe('preview links', () => {
    it('points the editor preview at the front end', async () => {
      const p = await s.call('post_upsert', { title: `Headless preview ${Date.now()}`, content: 'x', status: 'draft' });
      expect(p.isError, p.text).toBe(false);
      const id = (p.json as { id: number }).id;
      try {
        await s.call('headless_set', { frontend_url: `${FRONT}/site` });
        const link = await s.call('headless_preview_link', { post_id: id });
        expect(link.isError, link.text).toBe(false);
        const url = new URL((link.json as { url: string }).url);
        expect(url.origin).toBe(FRONT);
        expect(url.pathname).toBe('/site/preview');
        expect(url.searchParams.get('post_id')).toBe(String(id));
        expect(url.searchParams.get('post_type')).toBe('post');
        expect(url.searchParams.get('status')).toBe('draft');
      } finally {
        await s.call('post_delete', { id, force: true });
      }
    });

    it('falls back to the normal WordPress preview when no front end is configured', async () => {
      await s.call('headless_set', { frontend_url: null });
      const p = await s.call('post_upsert', { title: `Headless fallback ${Date.now()}`, content: 'x', status: 'draft' });
      const id = (p.json as { id: number }).id;
      try {
        const link = await s.call('headless_preview_link', { post_id: id });
        expect(link.isError, link.text).toBe(false);
        expect((link.json as { url: string; headless: boolean })).toMatchObject({ headless: false });
        expect((link.json as { url: string }).url).toContain('preview=true');
      } finally {
        await s.call('post_delete', { id, force: true });
      }
    });

    it('reports a missing post', async () => {
      const r = await s.call('headless_preview_link', { post_id: 99999999 });
      expect(r.isError).toBe(true);
    });
  });

  it('rejects unknown settings instead of silently ignoring them', async () => {
    const r = await s.call('headless_set', { frontend_ur1: 'https://typo.example.test' } as never);
    expect(r.isError).toBe(true);
  });
});
