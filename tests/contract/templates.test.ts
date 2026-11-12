import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bridgeConfigured, connect } from '../helpers/bridge.js';
import { container, reset_theme } from '../helpers/wpconfig.js';

const BASE = (process.env.BRIDGE_TEST_URL ?? '').replace(/\/$/, '');
const RUN = Date.now().toString(36);
const THEME = 'twentytwentyfive';
// /?p=ID redirects to the pretty permalink, so follow it: we want the rendered page.
const html = async (path: string) => (await fetch(`${BASE}${path}`)).text();
const para = (t: string) => `<!-- wp:paragraph -->\n<p>${t}</p>\n<!-- /wp:paragraph -->`;

type Tpl = { id: string; slug: string; source: string; is_custom: boolean; has_theme_file: boolean; masks_theme_file: boolean; wp_id: number | null; title: string; area?: string };
type Resolved = { type: string; is_block: boolean; template_id: string | null; slug: string | null; source: string | null; masks_theme_file: boolean; file: string | null; hierarchy: string[] };

describe.skipIf(!bridgeConfigured)('contract: templates (block theme)', () => {
  let s: Awaited<ReturnType<typeof connect>>;
  const posts: number[] = [];
  const post = async (title: string, type = 'post') => {
    const r = await s.call('post_upsert', { title, content: 'x', status: 'publish', post_type: type });
    expect(r.isError, r.text).toBe(false);
    const id = (r.json as { id: number }).id;
    posts.push(id);
    return id;
  };
  const list = async (type = 'template') => (await s.call('template_list', { type })).json as { theme_type: string; stylesheet: string; templates: Tpl[] };
  const find = async (slug: string, type = 'template') => (await list(type)).templates.find((t) => t.slug === slug);

  beforeAll(async () => {
    if (container) reset_theme();
    s = await connect();
  });
  afterAll(async () => {
    if (container) reset_theme();
    for (const id of posts) await s.call('post_delete', { id, force: true });
    await s?.close();
  });

  describe('listing', () => {
    it('reports the theme type and every template with where it comes from', async () => {
      const r = await s.call('template_list');
      expect(r.isError, r.text).toBe(false);
      const j = r.json as { theme_type: string; stylesheet: string; parent: string | null; templates: Tpl[] };
      expect(j).toMatchObject({ theme_type: 'block', stylesheet: THEME, parent: null });
      const slugs = j.templates.map((t) => t.slug);
      for (const s of ['index', 'home', 'single', 'page', 'archive', 'search', '404']) expect(slugs, s).toContain(s);
      const single = j.templates.find((t) => t.slug === 'single')!;
      expect(single).toMatchObject({ id: `${THEME}//single`, source: 'theme', is_custom: false, has_theme_file: true, masks_theme_file: false, wp_id: null });
    });

    it('lists template parts with their area', async () => {
      const { templates } = await list('part');
      const header = templates.find((t) => t.slug === 'header')!;
      const footer = templates.find((t) => t.slug === 'footer')!;
      expect(header.area).toBe('header');
      expect(footer.area).toBe('footer');
    });

    it('rejects an unknown type', async () => {
      expect((await s.call('template_list', { type: 'bogus' })).isError).toBe(true);
    });
  });

  describe('reading', () => {
    it('returns block markup for a theme template', async () => {
      const r = await s.call('template_get', { id: `${THEME}//single` });
      expect(r.isError, r.text).toBe(false);
      const t = r.json as { content: string; source: string; theme_content: string | null };
      expect(t.content).toContain('<!-- wp:');
      expect(t.source).toBe('theme');
    });

    it('accepts a bare slug for the active theme', async () => {
      expect((await s.call('template_get', { id: 'single' })).isError).toBe(false);
    });

    it.each([['nope-' + RUN], [`${THEME}//nope-${RUN}`], ['../evil'], ['a//b//c'], ['']])('reports %j as not found / invalid', async (id) => {
      expect((await s.call('template_get', { id })).isError).toBe(true);
    });

    it('refuses another theme\'s templates', async () => {
      expect((await s.call('template_get', { id: 'twentytwentyfour//single' })).isError).toBe(true);
    });
  });

  describe('resolving which template renders a URL', () => {
    it.each([
      ['the front page (posts)', () => '/', 'home', 'home'],
      ['search', () => '/?s=anything', 'search', 'search'],
      ['a missing page', () => `/definitely-missing-${RUN}/`, '404', '404'],
      // Verified against WordPress 6.9: a category without a category.html falls through to the archive
      // lookup, so the reported type is the one that matched ('archive'), not the one first tried.
      ['a category archive', () => '/?cat=1', 'archive', 'archive'],
      ['an author archive', () => '/?author=1', 'archive', 'archive'],
      ['a date archive', () => '/?m=202611', 'archive', 'archive'],
    ])('%s', async (_l, url, type, template) => {
      const r = await s.call('template_resolve', { url: url() });
      expect(r.isError, r.text).toBe(false);
      const j = r.json as Resolved;
      expect(j.is_block).toBe(true);
      expect(j.type).toBe(type);
      expect(j.source).toBe('theme');
      expect(j.template_id).toBe(`${THEME}//${template}`);
      expect(j.hierarchy.length).toBeGreaterThan(0);
    });

    it('a single post resolves to single, a page to page, via their real URLs', async () => {
      const id = await post(`Resolve post ${RUN}`);
      const pid = await post(`Resolve page ${RUN}`, 'page');
      const a = (await s.call('template_resolve', { url: `/?p=${id}` })).json as Resolved;
      expect(a).toMatchObject({ type: 'single', template_id: `${THEME}//single`, source: 'theme' });
      expect(a.hierarchy).toEqual(expect.arrayContaining(['single.php'])); // WordPress names candidates with a .php suffix even for block themes
      const b = (await s.call('template_resolve', { url: `/?page_id=${pid}` })).json as Resolved;
      expect(b).toMatchObject({ type: 'page', template_id: `${THEME}//page` });
    });

    it('accepts a same-site absolute URL and ignores nothing it was asked about', async () => {
      const r = await s.call('template_resolve', { url: `${BASE}/?s=x` });
      expect(r.isError, r.text).toBe(false);
      expect((r.json as Resolved).type).toBe('search');
    });

    it.each([
      ['another host', 'https://evil.test/?p=1'],
      ['a scheme-relative URL', '//evil.test/x'],
      ['a non-http scheme', 'javascript:alert(1)'],
      ['control characters', '/a\r\nb'],
      ['an overlong URL', '/' + 'a'.repeat(3000)],
      ['an empty URL', ''],
    ])('refuses %s', async (_l, url) => {
      expect((await s.call('template_resolve', { url })).isError).toBe(true);
    });

    it('reports what WordPress would render even when the headless redirect is on (it must not follow or be stopped by it)', async () => {
      const on = await s.call('headless_set', { frontend_url: 'https://frontend.example.test', redirect_frontend: true });
      expect(on.isError, on.text).toBe(false);
      try {
        const live = await fetch(`${BASE}/`, { redirect: 'manual' });
        expect(live.status, 'precondition: the live site is redirecting').toBe(302);

        const r = await s.call('template_resolve', { url: '/' });
        expect(r.isError, r.text).toBe(false);
        expect(r.json).toMatchObject({ is_block: true, type: 'home', template_id: `${THEME}//home` });
      } finally {
        await s.call('headless_set', { redirect_frontend: false, frontend_url: null });
      }
    });
  });

  describe('overrides', () => {
    it('writes an override, shows it masks the theme file, serves it, and resets it with a backup', async () => {
      const mark = `OVERRIDE-${RUN}`;
      const id = await post(`Override target ${RUN}`);

      const w = await s.call('template_set', { id: `${THEME}//single`, content: `<!-- wp:group -->\n<div class="wp-block-group">${para(mark)}</div>\n<!-- /wp:group -->`, title: 'CT single' });
      expect(w.isError, w.text).toBe(false);
      expect(w.json).toMatchObject({ id: `${THEME}//single`, source: 'custom', masks_theme_file: true });

      const t = await find('single');
      expect(t).toMatchObject({ source: 'custom', is_custom: false, has_theme_file: true, masks_theme_file: true });
      expect(t!.wp_id).toBeGreaterThan(0);

      const got = (await s.call('template_get', { id: 'single' })).json as { content: string; theme_content: string };
      expect(got.content).toContain(mark);
      expect(got.theme_content).toContain('<!-- wp:'); // what the override is hiding
      expect(got.theme_content).not.toContain(mark);

      const res = (await s.call('template_resolve', { url: `/?p=${id}` })).json as Resolved;
      expect(res).toMatchObject({ source: 'custom', masks_theme_file: true });
      expect(await html(`/?p=${id}`)).toContain(mark);

      const reset = await s.call('template_reset', { id: 'single' });
      expect(reset.isError, reset.text).toBe(false);
      const rj = reset.json as { reverted_to: string; backup: string };
      expect(rj.reverted_to).toBe('theme');
      expect(rj.backup).toMatch(/^[0-9]{8}-[0-9]{6}-single\.json$/);

      expect(await find('single')).toMatchObject({ source: 'theme', masks_theme_file: false });
      expect(await html(`/?p=${id}`)).not.toContain(mark);

      // the backup can bring the override back
      const backups = (await s.call('template_backups')).json as { backups: Array<{ name: string; id: string }> };
      expect(backups.backups.map((b) => b.name)).toContain(rj.backup);
      const restored = await s.call('template_restore', { name: rj.backup });
      expect(restored.isError, restored.text).toBe(false);
      expect(await html(`/?p=${id}`)).toContain(mark);
      await s.call('template_reset', { id: 'single' });
    });

    it('creates a brand-new custom template and a custom part, and removing them deletes them', async () => {
      const t = await s.call('template_set', { id: `ct-landing-${RUN}`, content: para('landing'), title: 'CT Landing', description: 'A landing page' });
      expect(t.isError, t.text).toBe(false);
      expect(t.json).toMatchObject({ id: `${THEME}//ct-landing-${RUN}`, source: 'custom', is_custom: true, has_theme_file: false });

      const p = await s.call('template_set', { id: `ct-banner-${RUN}`, type: 'part', area: 'uncategorized', content: para('banner'), title: 'CT Banner' });
      expect(p.isError, p.text).toBe(false);
      expect((await find(`ct-banner-${RUN}`, 'part'))).toMatchObject({ area: 'uncategorized', is_custom: true });

      for (const [id, type] of [[`ct-landing-${RUN}`, 'template'], [`ct-banner-${RUN}`, 'part']] as const) {
        const d = await s.call('template_reset', { id, type });
        expect(d.isError, d.text).toBe(false);
        expect((d.json as { reverted_to: string }).reverted_to).toBe('removed');
      }
      expect(await find(`ct-landing-${RUN}`)).toBeUndefined();
    });

    it('refuses to reset a template that has no override', async () => {
      const r = await s.call('template_reset', { id: 'index' });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/no_override/);
    });

    it('overriding a part changes what the site renders', async () => {
      const mark = `HEADER-${RUN}`;
      const id = await post(`Header target ${RUN}`);
      const w = await s.call('template_set', { id: 'header', type: 'part', content: para(mark), title: 'CT header' });
      expect(w.isError, w.text).toBe(false);
      expect(await html(`/?p=${id}`)).toContain(mark);
      expect((await s.call('template_reset', { id: 'header', type: 'part' })).isError).toBe(false);
      expect(await html(`/?p=${id}`)).not.toContain(mark);
    });
  });

  describe('validation', () => {
    it.each([
      ['non-string content', { id: 'ct-x', content: 42 }],
      ['missing content', { id: 'ct-x' }],
      ['content over the size limit', { id: 'ct-x', content: 'x'.repeat(600_000) }],
      ['an invalid slug', { id: 'Bad Slug!', content: 'x' }],
      ['an id for another theme', { id: 'twentytwentyfour//single', content: 'x' }],
      ['an invalid type', { id: 'ct-x', content: 'x', type: 'page' }],
      ['an invalid area', { id: 'ct-x', type: 'part', area: 'sidebar2', content: 'x' }],
      ['an overlong title', { id: 'ct-x', content: 'x', title: 'T'.repeat(500) }],
      ['an area on a template', { id: 'ct-x', content: 'x', area: 'header' }],
    ])('rejects %s and saves nothing', async (_l, input) => {
      const before = JSON.stringify((await list()).templates.map((t) => t.id));
      const r = await s.call('template_set', input as never);
      expect(r.isError, r.text).toBe(true);
      expect(JSON.stringify((await list()).templates.map((t) => t.id))).toBe(before);
    });

    it('rejects unknown fields instead of ignoring a typo', async () => {
      const r = await fetch(`${BASE}/wp-json/agent/v1/templates/item`, {
        method: 'POST',
        headers: { Authorization: 'Basic ' + Buffer.from(`${process.env.BRIDGE_TEST_USER}:${process.env.BRIDGE_TEST_PASSWORD}`).toString('base64'), 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'ct-typo', content: 'x', titel: 'oops' }),
      });
      expect(r.status).toBe(422);
      expect(((await r.json()) as { message: string }).message).toMatch(/titel/);
    });

    it('keeps the site rendering when an override contains broken block markup', async () => {
      const id = await post(`Broken markup ${RUN}`);
      await s.call('template_set', { id: 'single', content: '<!-- wp:group --><div><!-- wp:nonexistent-block {bad json} /-->', title: 'CT broken' });
      try {
        const r = await fetch(`${BASE}/?p=${id}`);
        expect(r.status).toBeLessThan(500);
      } finally {
        await s.call('template_reset', { id: 'single' });
      }
    });
  });
});

