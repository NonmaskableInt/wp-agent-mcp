import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bridgeConfigured, connect } from '../helpers/bridge.js';

const DIR = `themes/contract-${Date.now()}`;

describe.skipIf(!bridgeConfigured)('contract: files', () => {
  let s: Awaited<ReturnType<typeof connect>>;
  beforeAll(async () => {
    s = await connect();
  });
  afterAll(async () => {
    await s?.call('file_delete', { path: DIR, recursive: true });
    await s?.close();
  });

  it('writes, lists and reads back a file inside wp-content/themes', async () => {
    const content = '<?php\n// contract test\nfunction contract_ok() { return true; }\n';
    const w = await s.call('file_write', { path: `${DIR}/functions.php`, content });
    expect(w.isError, w.text).toBe(false);

    const r = await s.call('file_read', { path: `${DIR}/functions.php` });
    expect(r.isError, r.text).toBe(false);
    expect(r.json).toMatchObject({ content });

    const l = await s.call('file_list', { path: DIR });
    expect(JSON.stringify(l.json)).toContain('functions.php');
  });

  it.each([
    ['path traversal', 'themes/../../wp-config.php'],
    ['wp-config.php', 'wp-config.php'],
    ['wp-includes', 'wp-includes/version.php'],
    ['wp-admin', 'wp-admin/index.php'],
    ['outside allowed roots', 'uploads/shell.php'],
    ['absolute path', '/etc/passwd'],
  ])('refuses %s', async (_label, path) => {
    const w = await s.call('file_write', { path, content: '<?php // x' });
    expect(w.isError).toBe(true);
    expect(w.text).toMatch(/path_not_allowed/);
    const r = await s.call('file_read', { path });
    expect(r.isError).toBe(true);
  });

  it('rejects PHP with a syntax error and leaves the existing file untouched', async () => {
    const good = '<?php\nfunction contract_stable() {}\n';
    await s.call('file_write', { path: `${DIR}/stable.php`, content: good });

    const bad = await s.call('file_write', { path: `${DIR}/stable.php`, content: '<?php function ( {' });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/php_lint_failed/);

    const r = await s.call('file_read', { path: `${DIR}/stable.php` });
    expect(r.json).toMatchObject({ content: good });
  });

  it('rolls back a mu-plugin that lints but fatals at runtime, keeping the site up', async () => {
    const path = `mu-plugins/contract-fatal-${Date.now()}.php`;
    const w = await s.call('file_write', {
      path,
      content: '<?php\nundefined_function_that_fatals();\n',
    });
    expect(w.isError).toBe(true);
    expect(w.text).toMatch(/health_check_failed/);

    const r = await s.call('file_read', { path });
    expect(r.isError).toBe(true); // file was removed again

    const site = await s.call('option_get', { keys: ['blogname'] });
    expect(site.isError, site.text).toBe(false); // WordPress still serving
  });

  it('keeps a backup of the previous version and can restore it', async () => {
    const p = `${DIR}/versioned.php`;
    await s.call('file_write', { path: p, content: '<?php // v1\n' });
    await s.call('file_write', { path: p, content: '<?php // v2\n' });

    const b = await s.call('file_backups', { path: p });
    expect(b.isError, b.text).toBe(false);
    expect(JSON.stringify(b.json)).toContain('v1');

    const restore = await s.call('file_restore', { path: p });
    expect(restore.isError, restore.text).toBe(false);
    const r = await s.call('file_read', { path: p });
    expect(r.json).toMatchObject({ content: '<?php // v1\n' });
  });
});
