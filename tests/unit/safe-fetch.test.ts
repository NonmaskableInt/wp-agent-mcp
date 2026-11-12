import { afterEach, describe, expect, it } from 'vitest';
import { run_diagnostics } from '../../src/diagnostics.js';
import { fetch_same_origin } from '../../src/safe-fetch.js';
import { basic, start_fake_wp } from '../helpers/fake-wp.js';

type Fake = Awaited<ReturnType<typeof start_fake_wp>>;
const open: Fake[] = [];
const fake = async (routes: Parameters<typeof start_fake_wp>[0]) => {
  const f = await start_fake_wp(routes);
  open.push(f);
  return f;
};
afterEach(async () => {
  await Promise.all(open.splice(0).map((f) => f.close()));
});

const CREDS = { Authorization: basic('marion', 'secret-app-password'), 'X-Agent-Authorization': basic('marion', 'secret-app-password') };

describe('credentials never leave the origin they were meant for', () => {
  it('does not follow a redirect to another origin, so neither header reaches it', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const evil = await fake({ '*': (req) => (seen.push({ ...req.headers }), { status: 200, body: { ok: true } }) });
    const site = await fake({ '*': () => ({ status: 302, headers: { Location: `${evil.url}/steal` } }) });

    const res = await fetch_same_origin(`${site.url}/wp-json/`, { headers: CREDS });

    expect(res.status).toBe(302);
    expect(evil.hits).toEqual([]);
    expect(seen).toEqual([]);
  });

  it('follows a redirect within the same origin and keeps the headers there', async () => {
    let got: Record<string, unknown> = {};
    const site = await fake({
      'GET /old': () => ({ status: 301, headers: { Location: '/new' } }),
      'GET /new': (req) => ((got = { ...req.headers }), { status: 200, body: { ok: true } }),
    });
    const res = await fetch_same_origin(`${site.url}/old`, { headers: CREDS });
    expect(res.status).toBe(200);
    expect(got['x-agent-authorization']).toBe(CREDS['X-Agent-Authorization']);
  });

  it('turns a POST into a GET on 302 and keeps it on 307', async () => {
    const site = await fake({
      'POST /a': () => ({ status: 302, headers: { Location: '/got' } }),
      'GET /got': () => ({ status: 200, body: {} }),
      'POST /b': () => ({ status: 307, headers: { Location: '/kept' } }),
      'POST /kept': () => ({ status: 200, body: {} }),
    });
    expect((await fetch_same_origin(`${site.url}/a`, { method: 'POST', body: '{}' })).status).toBe(200);
    expect((await fetch_same_origin(`${site.url}/b`, { method: 'POST', body: '{}' })).status).toBe(200);
    expect(site.hits).toEqual(['POST /a', 'GET /got', 'POST /b', 'POST /kept']);
  });

  it('gives up on a redirect loop', async () => {
    const site = await fake({ '*': () => ({ status: 302, headers: { Location: '/loop' } }) });
    await expect(fetch_same_origin(`${site.url}/loop`)).rejects.toThrow(/too many redirects/);
  });

  it('the self-check reports a cross-origin redirect instead of following it', async () => {
    const evil = await fake({ '*': () => ({ status: 200, body: {} }) });
    const site = await fake({ '*': () => ({ status: 302, headers: { Location: `${evil.url}/wp-json/` } }) });

    const report = await run_diagnostics({ baseUrl: site.url, username: 'marion', appPassword: 'secret-app-password' });

    expect(report.ok).toBe(false);
    expect(evil.hits).toEqual([]);
    expect(JSON.stringify(report)).toMatch(/different origin/);
    expect(JSON.stringify(report)).not.toContain('secret-app-password');
  });
});
