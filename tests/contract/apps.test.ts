import { zipSync, strToU8 } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bridgeConfigured, connect } from '../helpers/bridge.js';

const BASE = (process.env.BRIDGE_TEST_URL ?? '').replace(/\/$/, '');
const SLUG = `ctapp-${Date.now().toString(36)}`;
const MOUNT = `/${SLUG}`;

const zip = (files: Record<string, string>): string => Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])))).toString('base64');

const build = (marker: string) => ({
  'index.html': `<!doctype html><html><body><div id="root"></div><script src="assets/app.js"></script><!-- ${marker} --></body></html>`,
  'assets/app.js': `console.log("${marker}");`,
  'assets/style.css': 'body{margin:0}',
  'favicon.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
});

const get = async (path: string, init?: RequestInit) => {
  const res = await fetch(`${BASE}${path}`, { redirect: 'manual', ...init });
  return { status: res.status, type: res.headers.get('content-type') ?? '', cache: res.headers.get('cache-control') ?? '', text: await res.text(), headers: res.headers };
};

describe.skipIf(!bridgeConfigured)('contract: apps', () => {
  let s: Awaited<ReturnType<typeof connect>>;
  beforeAll(async () => {
    s = await connect();
  });
  afterAll(async () => {
    await s?.call('app_delete', { slug: SLUG });
    await s?.call('app_delete', { slug: `${SLUG}-root` });
    await s?.close();
  });

  it('deploys a bundle and serves it at the mount path', async () => {
    const d = await s.call('app_deploy', { slug: SLUG, mount: MOUNT, archive_base64: zip(build('v1')) });
    expect(d.isError, d.text).toBe(false);
    expect(d.json).toMatchObject({ slug: SLUG, mount: MOUNT });

    const index = await get(`${MOUNT}/`);
    expect(index.status).toBe(200);
    expect(index.type).toMatch(/text\/html/);
    expect(index.text).toContain('v1');
    expect(index.cache).toMatch(/no-cache/);

    const bare = await get(MOUNT);
    expect(bare.status).toBe(200);
    expect(bare.text).toContain('v1');

    const js = await get(`${MOUNT}/assets/app.js`);
    expect(js.status).toBe(200);
    expect(js.type).toMatch(/javascript/);
    expect(js.cache).toMatch(/immutable/);
    expect(js.headers.get('x-content-type-options')).toBe('nosniff');

    expect((await get(`${MOUNT}/assets/style.css`)).type).toMatch(/text\/css/);
    expect((await get(`${MOUNT}/favicon.svg`)).type).toMatch(/image\/svg\+xml/);
  });

  it('falls back to index.html for client routes but 404s missing assets', async () => {
    const route = await get(`${MOUNT}/dashboard/settings`);
    expect(route.status).toBe(200);
    expect(route.text).toContain('id="root"');

    expect((await get(`${MOUNT}/assets/missing.js`)).status).toBe(404);
  });

  it('never serves files outside the release', async () => {
    for (const p of [`${MOUNT}/..%2f..%2fwp-config.php`, `${MOUNT}/%2e%2e/%2e%2e/wp-config.php`, `${MOUNT}/assets/..%2f..%2f..%2f..%2fwp-config.php`]) {
      const r = await get(p);
      expect(r.text, p).not.toContain('DB_PASSWORD');
      expect(r.text, p).not.toContain('<?php');
    }
  });

  it('redeploys atomically and rolls back to the previous release', async () => {
    const v2 = await s.call('app_deploy', { slug: SLUG, mount: MOUNT, archive_base64: zip(build('v2')) });
    expect(v2.isError, v2.text).toBe(false);
    expect((await get(`${MOUNT}/`)).text).toContain('v2');

    const info = await s.call('app_get', { slug: SLUG });
    expect((info.json as { releases: unknown[] }).releases.length).toBe(2);

    const rb = await s.call('app_rollback', { slug: SLUG });
    expect(rb.isError, rb.text).toBe(false);
    const after = await get(`${MOUNT}/`);
    expect(after.text).toContain('v1');
    expect(after.text).not.toContain('v2');
  });

  it('strips a single top-level build directory (dist/)', async () => {
    const files = Object.fromEntries(Object.entries(build('nested')).map(([k, v]) => [`dist/${k}`, v]));
    const d = await s.call('app_deploy', { slug: `${SLUG}-root`, mount: `${MOUNT}-nested`, archive_base64: zip(files) });
    expect(d.isError, d.text).toBe(false);
    expect((await get(`${MOUNT}-nested/`)).text).toContain('nested');
    await s.call('app_delete', { slug: `${SLUG}-root` });
  });

  it.each([
    ['zip-slip traversal', { 'index.html': '<html/>', '../evil.html': 'x' }, /archive_rejected/],
    ['absolute path entry', { 'index.html': '<html/>', '/abs.html': 'x' }, /archive_rejected/],
    ['PHP file', { 'index.html': '<html/>', 'shell.php': '<?php echo 1;' }, /archive_rejected/],
    ['hidden file', { 'index.html': '<html/>', '.env': 'SECRET=1' }, /archive_rejected/],
    ['.htaccess', { 'index.html': '<html/>', '.htaccess': 'x' }, /archive_rejected/],
    ['unlisted extension', { 'index.html': '<html/>', 'run.sh': 'x' }, /archive_rejected/],
    ['no index.html', { 'main.js': 'x' }, /app_index_missing/],
  ])('rejects a bundle with %s and serves nothing', async (label, files, code) => {
    // Unique slug per case so one wrongly-accepted bundle cannot cascade into the others.
    const id = label.replace(/[^a-z0-9]+/gi, '').toLowerCase().slice(0, 12);
    const slug = `${SLUG}-bad-${id}`;
    const mount = `${MOUNT}-bad-${id}`;
    try {
      const d = await s.call('app_deploy', { slug, mount, archive_base64: zip(files as Record<string, string>) });
      expect(d.isError, d.text).toBe(true);
      expect(d.text).toMatch(code);
      expect((await get(`${mount}/`)).status).not.toBe(200);
      expect(JSON.stringify((await s.call('app_list')).json)).not.toContain(slug);
    } finally {
      await s.call('app_delete', { slug });
    }
  });

  it('rejects invalid archives and bad slugs', async () => {
    const notZip = await s.call('app_deploy', { slug: `${SLUG}-x`, mount: `${MOUNT}-x`, archive_base64: Buffer.from('not a zip').toString('base64') });
    expect(notZip.isError).toBe(true);
    expect(notZip.text).toMatch(/archive_invalid/);

    const badSlug = await s.call('app_deploy', { slug: '../etc', mount: `${MOUNT}-y`, archive_base64: zip(build('x')) });
    expect(badSlug.isError).toBe(true);
  });

  it.each([
    ['/wp-admin'],
    ['/wp-json'],
    ['/wp-content/evil'],
    ['/wp-login.php'],
    ['/index.php'],
  ])('refuses reserved mount %s', async (mount) => {
    const d = await s.call('app_deploy', { slug: `${SLUG}-res`, mount, archive_base64: zip(build('x')) });
    expect(d.isError).toBe(true);
    expect(d.text).toMatch(/mount_reserved/);
  });

  it('refuses a mount already used by another app, and root mount without allow_root', async () => {
    const clash = await s.call('app_deploy', { slug: `${SLUG}-clash`, mount: MOUNT, archive_base64: zip(build('x')) });
    expect(clash.isError).toBe(true);
    expect(clash.text).toMatch(/mount_in_use/);

    const root = await s.call('app_deploy', { slug: `${SLUG}-root`, mount: '/', archive_base64: zip(build('x')) });
    expect(root.isError).toBe(true);
    expect(root.text).toMatch(/root_mount_requires_allow_root/);
  });

  it('mounted at / still leaves wp-json and wp-admin to WordPress', async () => {
    const slug = `${SLUG}-root`;
    // free the mount from any previous app first
    const d = await s.call('app_deploy', { slug, mount: '/', allow_root: true, archive_base64: zip(build('rootapp')) });
    expect(d.isError, d.text).toBe(false);
    try {
      expect((await get('/')).text).toContain('rootapp');
      expect((await get('/some/client/route')).text).toContain('rootapp');
      const api = await get('/wp-json/');
      expect(api.status).toBe(200);
      expect(api.type).toMatch(/json/);
      const admin = await get('/wp-admin/');
      expect([301, 302]).toContain(admin.status); // WordPress login redirect, not the SPA
      expect(admin.text).not.toContain('rootapp');
      expect((await get('/missing/asset.js')).text).not.toContain('rootapp'); // unknown file -> WordPress 404
    } finally {
      await s.call('app_delete', { slug });
    }
    expect((await get('/')).text).not.toContain('rootapp');
  });

  it('flags an app whose live release files were removed, and the site keeps working', async () => {
    const slug = `${SLUG}-gone`;
    const d = await s.call('app_deploy', { slug, mount: `${MOUNT}-gone`, archive_base64: zip(build('gone')) });
    expect(d.isError, d.text).toBe(false);
    const release = (d.json as { release_id: string }).release_id;
    try {
      expect((await s.call('app_get', { slug })).json).toMatchObject({ release_exists: true });

      const rm = await s.call('file_delete', { path: `agent-apps/${slug}/releases/${release}`, recursive: true });
      expect(rm.isError, rm.text).toBe(false);

      expect((await s.call('app_get', { slug })).json).toMatchObject({ release_exists: false });
      const page = await get(`${MOUNT}-gone/`);
      expect(page.status).toBeLessThan(500); // falls through to WordPress, never a fatal
      expect(page.text).not.toContain('gone');
    } finally {
      const del = await s.call('app_delete', { slug });
      expect(del.isError, del.text).toBe(false); // a broken app can still be cleaned up
    }
  });

  it('delete removes the app, its files and its route', async () => {
    const del = await s.call('app_delete', { slug: SLUG });
    expect(del.isError, del.text).toBe(false);
    const gone = await get(`${MOUNT}/`);
    expect(gone.status).toBe(404);
    expect(gone.text).not.toContain('id="root"');
    expect((await s.call('file_list', { path: `agent-apps/${SLUG}` })).isError).toBe(true);
    expect(JSON.stringify((await s.call('app_list')).json)).not.toContain(SLUG);
  });
});

