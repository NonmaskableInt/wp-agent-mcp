import { zipSync, strToU8 } from 'fflate';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { bridgeConfigured, connect } from '../helpers/bridge.js';
import { clear_test_constants, container, set_constant, sh, unset_constant } from '../helpers/wpconfig.js';

const BASE = (process.env.BRIDGE_TEST_URL ?? '').replace(/\/$/, '');
const RUN = Date.now().toString(36);
const THEME = `themes/hard-${RUN}`;
const APP = `hard-${RUN}`;
const zip = (files: Record<string, string>) => Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])))).toString('base64');
const http = async (path: string) => {
  const r = await fetch(`${BASE}${path}`, { redirect: 'manual' });
  return { status: r.status, text: await r.text() };
};

describe.skipIf(!bridgeConfigured || !container)('contract: hardening (needs the dev container)', () => {
  let s: Awaited<ReturnType<typeof connect>>;
  beforeAll(async () => {
    clear_test_constants();
    s = await connect();
  });
  afterEach(() => clear_test_constants());
  afterAll(async () => {
    clear_test_constants();
    await s?.call('file_delete', { path: THEME, recursive: true });
    await s?.call('app_delete', { slug: APP });
    await s?.call('app_delete', { slug: `${APP}-mx` }); // left behind if the guard under test fails
    await s?.close();
  });

  describe.each([['DISALLOW_FILE_EDIT'], ['DISALLOW_FILE_MODS']])('%s', (constant) => {
    it('blocks theme writes, agent-apps writes and app deploys — with no exemption — but not reads', async () => {
      const seed = await s.call('file_write', { path: `${THEME}/seed.php`, content: '<?php // seed\n' });
      expect(seed.isError, seed.text).toBe(false);

      set_constant(constant);
      for (const [label, res] of [
        ['theme write', await s.call('file_write', { path: `${THEME}/a.php`, content: '<?php // a\n' })],
        ['agent-apps write', await s.call('file_write', { path: `agent-apps/${APP}/a.html`, content: '<p/>' })],
        ['app deploy', await s.call('app_deploy', { slug: APP, mount: `/${APP}`, archive_base64: zip({ 'index.html': '<p/>' }) })],
        ['delete', await s.call('file_delete', { path: `${THEME}/seed.php` })],
      ] as const) {
        expect(res.isError, label).toBe(true);
        expect(res.text, label).toMatch(/file_edit_disabled/);
      }
      expect((await s.call('file_read', { path: `${THEME}/seed.php` })).isError).toBe(false);
      expect((await s.call('app_list')).isError).toBe(false);

      unset_constant(constant);
      expect((await s.call('file_write', { path: `${THEME}/a.php`, content: '<?php // a\n' })).isError).toBe(false);
    });
  });

  describe('DISALLOW_UNFILTERED_HTML (script served from the site origin needs unfiltered_html)', () => {
    it('blocks app deploys and agent-apps writes, but not PHP/theme work that already needs stricter caps', async () => {
      set_constant('DISALLOW_UNFILTERED_HTML');

      const deploy = await s.call('app_deploy', { slug: APP, mount: `/${APP}`, archive_base64: zip({ 'index.html': '<script>alert(1)</script>' }) });
      expect(deploy.isError).toBe(true);
      expect(deploy.text).toMatch(/insufficient_capability/);
      expect((await http(`/${APP}/`)).text).not.toContain('alert(1)');

      const write = await s.call('file_write', { path: `agent-apps/${APP}/x.js`, content: 'alert(1)' });
      expect(write.isError).toBe(true);
      expect(write.text).toMatch(/insufficient_capability/);

      // Rollback and delete go through the same gate for apps.
      expect((await s.call('app_rollback', { slug: APP })).isError).toBe(true);

      unset_constant('DISALLOW_UNFILTERED_HTML');
      const ok = await s.call('app_deploy', { slug: APP, mount: `/${APP}`, archive_base64: zip({ 'index.html': '<p>ok</p>' }) });
      expect(ok.isError, ok.text).toBe(false);
      await s.call('app_delete', { slug: APP });
    });
  });

  describe('multi-extension script names', () => {
    it.each([
      ['a.php.png'], ['a.PHP.png'], ['a.phtml.txt'], ['a.php5.js'], ['a.pht.css'], ['a.phar.json'], ['a.php.min.js'], ['a.b.php.c.png'],
    ])('refuses to write %s', async (name) => {
      const w = await s.call('file_write', { path: `${THEME}/${name}`, content: '<?php echo 1;' });
      expect(w.isError, name).toBe(true);
      expect(w.text, name).toMatch(/path_not_allowed/);
    });

    it.each([['jquery.min.js'], ['my.theme.css'], ['v1.2.3.js'], ['php-logo.png'], ['phpinfo-notes.txt'], ['a.b.c.json']])('still allows %s', async (name) => {
      const w = await s.call('file_write', { path: `${THEME}/${name}`, content: 'x' });
      expect(w.isError, w.text).toBe(false);
    });

    it('rejects an app bundle containing one, and serves nothing', async () => {
      const d = await s.call('app_deploy', { slug: `${APP}-mx`, mount: `/${APP}-mx`, archive_base64: zip({ 'index.html': '<p/>', 'avatar.php.png': 'GIF89a<?php system($_GET[0]);' }) });
      expect(d.isError).toBe(true);
      expect(d.text).toMatch(/archive_rejected/);
      expect((await http(`/${APP}-mx/`)).status).not.toBe(200);
    });
  });

  describe('backups and the audit log are not reachable over HTTP', () => {
    const wpcontent = '/var/www/html/wp-content';
    const dirs = () => sh('sh', '-c', `ls -A ${wpcontent} | grep -E '^agent-bridge-' || true`).split('\n').filter(Boolean);

    it('no longer lives at the guessable agent-bridge-backups path', async () => {
      await s.call('file_write', { path: `${THEME}/audit-probe.php`, content: '<?php // probe\n' }); // forces the dir to exist
      expect(dirs()).not.toContain('agent-bridge-backups');
      for (const p of ['/wp-content/agent-bridge-backups/', '/wp-content/agent-bridge-backups/audit.log']) {
        expect((await http(p)).status, p).toBe(404);
      }
    });

    it('uses one unguessable directory name, with deny rules in place and nothing listable', async () => {
      await s.call('file_write', { path: `${THEME}/audit-probe.php`, content: '<?php // probe\n' });
      const found = dirs().filter((d) => /^agent-bridge-[0-9a-f]{32}$/.test(d));
      expect(found).toHaveLength(1);
      const dir = found[0];

      const files = sh('ls', '-A', `${wpcontent}/${dir}`);
      expect(files).toContain('audit.log');
      expect(files).toContain('.htaccess');
      expect(files).toContain('index.php');
      expect(files).toContain('web.config');

      expect((await http(`/wp-content/${dir}/audit.log`)).status).toBe(403); // Apache honours the deny rule
      const listing = await http(`/wp-content/${dir}/`);
      expect(listing.text).not.toContain('audit.log');
    });

    it('re-creates its deny rules if they go missing (self-healing, not just first-run)', async () => {
      await s.call('file_write', { path: `${THEME}/heal.php`, content: '<?php // heal\n' });
      const dir = dirs().find((d) => /^agent-bridge-[0-9a-f]{32}$/.test(d))!;
      sh('sh', '-c', `rm -f ${wpcontent}/${dir}/.htaccess ${wpcontent}/${dir}/index.php ${wpcontent}/${dir}/web.config`);
      expect(sh('ls', '-A', `${wpcontent}/${dir}`)).not.toContain('.htaccess');

      await s.call('file_write', { path: `${THEME}/heal.php`, content: '<?php // heal 2\n' });
      const files = sh('ls', '-A', `${wpcontent}/${dir}`);
      for (const f of ['.htaccess', 'index.php', 'web.config']) expect(files, f).toContain(f);
      expect((await http(`/wp-content/${dir}/audit.log`)).status).toBe(403);
    });

    it('keeps the same directory across requests (no re-randomising, backups survive)', async () => {
      await s.call('file_write', { path: `${THEME}/stable.php`, content: '<?php // v1\n' });
      const before = dirs().filter((d) => /^agent-bridge-[0-9a-f]{32}$/.test(d));
      await s.call('file_write', { path: `${THEME}/stable.php`, content: '<?php // v2\n' });
      expect(dirs().filter((d) => /^agent-bridge-[0-9a-f]{32}$/.test(d))).toEqual(before);
      const b = await s.call('file_backups', { path: `${THEME}/stable.php` });
      expect(JSON.stringify(b.json)).toContain('v1');
    });

    it('the request log (AGENT_BRIDGE_LOG_REQUESTS) is not web-served either: it lives in the protected directory', async () => {
      // A log left at the old, guessable path by an earlier version must be moved out of the web root.
      sh('sh', '-c', `printf 'LEGACY-LOG-LINE\\n' > ${wpcontent}/agent-bridge.log`);
      expect((await http('/wp-content/agent-bridge.log')).status).toBe(200); // precondition: it was exposed

      await s.call('option_get', { keys: ['blogname'] }); // any bridge request is logged
      expect((await http('/wp-content/agent-bridge.log')).status).toBe(404);

      const dir = dirs().find((d) => /^agent-bridge-[0-9a-f]{32}$/.test(d))!;
      const log = sh('cat', `${wpcontent}/${dir}/requests.log`);
      expect(log).toContain('LEGACY-LOG-LINE'); // history kept, not lost
      expect(log).toMatch(/GET \/agent\/v1\/options/);
      expect((await http(`/wp-content/${dir}/requests.log`)).status).toBe(403);
    });

    it('AGENT_BRIDGE_BACKUP_DIR moves backups and the audit log outside wp-content', async () => {
      const outside = `/tmp/ab-backups-${RUN}`;
      sh('mkdir', '-p', outside);
      sh('chown', 'www-data:www-data', outside);
      set_constant('AGENT_BRIDGE_BACKUP_DIR', `"${outside}"`);
      const w = await s.call('file_write', { path: `${THEME}/relocated.php`, content: '<?php // relocated\n' });
      expect(w.isError, w.text).toBe(false);
      expect(sh('cat', `${outside}/audit.log`)).toContain(`relocated.php`);
      unset_constant('AGENT_BRIDGE_BACKUP_DIR');
      sh('rm', '-rf', outside);
    });
  });
});
