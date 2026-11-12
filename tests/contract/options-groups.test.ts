import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { bridgeConfigured, connect } from '../helpers/bridge.js';
import { clear_test_constants, container, reset_site_options, set_constant, unset_constant } from '../helpers/wpconfig.js';

const BASE = (process.env.BRIDGE_TEST_URL ?? '').replace(/\/$/, '');
const get = async (path: string) => {
  const r = await fetch(`${BASE}${path}`, { redirect: 'manual' });
  return { status: r.status, text: await r.text() };
};

const NEVER = ['default_role', 'users_can_register', 'admin_email', 'blog_public', 'active_plugins', 'template', 'stylesheet', 'siteurl', 'home'];
const DEFAULT_KEYS = [
  'blogname', 'blogdescription', 'timezone_string', 'date_format', 'time_format', 'start_of_week', 'posts_per_page', 'posts_per_rss',
  'show_on_front', 'page_on_front', 'page_for_posts', 'default_comment_status', 'default_ping_status', 'require_name_email',
  'comment_registration', 'close_comments_for_old_posts', 'close_comments_days_old', 'thread_comments', 'comments_per_page',
  'thumbnail_size_w', 'thumbnail_size_h', 'medium_size_w', 'medium_size_h', 'large_size_w', 'large_size_h',
];

