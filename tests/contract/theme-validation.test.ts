import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bridgeConfigured, connect } from '../helpers/bridge.js';
import { container, put_file, remove_path, reset_theme } from '../helpers/wpconfig.js';

const RUN = Date.now().toString(36);
type Issue = { code: string; level: 'error' | 'warning'; message: string; file?: string; line?: number };
type Report = { valid: boolean; errors: Issue[]; warnings: Issue[]; error_count?: number; issues?: Issue[] };

describe.skipIf(!bridgeConfigured)('contract: block markup validation', () => {
  let s: Awaited<ReturnType<typeof connect>>;
  beforeAll(async () => {
    s = await connect();
  });
  afterAll(async () => {
    await s?.close();
  });
  const check = async (content: unknown) => s.call('template_validate', { content } as never);
  const codes = (r: { json: unknown }) => [...((r.json as Report).errors ?? []), ...((r.json as Report).warnings ?? [])].map((i) => i.code);

  it.each([
    ['plain blocks', '<!-- wp:paragraph -->\n<p>Hi</p>\n<!-- /wp:paragraph -->'],
    ['nested blocks', '<!-- wp:group -->\n<div class="wp-block-group"><!-- wp:heading {"level":2} -->\n<h2>T</h2>\n<!-- /wp:heading --></div>\n<!-- /wp:group -->'],
    ['a self-closing block with attributes', '<!-- wp:template-part {"slug":"header","tagName":"header"} /-->'],
    ['empty content', ''],
    ['attributes containing braces and comment-like text', '<!-- wp:paragraph {"content":"a {b} c"} -->\n<p>x</p>\n<!-- /wp:paragraph -->'],
  ])('accepts %s', async (_l, content) => {
    const r = await check(content);
    expect(r.isError, r.text).toBe(false);
    expect((r.json as Report).valid).toBe(true);
    expect((r.json as Report).errors).toEqual([]);
  });

  it.each([
    ['an unclosed block', '<!-- wp:group -->\n<div>', 'unclosed_block'],
    ['a closer with no opener', '<!-- /wp:group -->', 'unexpected_closer'],
    ['mismatched blocks', '<!-- wp:group -->\n<!-- /wp:paragraph -->', 'mismatched_closer'],
    ['invalid JSON attributes', '<!-- wp:paragraph {not json} -->\n<p>x</p>\n<!-- /wp:paragraph -->', 'invalid_attributes'],
    ['non-object attributes', '<!-- wp:paragraph [1,2] -->\n<p>x</p>\n<!-- /wp:paragraph -->', 'invalid_attributes'],
  ])('reports %s as an error with its line', async (_l, content, code) => {
    const r = await check(content);
    expect(r.isError, r.text).toBe(false); // validation succeeded; the content is what is invalid
    const j = r.json as Report;
    expect(j.valid).toBe(false);
    const issue = j.errors.find((e) => e.code === code);
    expect(issue, JSON.stringify(j.errors)).toBeTruthy();
    expect(issue!.line).toBeGreaterThan(0);
  });

  it('warns (without failing) about unregistered blocks and free-form HTML outside blocks', async () => {
    const r = await check('<!-- wp:acme/widget /-->\n<div>loose html</div>\n<!-- wp:core/not-a-block /-->');
    const j = r.json as Report;
    expect(j.valid).toBe(true);
    expect(j.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['unregistered_block', 'freeform_content']));
    expect(j.warnings.filter((w) => w.code === 'unregistered_block').length).toBe(2);
  });

  it('knows real core blocks and does not flag them', async () => {
    const r = await check('<!-- wp:post-title /-->\n<!-- wp:core/post-content /-->\n<!-- wp:query --><div><!-- wp:post-template --><!-- wp:post-title /--><!-- /wp:post-template --></div><!-- /wp:query -->');
    expect(codes(r)).not.toContain('unregistered_block');
  });

  it.each([[42], [null], [{ a: 1 }]])('rejects non-string content %j', async (content) => {
    expect((await check(content)).isError).toBe(true);
  });

  it('rejects content over the size limit', async () => {
    expect((await check('x'.repeat(600_000))).isError).toBe(true);
  });

  it('template_set saves but reports the problems, so an agent sees them immediately', async () => {
    const w = await s.call('template_set', { id: `ct-warn-${RUN}`, content: '<!-- wp:group --><div><!-- wp:acme/widget /-->', title: 'CT warn' });
    try {
      expect(w.isError, w.text).toBe(false);
      const v = (w.json as { validation: Report }).validation;
      expect(v.valid).toBe(false);
      expect([...v.errors, ...v.warnings].map((i) => i.code)).toEqual(expect.arrayContaining(['unclosed_block', 'unregistered_block']));
    } finally {
      await s.call('template_reset', { id: `ct-warn-${RUN}` });
    }
  });
});

