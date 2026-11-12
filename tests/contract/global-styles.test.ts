import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bridgeConfigured, connect } from '../helpers/bridge.js';
import { container, put_file, remove_path, reset_theme } from '../helpers/wpconfig.js';

const BASE = (process.env.BRIDGE_TEST_URL ?? '').replace(/\/$/, '');
const RUN = Date.now().toString(36);
const html = async (path = '/') => (await fetch(`${BASE}${path}`)).text();
type GS = { post_id: number; theme: string; has_customizations: boolean; user: { settings: Record<string, any>; styles: Record<string, any> }; theme_defaults?: { settings?: any; styles?: any } };

describe.skipIf(!bridgeConfigured)('contract: global styles', () => {
  let s: Awaited<ReturnType<typeof connect>>;
  const get = async (include?: string) => (await s.call('global_styles_get', include ? { include } : {})).json as GS;
  const reset = () => s.call('global_styles_reset');

  beforeAll(async () => {
    s = await connect();
    await reset();
  });
  afterAll(async () => {
    await reset();
    await s?.close();
  });

  it('starts with no customisations and says which post holds them', async () => {
    const g = await get();
    expect(g.post_id).toBeGreaterThan(0);
    expect(g.theme).toBe('twentytwentyfive');
    expect(g.has_customizations).toBe(false);
    expect(g.user.settings).toEqual({});
    expect(g.user.styles).toEqual({});
  });

  it('can include the theme.json defaults a customisation overrides', async () => {
    const g = await get('theme');
    expect(g.theme_defaults?.settings?.color).toBeTruthy();
  });

  it('applies colours and presets to the rendered site', async () => {
    const r = await s.call('global_styles_set', {
      settings: { color: { palette: { custom: [{ slug: 'ct-brand', name: 'CT Brand', color: '#12ab34' }] } } },
      styles: { color: { background: '#ff00ff' } },
    });
    expect(r.isError, r.text).toBe(false);
    expect((r.json as { ignored: string[] }).ignored).toEqual([]);

    const page = await html('/');
    expect(page).toContain('#ff00ff'); // the background
    expect(page).toContain('--wp--preset--color--ct-brand'); // the new palette entry became a CSS variable
    expect((await get()).has_customizations).toBe(true);
  });

  it('merges by default: a second change keeps what the first set', async () => {
    await s.call('global_styles_set', { styles: { color: { background: '#ff00ff' } } });
    await s.call('global_styles_set', { styles: { typography: { fontSize: '19px' } } });
    const g = await get();
    expect(g.user.styles.color.background).toBe('#ff00ff');
    expect(g.user.styles.typography.fontSize).toBe('19px');
  });

  it('merges settings too: a second settings change keeps what the first set', async () => {
    await s.call('global_styles_set', { settings: { color: { palette: { custom: [{ slug: 'ct-one', name: 'One', color: '#111111' }] } } } });
    const r = await s.call('global_styles_set', { settings: { spacing: { units: ['px', 'rem'] } } });
    expect(r.isError, r.text).toBe(false);
    const g = await get();
    expect(g.user.settings.color.palette.custom[0].slug).toBe('ct-one');
    expect(g.user.settings.spacing.units).toEqual(['px', 'rem']);
  });

  it('merge=false replaces the whole section instead', async () => {
    await s.call('global_styles_set', { styles: { color: { background: '#ff00ff' } } });
    const r = await s.call('global_styles_set', { styles: { typography: { fontSize: '21px' } }, merge: false });
    expect(r.isError, r.text).toBe(false);
    const g = await get();
    expect(g.user.styles.typography.fontSize).toBe('21px');
    expect(g.user.styles.color).toBeUndefined();
  });

  it('reports properties WordPress would silently drop, and does not save them', async () => {
    const r = await s.call('global_styles_set', { styles: { color: { text: '#010203', notAProperty: 'x' } }, settings: { color: { notASetting: true } } });
    expect(r.isError, r.text).toBe(false);
    const ignored = (r.json as { ignored: string[] }).ignored.join(' ');
    expect(ignored).toMatch(/styles\.color\.notAProperty/);
    expect(ignored).toMatch(/settings\.color\.notASetting/);
    const g = await get();
    expect(g.user.styles.color.text).toBe('#010203');
    expect(JSON.stringify(g.user)).not.toContain('notAProperty');
  });

  it.each([
    ['settings that is not an object', { settings: 'red' }],
    ['styles that is a list', { styles: ['a'] }],
    ['no settings or styles at all', {}],
    ['merge that is not a boolean', { styles: { color: { text: '#000' } }, merge: 'yes' }],
    ['an oversized payload', { styles: { custom: { css: 'x'.repeat(300_000) } } }],
  ])('rejects %s and changes nothing', async (_l, input) => {
    const before = JSON.stringify((await get()).user);
    const r = await s.call('global_styles_set', input as never);
    expect(r.isError, r.text).toBe(true);
    expect(JSON.stringify((await get()).user)).toBe(before);
  });

  it('rejects unknown fields instead of ignoring a typo (sent directly; the MCP tool schema would strip them)', async () => {
    const before = JSON.stringify((await get()).user);
    const r = await fetch(`${BASE}/wp-json/agent/v1/global-styles`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${process.env.BRIDGE_TEST_USER}:${process.env.BRIDGE_TEST_PASSWORD}`).toString('base64'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ styles: { color: { text: '#000' } }, colour: 1 }),
    });
    expect(r.status).toBe(422);
    expect(((await r.json()) as { message: string }).message).toMatch(/colour/);
    expect(JSON.stringify((await get()).user)).toBe(before);
  });

  it('resets with a backup that can be restored', async () => {
    await s.call('global_styles_set', { styles: { color: { background: '#ff00ff' } } });
    const reset1 = await s.call('global_styles_reset');
    expect(reset1.isError, reset1.text).toBe(false);
    const name = (reset1.json as { backup: string }).backup;
    expect(name).toMatch(/^[0-9]{8}-[0-9]{6}-global-styles\.json$/);
    expect((await get()).has_customizations).toBe(false);
    expect(await html('/')).not.toContain('#ff00ff');

    const restored = await s.call('global_styles_restore', { name });
    expect(restored.isError, restored.text).toBe(false);
    expect((await get()).user.styles.color.background).toBe('#ff00ff');
    expect(await html('/')).toContain('#ff00ff');
  });

  it('refuses to reset when there is nothing to reset', async () => {
    await reset();
    const r = await s.call('global_styles_reset');
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/no_customizations/);
  });

  it('restore cannot be pointed at a real file elsewhere in the backup area via path traversal', async () => {
    // A genuine backup of something else (a template override) sits in a sibling folder.
    const mark = `TRAV-${RUN}`;
    await s.call('template_set', { id: 'single', content: '<!-- wp:paragraph --><p>' + mark + '</p><!-- /wp:paragraph -->', title: 'CT trav' });
    const reset_t = await s.call('template_reset', { id: 'single' });
    expect(reset_t.isError, reset_t.text).toBe(false);
    const template_backup = (reset_t.json as { backup: string }).backup;

    await s.call('global_styles_set', { styles: { color: { background: '#abcdef' } } });
    const before = JSON.stringify((await get()).user);

    for (const name of [`../template-backups/${template_backup}`, `../../${template_backup}`, `${template_backup}`]) {
      const r = await s.call('global_styles_restore', { name });
      expect(r.isError, name).toBe(true);
      expect(r.text, name).toMatch(/validation_error/); // refused by the name pattern, not merely "file not found"
    }
    expect(JSON.stringify((await get()).user), 'global styles must be untouched').toBe(before);
  });

  it('restore rejects bad or unknown backup names', async () => {
    for (const name of ['../etc/passwd', 'x.json', '20260101-000000-global-styles.json']) {
      expect((await s.call('global_styles_restore', { name })).isError, name).toBe(true);
    }
  });
});

describe.skipIf(!bridgeConfigured || !container)('contract: global styles on a theme without theme.json', () => {
  let s: Awaited<ReturnType<typeof connect>>;
  const T = `ct-plain-${RUN}`;
  beforeAll(async () => {
    reset_theme();
    put_file(`themes/${T}/style.css`, `/*\nTheme Name: Plain ${RUN}\n*/\n`);
    put_file(`themes/${T}/index.php`, '<?php echo "plain";\n');
    s = await connect();
    const a = await s.call('theme_activate', { stylesheet: T });
    expect(a.isError, a.text).toBe(false);
  });
  afterAll(async () => {
    reset_theme();
    remove_path(`themes/${T}`);
    await s?.close();
  });

  it('says so instead of pretending global styles exist', async () => {
    for (const [tool, args] of [['global_styles_get', {}], ['global_styles_set', { styles: { color: { text: '#000' } } }], ['global_styles_reset', {}]] as const) {
      const r = await s.call(tool, args as never);
      expect(r.isError, tool).toBe(true);
      expect(r.text, tool).toMatch(/no_theme_json/);
    }
  });
});