describe.skipIf(!bridgeConfigured)('contract: option groups', () => {
  let s: Awaited<ReturnType<typeof connect>>;
  let original: Record<string, unknown>;
  const opt = async (keys: string[]) => ((await s.call('option_get', { keys })).json ?? {}) as Record<string, unknown>;
  const set = (options: Record<string, unknown>) => s.call('option_set', { options });
  const pages: number[] = [];
  const page = async (title: string, status = 'publish', type = 'page') => {
    const r = await s.call('post_upsert', { title, content: 'x', status, post_type: type });
    expect(r.isError, r.text).toBe(false);
    const id = (r.json as { id: number }).id;
    pages.push(id);
    return id;
  };

  beforeAll(async () => {
    if (container) {
      clear_test_constants();
      reset_site_options(); // a previous failed run may have left the site unreachable through its own API
    }
    s = await connect();
    original = await opt(DEFAULT_KEYS);
  });
  afterEach(() => container && clear_test_constants());
  afterAll(async () => {
    if (container) clear_test_constants();
    // put the site back as found; via the container when possible, so cleanup cannot depend on the API still working
    if (container) reset_site_options();
    const restorable = Object.fromEntries(Object.entries(original).filter(([k]) => k !== 'page_on_front' && k !== 'page_for_posts' && k !== 'show_on_front'));
    if (!container) {
      await set({ show_on_front: 'posts' });
      await set(restorable);
    }
    for (const id of pages) await s.call('post_delete', { id, force: true });
    await s.close();
  });

  describe('schema discovery', () => {
    it('lists groups, their keys and types, which are enabled, and what can never be set', async () => {
      const r = await s.call('option_schema');
      expect(r.isError, r.text).toBe(false);
      const j = r.json as { groups: Record<string, { enabled: boolean; keys: Record<string, { type: string }> }>; never_settable: Record<string, string> };

      for (const g of ['general', 'reading', 'discussion', 'media']) expect(j.groups[g].enabled, g).toBe(true);
      for (const g of ['permalinks', 'site_url']) expect(j.groups[g].enabled, g).toBe(false);
      expect(j.groups.general.keys.posts_per_page.type).toBe('integer');
      expect(j.groups.discussion.keys.require_name_email.type).toBe('boolean');
      expect(j.groups.reading.keys.show_on_front.type).toBe('enum');

      for (const k of NEVER.filter((k) => k !== 'siteurl' && k !== 'home')) expect(Object.keys(j.never_settable), k).toContain(k);
      const every = Object.values(j.groups).flatMap((g) => Object.keys(g.keys));
      for (const k of ['default_role', 'users_can_register', 'admin_email', 'blog_public', 'active_plugins', 'template', 'stylesheet']) {
        expect(every, `${k} must not belong to any group`).not.toContain(k);
      }
    });
  });

  describe('safe defaults', () => {
    it.each(NEVER)('refuses to read or write %s by default, with an explanation', async (key) => {
      const w = await set({ [key]: 'x' });
      expect(w.isError).toBe(true);
      expect(w.text).toMatch(/option_not_allowed/);
      const r = await s.call('option_get', { keys: [key] });
      expect(r.isError).toBe(true);
    });

    it('refuses unknown keys and groups that are switched off', async () => {
      for (const key of ['some_plugin_setting', 'permalink_structure', 'category_base']) {
        const w = await set({ [key]: 'x' });
        expect(w.isError, key).toBe(true);
        expect(w.text, key).toMatch(/option_not_allowed/);
      }
    });
  });

  describe('typed values', () => {
    it('round-trips integers, booleans, enums and strings with their real types', async () => {
      const values = {
        posts_per_page: 7, posts_per_rss: 12, default_comment_status: 'closed', require_name_email: false, comment_registration: true,
        close_comments_days_old: 21, thread_comments: true, comments_per_page: 25, thumbnail_size_w: 160, medium_size_h: 320,
        timezone_string: 'Europe/Paris', date_format: 'F j, Y', time_format: 'H:i', start_of_week: 1,
        blogdescription: `Tagline ${Date.now()}`,
      };
      const w = await set(values);
      expect(w.isError, w.text).toBe(false);
      expect(await opt(Object.keys(values))).toEqual(values);
    });
  });

  describe('validation (nothing is saved on failure)', () => {
    it.each([
      ['posts_per_page of zero', { posts_per_page: 0 }],
      ['a negative posts_per_page', { posts_per_page: -1 }],
      ['a huge posts_per_page', { posts_per_page: 100000 }],
      ['a string posts_per_page', { posts_per_page: 'ten' }],
      ['a fractional posts_per_page', { posts_per_page: 7.5 }],
      ['an invalid comment status', { default_comment_status: 'maybe' }],
      ['a non-boolean flag', { require_name_email: 'yes' }],
      ['an out-of-range start_of_week', { start_of_week: 9 }],
      ['an unknown timezone', { timezone_string: 'Mars/Phobos' }],
      ['an overlong date_format', { date_format: 'Y'.repeat(100) }],
      ['an empty blogname', { blogname: '' }],
      ['an overlong blogname', { blogname: 'x'.repeat(500) }],
      ['a negative image size', { thumbnail_size_w: -5 }],
      ['a huge image size', { large_size_w: 100000 }],
      ['an invalid show_on_front', { show_on_front: 'both' }],
      ['a page_on_front that does not exist', { page_on_front: 99999999 }],
      ['a non-integer page id', { page_on_front: 'home' }],
    ])('rejects %s', async (_l, bad) => {
      const keys = Object.keys(bad);
      const before = await opt(keys);
      const r = await set(bad);
      expect(r.isError, r.text).toBe(true);
      expect(r.text).toMatch(/validation_error|option_not_allowed/);
      expect(await opt(keys)).toEqual(before);
    });

    it('applies a batch all-or-nothing: one bad value means none are written', async () => {
      const before = await opt(['blogname', 'posts_per_page']);
      const r = await set({ blogname: `Atomic ${Date.now()}`, posts_per_page: 'bad' });
      expect(r.isError).toBe(true);
      expect(await opt(['blogname', 'posts_per_page'])).toEqual(before);
    });

    it('names every problem, not just the first', async () => {
      const r = await set({ posts_per_page: 0, start_of_week: 9, default_comment_status: 'maybe' });
      expect(r.isError).toBe(true);
      for (const k of ['posts_per_page', 'start_of_week', 'default_comment_status']) expect(r.text).toContain(k);
    });
  });

  describe('reading settings (front page)', () => {
    it('makes a chosen page the front page, and rejects drafts, posts and inconsistent combinations', async () => {
      const title = `Front ${Date.now()}`;
      const id = await page(title);
      await set({ show_on_front: 'posts' });

      const w = await set({ show_on_front: 'page', page_on_front: id });
      expect(w.isError, w.text).toBe(false);
      expect((await get('/')).text).toContain(title);

      expect((await set({ page_for_posts: id })).isError, 'posts page may not equal front page').toBe(true);
      const draft = await page(`Draft ${Date.now()}`, 'draft');
      expect((await set({ page_on_front: draft })).isError, 'draft page').toBe(true);
      const post = await page(`Post ${Date.now()}`, 'publish', 'post');
      expect((await set({ page_on_front: post })).isError, 'a post is not a page').toBe(true);

      expect((await opt(['page_on_front'])).page_on_front).toBe(id); // still the good one
      await set({ show_on_front: 'posts' });
    });

    it('refuses show_on_front=page without a valid front page', async () => {
      await set({ show_on_front: 'posts', page_on_front: 0 });
      const r = await set({ show_on_front: 'page' });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/page_on_front/);
      expect((await opt(['show_on_front'])).show_on_front).toBe('posts');
    });
  });

  describe.skipIf(!container)('opt-in groups (need wp-config constants in the dev container)', () => {
    const ALL = "['general','reading','discussion','media','permalinks']";

    it('permalinks: off by default; once enabled they are validated, applied, and never break REST or routing', async () => {
      const off = await set({ permalink_structure: '/blog/%postname%/' });
      expect(off.isError).toBe(true);
      expect(off.text).toMatch(/AGENT_BRIDGE_OPTION_GROUPS/);

      set_constant('AGENT_BRIDGE_OPTION_GROUPS', ALL);
      for (const bad of ['', '/%foo%/', '/no-tags/', 'http://evil.test/%postname%/', '/%postname%/' + 'x'.repeat(200), '/%year%/%monthnum%/']) {
        const r = await set({ permalink_structure: bad });
        expect(r.isError, JSON.stringify(bad)).toBe(true);
      }
      expect((await get('/wp-json/')).status, 'REST must survive rejected changes').toBe(200);

      // Each rule must be provable on its own, so assert the specific reason (other rules would also reject these).
      for (const [value, reason] of [
        ['', /plain permalinks/],
        ['/%year%/%foo%/%postname%/', /unknown tag %foo%/],
        ['/%year%/%monthnum%/', /%postname% or %post_id%/],
        ['/blog:evil/%postname%/', /may only contain/],
        ['/a//%postname%/', /empty segments/],
      ] as const) {
        const r = await set({ permalink_structure: value });
        expect(r.isError, JSON.stringify(value)).toBe(true);
        expect(r.text, JSON.stringify(value)).toMatch(reason);
      }

      const ok = await set({ permalink_structure: '/blog/%postname%/' });
      expect(ok.isError, ok.text).toBe(false);
      const id = await page(`Permalink ${Date.now()}`, 'publish', 'post');
      const slug = ((await s.call('post_get', { id })).json as { slug: string }).slug;
      expect((await get(`/blog/${slug}/`)).status).toBe(200);
      expect((await get('/wp-json/')).status, 'REST must work under the new structure').toBe(200);

      expect((await set({ category_base: 'topics', tag_base: 'labels' })).isError).toBe(false);
      expect((await set({ category_base: 'has space' })).isError).toBe(true);

      await set({ permalink_structure: '/%postname%/', category_base: '', tag_base: '' });
    });

    it('site_url: off by default; once enabled it is validated, and even then a bad URL cannot be saved', async () => {
      const home = BASE;
      set_constant('AGENT_BRIDGE_OPTION_GROUPS', "['general','site_url']");
      const same = await set({ siteurl: home, home });
      expect(same.isError, same.text).toBe(false);

      for (const bad of ['not a url', 'ftp://x.test', `${home}?a=1`, `${home}#frag`, 'https://user:pw@x.test', 'javascript:alert(1)', '']) {
        const r = await set({ siteurl: bad });
        expect(r.isError, JSON.stringify(bad)).toBe(true);
      }
      expect((await get('/wp-json/')).status, 'site still reachable').toBe(200);
      expect((await opt(['siteurl'])).siteurl).toBe(home);
    });

    it('legacy AGENT_BRIDGE_ALLOWED_OPTIONS still replaces the allowlist; known keys stay validated, custom keys pass', async () => {
      set_constant('AGENT_BRIDGE_ALLOWED_OPTIONS', "['blogdescription','posts_per_page','ct_custom_option']");
      expect((await set({ default_comment_status: 'open' })).isError).toBe(true); // not in the owner's list
      expect((await set({ posts_per_page: 0 })).isError).toBe(true); // listed, but still validated
      expect((await set({ posts_per_page: 9 })).isError).toBe(false);
      expect((await set({ ct_custom_option: 'custom' })).isError).toBe(false); // owner's own key, passed through as before
      expect((await opt(['ct_custom_option'])).ct_custom_option).toBe('custom');
      unset_constant('AGENT_BRIDGE_ALLOWED_OPTIONS');
    });
  });
});
