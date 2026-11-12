import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bridgeConfigured, connect } from '../helpers/bridge.js';

const DIR = `themes/guards-${Date.now()}`;

describe.skipIf(!bridgeConfigured)('contract: files guardrails', () => {
  let s: Awaited<ReturnType<typeof connect>>;
  beforeAll(async () => {
    s = await connect();
  });
  afterAll(async () => {
    await s?.call('file_delete', { path: DIR, recursive: true });
    await s?.call('file_delete', { path: 'agent-apps/guards-app', recursive: true });
    await s?.close();
  });

  it.each([
    ['the bridge plugin itself', 'plugins/php-agent-bridge/agent-bridge.php'],
    ['bridge plugin includes', 'plugins/php-agent-bridge/includes/Auth.php'],
    ['.htaccess', `${DIR}/.htaccess`],
    ['.user.ini', `${DIR}/.user.ini`],
    ['an executable-looking extension (.phtml)', `${DIR}/x.phtml`],
    ['a shell script (.sh)', `${DIR}/x.sh`],
    ['PHP inside agent-apps', 'agent-apps/guards-app/index.php'],
  ])('refuses to write %s', async (_l, path) => {
    const w = await s.call('file_write', { path, content: '<?php // x' });
    expect(w.isError).toBe(true);
    expect(w.text).toMatch(/path_not_allowed/);
  });

  it('refuses to read or delete the bridge plugin', async () => {
    expect((await s.call('file_read', { path: 'plugins/php-agent-bridge/agent-bridge.php' })).isError).toBe(true);
    const d = await s.call('file_delete', { path: 'plugins/php-agent-bridge/includes/Auth.php' });
    expect(d.isError).toBe(true);
    expect(d.text).toMatch(/path_not_allowed/);
  });

  it('refuses to delete a root directory or the active theme', async () => {
    const root = await s.call('file_delete', { path: 'themes', recursive: true });
    expect(root.isError).toBe(true);

    const active = (await s.call('theme_list')).json as Array<{ stylesheet: string; active: boolean }>;
    const name = active.find((t) => t.active)!.stylesheet;
    const del = await s.call('file_delete', { path: `themes/${name}`, recursive: true });
    expect(del.isError).toBe(true);
    expect(del.text).toMatch(/path_in_use/);
  });

  it('round-trips a binary file as base64 and static assets into agent-apps', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const w = await s.call('file_write', { path: 'agent-apps/guards-app/pixel.png', content: png.toString('base64'), encoding: 'base64' });
    expect(w.isError, w.text).toBe(false);
    const r = await s.call('file_read', { path: 'agent-apps/guards-app/pixel.png' });
    expect(r.json).toMatchObject({ encoding: 'base64', content: png.toString('base64') });

    const html = await s.call('file_write', { path: 'agent-apps/guards-app/index.html', content: '<!doctype html><div id="root"></div>' });
    expect(html.isError, html.text).toBe(false);
  });

  it('returns a conflict when expected_sha256 is stale', async () => {
    const p = `${DIR}/conflict.php`;
    await s.call('file_write', { path: p, content: '<?php // one\n' });
    const first = (await s.call('file_read', { path: p })).json as { sha256: string };
    await s.call('file_write', { path: p, content: '<?php // two\n' });

    const stale = await s.call('file_write', { path: p, content: '<?php // three\n', expected_sha256: first.sha256 });
    expect(stale.isError).toBe(true);
    expect(stale.text).toMatch(/conflict/);
    expect((await s.call('file_read', { path: p })).json).toMatchObject({ content: '<?php // two\n' });
  });
});
