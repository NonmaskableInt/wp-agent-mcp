import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bridgeConfigured, connect } from '../helpers/bridge.js';
import { clear_test_constants, container, reset_theme, set_constant } from '../helpers/wpconfig.js';

const BASE = (process.env.BRIDGE_TEST_URL ?? '').replace(/\/$/, '');
const RUN = Date.now().toString(36);
const BLOCK = `ct-blk-${RUN}`;
const CLASSIC = `ct-cls-${RUN}`;
const CHILD_BLOCK = `ct-cb-${RUN}`;
const CHILD_CLASSIC = `ct-cc-${RUN}`;
const AUTH = 'Basic ' + Buffer.from(`${process.env.BRIDGE_TEST_USER}:${process.env.BRIDGE_TEST_PASSWORD}`).toString('base64');
const html = async (path = '/') => (await fetch(`${BASE}${path}`)).text();

type Report = { valid: boolean; errors: Array<{ code: string }>; warnings: Array<{ code: string }> };
type Scaffolded = { stylesheet: string; type: string; path: string; files: string[]; validation: Report; activated: boolean };

describe.skipIf(!bridgeConfigured)('contract: theme scaffolding', () => {
  let s: Awaited<ReturnType<typeof connect>>;
  const active = async () => ((await s.call('theme_list')).json as Array<{ stylesheet: string; active: boolean }>).find((t) => t.active)!.stylesheet;
  const scaffold = (input: Record<string, unknown>) => s.call('theme_scaffold', input as never);
  const switch_to = async (stylesheet: string) => {
    const r = await s.call('theme_activate', { stylesheet });
    expect(r.isError, r.text).toBe(false);
  };
  const created: string[] = [];
  const posts: number[] = [];

  beforeAll(async () => {
    if (container) reset_theme();
    s = await connect();
  });
  afterAll(async () => {
    if (container) {
      clear_test_constants();
      reset_theme();
    } else {
      await s.call('theme_activate', { stylesheet: 'twentytwentyfive' });
    }
    for (const id of posts) await s.call('post_delete', { id, force: true });
    for (const slug of created) await s.call('file_delete', { path: `themes/${slug}`, recursive: true });
    await s?.close();
  });

  describe('block theme', () => {
    it('creates a valid block theme and does not activate it', async () => {
      const before = await active();
      const r = await scaffold({ type: 'block', slug: BLOCK, name: `CT Block ${RUN}`, description: 'A test theme', author: 'Test Author' });
      expect(r.isError, r.text).toBe(false);
      created.push(BLOCK);
      const j = r.json as Scaffolded;
      expect(j).toMatchObject({ stylesheet: BLOCK, type: 'block', path: `themes/${BLOCK}`, activated: false });
      expect(j.validation).toMatchObject({ valid: true, errors: [] });
      expect(j.validation.warnings).toEqual([]);
      for (const f of ['style.css', 'theme.json', 'functions.php', 'templates/index.html', 'templates/single.html', 'templates/page.html', 'templates/404.html', 'parts/header.html', 'parts/footer.html']) {
        expect(j.files, f).toContain(f);
      }
      expect(await active()).toBe(before);
    });

    it('passes theme_validate, and the style.css header carries the given details', async () => {
      const v = await s.call('theme_validate', { stylesheet: BLOCK });
      expect(v.json).toMatchObject({ theme_type: 'block', valid: true });
      const css = ((await s.call('file_read', { path: `themes/${BLOCK}/style.css` })).json as { content: string }).content;
      expect(css).toMatch(new RegExp(`Theme Name: CT Block ${RUN}`));
      expect(css).toContain('Author: Test Author');
      expect(css).toContain('Description: A test theme');
      expect(css).toContain(`Text Domain: ${BLOCK}`);
    });

    it('activates, lists its templates, resolves URLs, and renders posts and pages', async () => {
      await switch_to(BLOCK);
      const title = `Scaffold post ${RUN}`;
      const p = await s.call('post_upsert', { title, content: `<p>BODY-${RUN}</p>`, status: 'publish' });
      posts.push((p.json as { id: number }).id);

      const list = (await s.call('template_list')).json as { theme_type: string; stylesheet: string; templates: Array<{ slug: string }> };
      expect(list).toMatchObject({ theme_type: 'block', stylesheet: BLOCK });
      expect(list.templates.map((t) => t.slug)).toEqual(expect.arrayContaining(['index', 'single', 'page', '404']));
      const parts = ((await s.call('template_list', { type: 'part' })).json as { templates: Array<{ slug: string; area: string }> }).templates;
      expect(parts.find((t) => t.slug === 'header')!.area).toBe('header');
      expect(parts.find((t) => t.slug === 'footer')!.area).toBe('footer');

      const r = (await s.call('template_resolve', { url: `/?p=${posts[posts.length - 1]}` })).json as { template_id: string; source: string };
      expect(r).toMatchObject({ template_id: `${BLOCK}//single`, source: 'theme' });

      const front = await html('/');
      expect(front).toContain(title); // the index template lists posts
      const single = await html(`/?p=${posts[posts.length - 1]}`);
      expect(single).toContain(`BODY-${RUN}`);
      expect(single).toContain('wp-block-site-title'); // the header part rendered
      expect((await fetch(`${BASE}/definitely-missing-${RUN}/`)).status).toBe(404);
      expect(await html(`/definitely-missing-${RUN}/`)).toContain('Page not found');

      expect((await s.call('theme_validate')).json).toMatchObject({ stylesheet: BLOCK, valid: true });
      await switch_to('twentytwentyfive');
    });
  });

  describe('classic theme', () => {
    it('creates a valid classic theme', async () => {
      const r = await scaffold({ type: 'classic', slug: CLASSIC, name: `CT Classic ${RUN}` });
      expect(r.isError, r.text).toBe(false);
      created.push(CLASSIC);
      const j = r.json as Scaffolded;
      expect(j).toMatchObject({ type: 'classic', activated: false });
      expect(j.validation).toMatchObject({ valid: true, errors: [], warnings: [] });
      for (const f of ['style.css', 'functions.php', 'index.php', 'header.php', 'footer.php', 'single.php', 'page.php', 'archive.php', 'search.php', '404.php']) {
        expect(j.files, f).toContain(f);
      }
      expect(j.files).not.toContain('theme.json');
      expect((await s.call('theme_validate', { stylesheet: CLASSIC })).json).toMatchObject({ theme_type: 'classic', valid: true });
    });

    it('activates and renders posts, single pages, search and 404', async () => {
      await switch_to(CLASSIC);
      const title = `Classic post ${RUN}`;
      const p = await s.call('post_upsert', { title, content: `<p>CBODY-${RUN}</p>`, status: 'publish' });
      const id = (p.json as { id: number }).id;
      posts.push(id);

      expect(await html('/')).toContain(title);
      expect(await html(`/?p=${id}`)).toContain(`CBODY-${RUN}`);
      expect(await html('/?s=zzz-no-match')).toMatch(/nothing found|no results|no posts/i);
      expect((await fetch(`${BASE}/definitely-missing-${RUN}/`)).status).toBe(404);

      const list = (await s.call('template_list')).json as { theme_type: string; files: Array<{ file: string; kind: string }> };
      expect(list.theme_type).toBe('classic');
      expect(list.files.find((f) => f.file === 'single.php')!.kind).toBe('template');
      const r = (await s.call('template_resolve', { url: `/?p=${id}` })).json as { file: string; type: string };
      expect(r.type).toBe('single');
      expect(r.file).toMatch(new RegExp(`${CLASSIC}/single\\.php$`));
      await switch_to('twentytwentyfive');
    });
  });

  describe('child themes', () => {
    it('creates a child of a block theme that inherits its templates and renders', async () => {
      const r = await scaffold({ type: 'child', slug: CHILD_BLOCK, name: `CT Child Block ${RUN}`, parent: 'twentytwentyfive' });
      expect(r.isError, r.text).toBe(false);
      created.push(CHILD_BLOCK);
      expect((r.json as Scaffolded).validation).toMatchObject({ valid: true, errors: [] });
      expect((r.json as Scaffolded).files).toEqual(expect.arrayContaining(['style.css', 'functions.php']));
      expect((r.json as Scaffolded).files).not.toContain('index.php');

      await switch_to(CHILD_BLOCK);
      const list = (await s.call('template_list')).json as { stylesheet: string; parent: string; theme_type: string; templates: Array<{ slug: string }> };
      expect(list).toMatchObject({ stylesheet: CHILD_BLOCK, parent: 'twentytwentyfive', theme_type: 'block' });
      expect(list.templates.map((t) => t.slug)).toEqual(expect.arrayContaining(['index', 'single']));
      expect((await fetch(`${BASE}/`)).status).toBe(200);
      expect((await s.call('theme_validate')).json).toMatchObject({ valid: true });
      await switch_to('twentytwentyfive');
    });

    it('creates a child of a classic theme that loads the parent stylesheet', async () => {
      const r = await scaffold({ type: 'child', slug: CHILD_CLASSIC, name: `CT Child Classic ${RUN}`, parent: CLASSIC });
      expect(r.isError, r.text).toBe(false);
      created.push(CHILD_CLASSIC);
      expect((r.json as Scaffolded).validation).toMatchObject({ valid: true, errors: [] });
      const fn = ((await s.call('file_read', { path: `themes/${CHILD_CLASSIC}/functions.php` })).json as { content: string }).content;
      expect(fn).toContain('wp_enqueue_style');
      expect(fn).toContain('get_template_directory_uri');

      await switch_to(CHILD_CLASSIC);
      const body = await html('/');
      expect(body).toContain(`/themes/${CLASSIC}/style.css`); // the parent's stylesheet is loaded
      expect(body).toContain(`/themes/${CHILD_CLASSIC}/style.css`);
      await switch_to('twentytwentyfive');
    });
  });

  describe('safety', () => {
    it.each([
      ['an existing theme', { type: 'block', slug: 'twentytwentyfive', name: 'X' }, /^Error theme_exists:/],
      ['the same slug twice', { type: 'block', slug: BLOCK, name: 'X' }, /^Error theme_exists:/],
      ['a missing parent', { type: 'child', slug: `ct-np-${RUN}`, name: 'X', parent: `no-such-${RUN}` }, /^Error parent_not_found:/],
      ['a child with no parent', { type: 'child', slug: `ct-nop-${RUN}`, name: 'X' }, /^Error validation_error:/],
      ['a parent given for a non-child', { type: 'block', slug: `ct-pp-${RUN}`, name: 'X', parent: 'twentytwentyfive' }, /^Error validation_error:/],
      ['a parent that is itself a child', { type: 'child', slug: `ct-gc-${RUN}`, name: 'X', parent: CHILD_BLOCK }, /^Error parent_is_child:/],
      ['an unknown type', { type: 'hybrid', slug: `ct-ut-${RUN}`, name: 'X' }, /^Error validation_error:/],
    ])('refuses %s', async (_l, input, code) => {
      const r = await scaffold(input);
      expect(r.isError, r.text).toBe(true);
      expect(r.text).toMatch(code); // anchored to the error CODE: a later failure that merely mentions it must not pass
    });

    it.each([
      ['an uppercase slug', 'Bad'], ['a path-like slug', '../evil'], ['a slash', 'a/b'], ['spaces', 'a b'], ['a leading digit', '1abc'],
      ['a leading dash', '-abc'], ['an overlong slug', 'a'.repeat(60)], ['a one-letter slug', 'a'], ['an empty slug', ''], ['dots', 'a.b'],
    ])('refuses %s as a slug', async (_l, slug) => {
      const r = await scaffold({ type: 'block', slug, name: 'X' });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/validation_error/);
    });

    it.each([
      ['a comment terminator', 'Evil */ Theme'],
      ['a newline', 'Line1\nTemplate: other'],
      ['a PHP tag', 'Name <?php system("x") ?>'],
      ['a control character', 'Bad\u0007Name'],
      ['an empty name', ''],
      ['an overlong name', 'N'.repeat(100)],
    ])('refuses %s in the name', async (_l, name) => {
      const r = await scaffold({ type: 'block', slug: `ct-nm-${RUN}`, name });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/validation_error/);
      expect((await s.call('file_list', { path: 'themes' })).json).not.toMatchObject({ entries: expect.arrayContaining([expect.objectContaining({ name: `ct-nm-${RUN}` })]) });
    });

    it.each([['description', 'Sneaky */ injection'], ['description', 'a\nb'], ['author', 'x */ y'], ['author', 'a\r\nb']])('refuses a bad %s (%j)', async (field, value) => {
      const r = await scaffold({ type: 'block', slug: `ct-ds-${RUN}`, name: 'X', [field]: value });
      expect(r.isError).toBe(true);
    });

    it('accepts ordinary punctuation in the name (quotes, ampersands, accents)', async () => {
      const slug = `ct-pn-${RUN}`;
      const r = await scaffold({ type: 'block', slug, name: `Tom & Jerry's "Café" ${RUN}` });
      expect(r.isError, r.text).toBe(false);
      created.push(slug);
      expect((r.json as Scaffolded).validation.valid).toBe(true);
      const css = ((await s.call('file_read', { path: `themes/${slug}/style.css` })).json as { content: string }).content;
      expect(css).toContain(`Theme Name: Tom & Jerry's "Café" ${RUN}`);
    });

    it('rejects unknown fields instead of ignoring a typo (sent directly; the MCP schema would strip them)', async () => {
      const r = await fetch(`${BASE}/wp-json/agent/v1/theme-tools/scaffold`, {
        method: 'POST', headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'block', slug: `ct-tp-${RUN}`, name: 'X', sluug: 'oops' }),
      });
      expect(r.status).toBe(422);
      expect(((await r.json()) as { message: string }).message).toMatch(/sluug/);
    });

    it('leaves no staging directory behind, after successes or failures', async () => {
      await scaffold({ type: 'block', slug: 'Bad Slug', name: 'X' });
      const entries = ((await s.call('file_list', { path: 'themes' })).json as { entries: Array<{ name: string }> }).entries.map((e) => e.name);
      expect(entries.filter((n) => n.startsWith('.agent-scaffold'))).toEqual([]);
    });

    it.skipIf(!container)('is refused when DISALLOW_FILE_EDIT is set (it writes files)', async () => {
      set_constant('DISALLOW_FILE_EDIT');
      try {
        const r = await scaffold({ type: 'block', slug: `ct-de-${RUN}`, name: 'X' });
        expect(r.isError).toBe(true);
        expect(r.text).toMatch(/file_edit_disabled/);
      } finally {
        clear_test_constants();
      }
      const entries = ((await s.call('file_list', { path: 'themes' })).json as { entries: Array<{ name: string }> }).entries.map((e) => e.name);
      expect(entries).not.toContain(`ct-de-${RUN}`);
    });
  });
});
