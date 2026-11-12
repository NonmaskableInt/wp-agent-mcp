import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { run_diagnostics } from '../../src/diagnostics.js';
import { bridgeConfigured, connect } from '../helpers/bridge.js';
import { clear_test_constants, container, set_constant } from '../helpers/wpconfig.js';

const BASE = (process.env.BRIDGE_TEST_URL ?? '').replace(/\/$/, '');
const USER = process.env.BRIDGE_TEST_USER ?? '';
const PASS = process.env.BRIDGE_TEST_PASSWORD ?? '';

describe.skipIf(!bridgeConfigured)('contract: bridge_status (real WordPress)', () => {
  let s: Awaited<ReturnType<typeof connect>>;
  const status = async () => (await s.call('bridge_status')).json as { ok: boolean; steps: Array<{ name: string; status: string; summary: string }>; bridge: any; problems: string[] };

  beforeAll(async () => {
    if (container) clear_test_constants();
    s = await connect();
  });
  afterEach(() => container && clear_test_constants());
  afterAll(async () => {
    if (container) clear_test_constants();
    await s?.close();
  });

  it('reports a healthy setup with what the bridge allows on this site', async () => {
    const r = await status();
    expect(r.ok).toBe(true);
    expect(r.problems).toEqual([]);
    expect(r.steps.map((x) => x.name)).toEqual(['config', 'reach', 'authenticate', 'bridge']);
    expect(r.steps.every((x) => x.status === 'ok' || x.status === 'warn')).toBe(true);

    const b = r.bridge;
    expect(b.bridge.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(b.bridge.routes).toBeGreaterThan(50);
    expect(b.wordpress.version).toMatch(/^\d+\.\d+/);
    expect(b.php.version).toMatch(/^\d+\.\d+/);
    expect(b.site.theme).toBeTruthy();
    expect(['block', 'classic']).toContain(b.site.theme_type);
    expect(b.features).toMatchObject({ db_api: false, content_model: true });
    expect(b.features.cli).toMatchObject({ enabled: true, mode: 'allowlist' });
    expect(b.features.option_groups).toEqual(expect.arrayContaining(['general', 'reading', 'discussion', 'media']));
    expect(typeof b.features.file_write).toBe('boolean');
    expect(b.features.php_verification).toBe(true); // the dev container has php and proc_open
    expect(b.user.login).toBe(USER);
    expect(b.user.roles).toContain('administrator');
    expect(b.user.can).toMatchObject({ manage_options: true, edit_themes: true });
  });

  it('exposes no secrets or server paths', async () => {
    const text = JSON.stringify(await status());
    expect(text).not.toContain(PASS);
    expect(text).not.toMatch(/\/var\/www|\/home\d*\/|DB_PASSWORD|DB_USER|AUTH_KEY|SECURE_AUTH/i);
  });

  it('refuses unauthenticated callers', async () => {
    const r = await fetch(`${BASE}/wp-json/agent/v1/status`);
    expect(r.status).toBe(401);
  });

  it('a wrong password is diagnosed as an authentication problem on the real site', async () => {
    const r = await run_diagnostics({ baseUrl: BASE, username: USER, appPassword: 'wrong-password-for-test', timeoutMs: 20000 });
    expect(r.ok).toBe(false);
    expect(r.steps.find((x) => x.name === 'authenticate')!.status).toBe('fail');
    expect(r.problems.join(' ')).toMatch(/application password/i);
  });

  it('a wrong path is diagnosed as a wrong URL / missing bridge on the real site', async () => {
    const r = await run_diagnostics({ baseUrl: `${BASE}/no-such-subdir`, username: USER, appPassword: PASS, timeoutMs: 20000 });
    expect(r.ok).toBe(false);
    expect(r.steps.find((x) => x.name === 'reach')!.status).toBe('fail');
  });

  describe.skipIf(!container)('reflects the site\'s real configuration (needs the dev container)', () => {
    it('file edit blocked by DISALLOW_FILE_EDIT / DISALLOW_FILE_MODS', async () => {
      expect((await status()).bridge.features.file_edit_blocked).toBe(false);
      set_constant('DISALLOW_FILE_EDIT');
      expect((await status()).bridge.features.file_edit_blocked).toBe(true);
      clear_test_constants();
      set_constant('DISALLOW_FILE_MODS');
      expect((await status()).bridge.features.file_edit_blocked).toBe(true);
    });

    it('CLI open mode, DB API, content-model switch, option groups and a custom backup dir', async () => {
      set_constant('AGENT_BRIDGE_CLI_OPEN');
      set_constant('AGENT_BRIDGE_DB_API');
      set_constant('AGENT_BRIDGE_DISABLE_CONTENT_MODEL');
      set_constant('AGENT_BRIDGE_OPTION_GROUPS', "['general','permalinks']");
      set_constant('AGENT_BRIDGE_BACKUP_DIR', '"/tmp/ab-status-backups"');
      const f = (await status()).bridge.features;
      expect(f.cli.mode).toBe('open');
      expect(f.db_api).toBe(true);
      expect(f.content_model).toBe(false);
      expect(f.option_groups).toEqual(['general', 'permalinks']);
      expect(f.backup_dir).toBe('custom');
      expect(JSON.stringify(f)).not.toContain('/tmp/ab-status-backups'); // reports THAT it is custom, not where
    });

    it('write opt-in is reflected', async () => {
      const before = (await status()).bridge.features.file_write;
      expect(before).toBe(true); // the dev stack enables it
    });
  });
});