describe.skipIf(!bridgeConfigured)('contract: apps from a local build directory', () => {
  const slug = `${SLUG}-dir`;
  let s: Awaited<ReturnType<typeof connect>>;
  let base: string; // the allowed build root
  let dir: string; // base/dist
  let outside: string; // a directory outside the root
  let previous_root: string | undefined;

  beforeAll(async () => {
    s = await connect();
    const { mkdtemp, mkdir, realpath, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    base = await realpath(await mkdtemp(join(tmpdir(), 'build-root-')));
    dir = join(base, 'dist');
    await mkdir(join(dir, 'assets'), { recursive: true });
    await writeFile(join(dir, 'index.html'), '<!doctype html><div id="root"></div><!-- from-dir -->');
    await writeFile(join(dir, 'assets', 'main.js'), 'console.log("from-dir")');
    await writeFile(join(dir, '.env'), 'SECRET=should-never-upload');
    await mkdir(join(base, '.hidden-dist'));
    await writeFile(join(base, '.hidden-dist', 'index.html'), '<div id="root">hidden-secret</div>');
    await writeFile(join(base, '.hidden-dist', 'credentials.json'), '{"token":"hidden-secret"}');

    outside = await realpath(await mkdtemp(join(tmpdir(), 'build-outside-')));
    await writeFile(join(outside, 'index.html'), '<div id="root">outside-secret</div>');
    await writeFile(join(outside, 'credentials.json'), '{"token":"outside-secret"}');

    previous_root = process.env.WP_MCP_BUILD_ROOT;
    process.env.WP_MCP_BUILD_ROOT = base;
  });
  afterAll(async () => {
    if (previous_root === undefined) delete process.env.WP_MCP_BUILD_ROOT;
    else process.env.WP_MCP_BUILD_ROOT = previous_root;
    await s?.call('app_delete', { slug });
    await s?.close();
    const { rm } = await import('node:fs/promises');
    await rm(base, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it('zips build_dir, deploys it, serves it, and reports exactly which files were uploaded', async () => {
    const d = await s.call('app_deploy', { slug, mount: `${MOUNT}-dir`, build_dir: dir });
    expect(d.isError, d.text).toBe(false);
    expect((await get(`${MOUNT}-dir/`)).text).toContain('from-dir');
    expect((await get(`${MOUNT}-dir/assets/main.js`)).status).toBe(200);

    const uploaded = (d.json as { uploaded: { source: string; file_count: number; files: string[] } }).uploaded;
    expect(uploaded.source).toBe(dir);
    expect([...uploaded.files].sort()).toEqual(['assets/main.js', 'index.html']);
    expect(uploaded.files).not.toContain('.env'); // hidden files never leave the machine
  });

  it('accepts a path relative to the allowed root', async () => {
    const d = await s.call('app_deploy', { slug, mount: `${MOUNT}-dir`, build_dir: 'dist' });
    expect(d.isError, d.text).toBe(false);
  });

  it.each([
    ['a directory outside the root', () => outside],
    ['a .. traversal out of the root', () => `${base}/../${outside.split('/').pop()}`],
    ['a hidden directory inside the root', () => `${base}/.hidden-dist`],
    ['the filesystem root', () => '/'],
    ['/etc', () => '/etc'],
    ['the home directory', async () => (await import('node:os')).homedir()],
  ])('refuses %s and uploads nothing', async (label, pick) => {
    // Unique slug per case so one wrongly-accepted deploy cannot cascade into the others.
    const id = label.replace(/[^a-z0-9]+/gi, '').toLowerCase().slice(0, 12);
    const esc = `${SLUG}-esc-${id}`;
    const target = await pick();
    const before = JSON.stringify((await s.call('app_list')).json);
    try {
      const d = await s.call('app_deploy', { slug: esc, mount: `${MOUNT}-esc-${id}`, build_dir: target });
      expect(d.isError, d.text).toBe(true);
      expect(d.text).toMatch(/deploy_failed/);
      expect(d.text).not.toContain('outside-secret');
      expect(d.text).not.toContain('hidden-secret');
      expect(JSON.stringify((await s.call('app_list')).json)).toBe(before);
      const page = (await get(`${MOUNT}-esc-${id}/`)).text;
      expect(page).not.toContain('outside-secret');
      expect(page).not.toContain('hidden-secret');
    } finally {
      await s.call('app_delete', { slug: esc });
    }
  });

  it('refuses a symlink inside the root that leads outside it', async () => {
    const { symlink, rm } = await import('node:fs/promises');
    const link = `${base}/linked-dist`;
    await symlink(outside, link);
    try {
      const d = await s.call('app_deploy', { slug: `${SLUG}-lnk`, mount: `${MOUNT}-lnk`, build_dir: link });
      expect(d.isError, d.text).toBe(true);
      expect(d.text).toMatch(/outside/);
      expect((await get(`${MOUNT}-lnk/`)).text).not.toContain('outside-secret');
    } finally {
      await rm(link, { force: true });
    }
  });

  it('requires exactly one of build_dir / archive_base64', async () => {
    const neither = await s.call('app_deploy', { slug, mount: `${MOUNT}-dir` });
    expect(neither.isError).toBe(true);
    const both = await s.call('app_deploy', { slug, mount: `${MOUNT}-dir`, build_dir: dir, archive_base64: 'eA==' });
    expect(both.isError).toBe(true);
  });

  it('reports a missing build_dir as a tool error, not a crash', async () => {
    const d = await s.call('app_deploy', { slug, mount: `${MOUNT}-dir`, build_dir: `${base}/nonexistent` });
    expect(d.isError).toBe(true);
    expect(d.text).toMatch(/deploy_failed/);
  });
});