describe.skipIf(!bridgeConfigured || !container)('contract: theme validation (needs the dev container for broken fixtures)', () => {
  let s: Awaited<ReturnType<typeof connect>>;
  const BAD = `ct-badblock-${RUN}`;
  const BADCLASSIC = `ct-badclassic-${RUN}`;
  const ORPHAN = `ct-orphan-${RUN}`;
  const validate = async (stylesheet?: string) => s.call('theme_validate', stylesheet ? { stylesheet } : {});
  const all = (r: { json: unknown }) => [...(r.json as Report).errors, ...(r.json as Report).warnings];

  beforeAll(async () => {
    reset_theme();
    s = await connect();
    put_file(`themes/${BAD}/style.css`, `/*\nTheme Name: Bad Block ${RUN}\n*/\n`); // fine
    put_file(`themes/${BAD}/theme.json`, JSON.stringify({ version: 3, bogus_top_key: 1, settings: { color: { palette: [{ slug: 'a', color: '#fff', name: 'A' }], notARealSetting: true } }, styles: { color: { background: '#fff', notAProperty: 'x' } } }));
    put_file(`themes/${BAD}/templates/single.html`, '<!-- wp:template-part {"slug":"nope"} /-->\n<!-- wp:group --><div>');
    // no templates/index.html on purpose

    put_file(`themes/${BADCLASSIC}/style.css`, '/* no theme header here */\n');
    put_file(`themes/${BADCLASSIC}/functions.php`, '<?php function broken( {\n');
    // no index.php on purpose

    put_file(`themes/${ORPHAN}/style.css`, `/*\nTheme Name: Orphan ${RUN}\nTemplate: no-such-parent-${RUN}\n*/\n`);
    put_file(`themes/${ORPHAN}/index.php`, '<?php // child\n');
  });
  afterAll(async () => {
    reset_theme();
    for (const t of [BAD, BADCLASSIC, ORPHAN]) remove_path(`themes/${t}`);
    await s?.close();
  });

  it('a healthy theme validates clean', async () => {
    const r = await validate();
    expect(r.isError, r.text).toBe(false);
    expect(r.json).toMatchObject({ stylesheet: 'twentytwentyfive', theme_type: 'block', valid: true, errors: [] });
    expect((r.json as { checked: { files: number } }).checked.files).toBeGreaterThan(5);
  });

  it('finds what is wrong in a broken block theme, with codes, files and lines', async () => {
    const r = await validate(BAD);
    expect(r.isError, r.text).toBe(false);
    const j = r.json as Report;
    expect(j.valid).toBe(false);
    const codes = all(r).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['missing_index_template', 'missing_template_part', 'unclosed_block', 'unknown_theme_json_key', 'ignored_theme_json_property']));
    const missingPart = all(r).find((i) => i.code === 'missing_template_part')!;
    expect(missingPart).toMatchObject({ level: 'error', file: 'templates/single.html' });
    expect(missingPart.message).toContain('nope');
    expect(all(r).find((i) => i.code === 'unclosed_block')!.file).toBe('templates/single.html');
    // invalid properties inside styles/settings are silently dropped by WordPress; this says which
    const ignored = all(r).filter((i) => i.code === 'ignored_theme_json_property').map((i) => i.message).join(' ');
    expect(ignored).toMatch(/notARealSetting|notAProperty/);
  });

  it('finds what is wrong in a broken classic theme', async () => {
    const r = await validate(BADCLASSIC);
    const j = r.json as Report;
    expect(j.valid).toBe(false);
    expect(j).toMatchObject({ theme_type: 'classic' } as never);
    const codes = all(r).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['missing_theme_header', 'missing_index_template', 'php_lint_failed']));
    expect(all(r).find((i) => i.code === 'php_lint_failed')!.file).toBe('functions.php');
  });

  it('reports a child theme whose parent is missing', async () => {
    const r = await validate(ORPHAN);
    expect((r.json as Report).valid).toBe(false);
    expect(all(r).map((i) => i.code)).toContain('missing_parent_theme');
  });

  it('reports a theme that is not installed', async () => {
    const r = await validate(`no-such-theme-${RUN}`);
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/theme_not_found/);
  });

  it.each([['../etc'], ['a/b'], ['..'], ['Bad Name!']])('refuses the stylesheet %j', async (name) => {
    expect((await validate(name)).isError).toBe(true);
  });
});