describe.skipIf(!bridgeConfigured || !container)('contract: templates (classic theme)', () => {
  let s: Awaited<ReturnType<typeof connect>>;
  const DIR = `themes/ct-classic-${RUN}`;
  const SLUG = `ct-classic-${RUN}`;
  let postId = 0;

  beforeAll(async () => {
    reset_theme();
    s = await connect();
    const write = async (name: string, content: string) => {
      const r = await s.call('file_write', { path: `${DIR}/${name}`, content });
      expect(r.isError, `${name}: ${r.text}`).toBe(false);
    };
    await write('style.css', `/*\nTheme Name: CT Classic ${RUN}\nVersion: 1.0\n*/\n`);
    await write('index.php', '<?php // index\nget_header(); echo "CLASSIC-INDEX"; get_footer();\n');
    await write('header.php', '<?php // header\n?><!doctype html><html><head><?php wp_head(); ?></head><body>\n');
    await write('footer.php', '<?php // footer\nwp_footer(); ?></body></html>\n');
    await write('single.php', '<?php // single\nget_header(); echo "CLASSIC-SINGLE"; get_footer();\n');
    await write('functions.php', '<?php // functions\n');
    await write('page-wide.php', '<?php\n/* Template Name: Wide Layout */\nget_header(); echo "CLASSIC-WIDE"; get_footer();\n');
    const a = await s.call('theme_activate', { stylesheet: SLUG });
    expect(a.isError, a.text).toBe(false);
    const p = await s.call('post_upsert', { title: `Classic post ${RUN}`, content: 'x', status: 'publish' });
    postId = (p.json as { id: number }).id;
  });
  afterAll(async () => {
    await s?.call('post_delete', { id: postId, force: true });
    reset_theme();
    await s?.call('file_delete', { path: DIR, recursive: true });
    await s?.close();
  });

  it('identifies a classic theme and lists its template files and page templates', async () => {
    const r = await s.call('template_list');
    expect(r.isError, r.text).toBe(false);
    const j = r.json as { theme_type: string; files: Array<{ file: string; kind: string; name?: string }> };
    expect(j.theme_type).toBe('classic');
    const files = Object.fromEntries(j.files.map((f) => [f.file, f]));
    expect(files['single.php'].kind).toBe('template');
    expect(files['index.php'].kind).toBe('template');
    expect(files['header.php'].kind).toBe('part');
    expect(files['page-wide.php']).toMatchObject({ kind: 'page_template', name: 'Wide Layout' });
    expect(files['functions.php'].kind).toBe('functions');
  });

  it('resolves URLs to template files', async () => {
    const single = (await s.call('template_resolve', { url: `/?p=${postId}` })).json as Resolved;
    expect(single).toMatchObject({ is_block: false, type: 'single', template_id: null });
    expect(single.file).toMatch(/single\.php$/);
    expect(single.hierarchy).toEqual(expect.arrayContaining(['single.php']));

    const home = (await s.call('template_resolve', { url: '/' })).json as Resolved;
    expect(home.file).toMatch(/index\.php$/);
  });

  it('the block-template APIs say so instead of misbehaving on a classic theme', async () => {
    for (const [tool, args] of [['template_get', { id: 'single' }], ['template_set', { id: 'ct-x', content: 'x' }], ['template_reset', { id: 'single' }]] as const) {
      const r = await s.call(tool, args as never);
      expect(r.isError, tool).toBe(true);
      expect(r.text, tool).toMatch(/not_block_theme/);
    }
  });
});
