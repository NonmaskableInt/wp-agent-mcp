import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { bridgeConfigured, connect } from '../helpers/bridge.js';
import { clear_test_constants, container, set_constant } from '../helpers/wpconfig.js';

const BASE = (process.env.BRIDGE_TEST_URL ?? '').replace(/\/$/, '');
const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
const GOOD = basic(process.env.BRIDGE_TEST_USER ?? '', process.env.BRIDGE_TEST_PASSWORD ?? '');
const BAD = basic(process.env.BRIDGE_TEST_USER ?? '', 'wrongwrongwrongwrongwrong');

const hit = async (headers: Record<string, string>, path = '/wp-json/agent/v1/status') => {
  const res = await fetch(`${BASE}${path}`, { headers });
  const body = (await res.json().catch(() => ({}))) as any;
  return { status: res.status, body };
};

describe.skipIf(!bridgeConfigured)('contract: X-Agent-Authorization fallback (real WordPress)', () => {
  beforeAll(() => container && clear_test_constants());
  afterEach(() => container && clear_test_constants());
  afterAll(() => container && clear_test_constants());

  it('baseline: no credentials at all is rejected', async () => {
    expect((await hit({})).status).toBe(401);
  });

  it('accepts valid credentials sent ONLY in X-Agent-Authorization (Authorization stripped)', async () => {
    const r = await hit({ 'X-Agent-Authorization': GOOD });
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).toContain('"alt_auth_header":true');
  });

  it('still rejects a wrong password in the fallback header', async () => {
    expect((await hit({ 'X-Agent-Authorization': BAD })).status).toBe(401);
  });

  it('rejects malformed fallback values', async () => {
    for (const v of ['Bearer abc', 'Basic', 'Basic !!!notbase64!!!', `Basic ${Buffer.from('nocolon').toString('base64')}`, `Basic ${Buffer.from(':onlypass').toString('base64')}`]) {
      expect((await hit({ 'X-Agent-Authorization': v })).status, v).toBe(401);
    }
  });

  it('a real Authorization header always wins: wrong Authorization + right fallback is still rejected', async () => {
    expect((await hit({ Authorization: BAD, 'X-Agent-Authorization': GOOD })).status).toBe(401);
  });

  it('right Authorization + wrong fallback is accepted (the fallback is ignored)', async () => {
    expect((await hit({ Authorization: GOOD, 'X-Agent-Authorization': BAD })).status).toBe(200);
  });

  it('works for core REST routes as well (the connection check uses /wp/v2/users/me)', async () => {
    const r = await hit({ 'X-Agent-Authorization': GOOD }, '/wp-json/wp/v2/users/me?context=edit&_fields=id,slug');
    expect(r.status).toBe(200);
    expect(r.body.slug).toBeTruthy();
  });

  it('the MCP client sends both headers (a proxy that strips Authorization does not break it)', async () => {
    const s = await connect();
    try {
      const r = await s.call('bridge_status');
      expect(r.isError).toBe(false);
    } finally {
      await s.close();
    }
  });

  it.skipIf(!container)('AGENT_BRIDGE_DISABLE_ALT_AUTH turns the fallback off', async () => {
    set_constant('AGENT_BRIDGE_DISABLE_ALT_AUTH');
    expect((await hit({ 'X-Agent-Authorization': GOOD })).status).toBe(401);
    // the normal header is unaffected
    expect((await hit({ Authorization: GOOD })).status).toBe(200);
  });
});
