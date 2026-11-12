import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bridgeConfigured, connect } from '../helpers/bridge.js';

const BASE = (process.env.BRIDGE_TEST_URL ?? '').replace(/\/$/, '');
const AUTH = 'Basic ' + Buffer.from(`${process.env.BRIDGE_TEST_USER}:${process.env.BRIDGE_TEST_PASSWORD}`).toString('base64');

const wp = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    redirect: 'manual',
    headers: { Authorization: AUTH, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json, text };
};

type Model = { post_types: Record<string, any>; taxonomies: Record<string, any>; meta: Record<string, any>; warnings: string[] };

describe.skipIf(!bridgeConfigured)('contract: content model', () => {
  let s: Awaited<ReturnType<typeof connect>>;
  const model = async () => (await s.call('content_model_get')).json as Model;
  const cleanup = async () => {
    const m = await model();
    for (const key of Object.keys(m.meta).filter((k) => k.startsWith('ct_'))) await s.call('content_meta_delete', { key });
    for (const slug of Object.keys(m.post_types).filter((k) => k.startsWith('ct'))) await s.call('content_type_delete', { slug });
    for (const slug of Object.keys(m.taxonomies).filter((k) => k.startsWith('ct'))) await s.call('content_taxonomy_delete', { slug });
  };

  beforeAll(async () => {
    s = await connect();
    await cleanup();
  });
  afterAll(async () => {
    await cleanup();
    await s?.close();
  });

  it('starts empty and exposes nothing extra', async () => {
    const m = await model();
    expect(Object.keys(m.post_types).filter((k) => k.startsWith('ct'))).toEqual([]);
    expect((await wp('GET', '/wp-json/wp/v2/ctbooks')).status).toBe(404);
  });

  describe('a book catalogue as a headless data model', () => {
    const created: number[] = [];
    afterAll(async () => {
      for (const id of created) await wp('DELETE', `/wp-json/wp/v2/ctbooks/${id}?force=true`);
    });

    it('defines a taxonomy and a post type that are immediately available over REST', async () => {
      const tax = await s.call('content_taxonomy_set', { slug: 'ctgenre', label: 'Genres', singular_label: 'Genre', object_types: ['ctbook'], hierarchical: true, rest_base: 'ctgenres' });
      expect(tax.isError, tax.text).toBe(false);

      const type = await s.call('content_type_set', {
        slug: 'ctbook', label: 'Books', singular_label: 'Book', supports: ['title', 'editor', 'excerpt', 'thumbnail'],
        taxonomies: ['ctgenre'], rest_base: 'ctbooks', menu_icon: 'dashicons-book',
      });
      expect(type.isError, type.text).toBe(false);

      const types = await wp('GET', '/wp-json/wp/v2/types');
      expect(types.json.ctbook).toMatchObject({ rest_base: 'ctbooks', name: 'Books' });
      expect(types.json.ctbook.taxonomies).toContain('ctgenre');
      expect((await wp('GET', '/wp-json/wp/v2/ctbooks')).status).toBe(200);
      expect((await wp('GET', '/wp-json/wp/v2/ctgenres')).status).toBe(200);
    });

    it('registers typed meta fields that round-trip through REST and reject bad types', async () => {
      for (const def of [
        { key: 'ct_isbn', post_types: ['ctbook'], type: 'string', description: 'ISBN' },
        { key: 'ct_pages', post_types: ['ctbook'], type: 'integer' },
        { key: 'ct_in_stock', post_types: ['ctbook'], type: 'boolean' },
        { key: 'ct_tags', post_types: ['ctbook'], type: 'array', items_type: 'string' },
      ]) {
        const r = await s.call('content_meta_set', def);
        expect(r.isError, r.text).toBe(false);
      }

      const ok = await wp('POST', '/wp-json/wp/v2/ctbooks', {
        title: `Contract Book ${Date.now()}`, status: 'publish',
        meta: { ct_isbn: '978-3-16-148410-0', ct_pages: 312, ct_in_stock: true, ct_tags: ['sf', 'classic'] },
      });
      expect(ok.status, ok.text).toBe(201);
      created.push(ok.json.id);
      expect(ok.json.meta).toMatchObject({ ct_isbn: '978-3-16-148410-0', ct_pages: 312, ct_in_stock: true, ct_tags: ['sf', 'classic'] });

      const bad = await wp('POST', '/wp-json/wp/v2/ctbooks', { title: 'x', status: 'draft', meta: { ct_pages: 'not-a-number' } });
      expect(bad.status).toBe(400);

      const unknown = await wp('POST', `/wp-json/wp/v2/ctbooks/${ok.json.id}`, { meta: { ct_unregistered: 'x' } });
      expect(unknown.json.meta).not.toHaveProperty('ct_unregistered');
    });

    it('assigns terms and serves the public page (rewrite rules flushed automatically)', async () => {
      const term = await wp('POST', '/wp-json/wp/v2/ctgenres', { name: `SciFi ${Date.now()}` });
      expect(term.status, term.text).toBe(201);
      const title = `Public Book ${Date.now()}`;
      // WordPress names a taxonomy's REST field after its rest_base ('ctgenres'), not its slug.
      const book = await wp('POST', '/wp-json/wp/v2/ctbooks', { title, status: 'publish', ctgenres: [term.json.id] });
      expect(book.status, book.text).toBe(201);
      created.push(book.json.id);
      expect(book.json.ctgenres).toEqual([term.json.id]);

      const page = await wp('GET', `/ctbook/${book.json.slug}/`);
      expect(page.status).toBe(200);
      expect(page.text).toContain(title);
      await wp('DELETE', `/wp-json/wp/v2/ctgenres/${term.json.id}?force=true`);
    });

    it('lists everything in the model', async () => {
      const m = await model();
      expect(m.post_types.ctbook).toMatchObject({ label: 'Books', rest_base: 'ctbooks' });
      expect(m.taxonomies.ctgenre).toMatchObject({ hierarchical: true });
      expect(Object.keys(m.meta)).toEqual(expect.arrayContaining(['ct_isbn', 'ct_pages', 'ct_in_stock', 'ct_tags']));
    });

    it('removing the definition removes the REST route, and removing a meta field stops it being exposed', async () => {
      await s.call('content_meta_delete', { key: 'ct_isbn' });
      const after = await wp('POST', '/wp-json/wp/v2/ctbooks', { title: 'no isbn', status: 'draft', meta: { ct_isbn: 'x' } });
      created.push(after.json.id);
      expect(after.json.meta).not.toHaveProperty('ct_isbn');

      for (const id of created.splice(0)) await wp('DELETE', `/wp-json/wp/v2/ctbooks/${id}?force=true`);
      const del = await s.call('content_type_delete', { slug: 'ctbook' });
      expect(del.isError, del.text).toBe(false);
      expect((await wp('GET', '/wp-json/wp/v2/ctbooks')).status).toBe(404);
      expect((await wp('GET', '/wp-json/wp/v2/types')).json).not.toHaveProperty('ctbook');
    });
  });

  it('defaults rest_base to the slug and is idempotent on repeat upserts', async () => {
    for (let i = 0; i < 2; i++) {
      const r = await s.call('content_type_set', { slug: 'ctnote', label: 'Notes' });
      expect(r.isError, r.text).toBe(false);
    }
    const m = await model();
    expect(Object.keys(m.post_types).filter((k) => k === 'ctnote')).toHaveLength(1);
    expect((await wp('GET', '/wp-json/wp/v2/ctnote')).status).toBe(200);
    expect((await wp('GET', '/wp-json/wp/v2/types')).json.ctnote.rest_base).toBe('ctnote');
  });

  it('keeps posts when a type definition is removed, reports them, and restores them when re-added', async () => {
    await s.call('content_type_set', { slug: 'ctorph', label: 'Orph' });
    const post = await wp('POST', '/wp-json/wp/v2/ctorph', { title: `Orphan ${Date.now()}`, status: 'publish' });
    expect(post.status, post.text).toBe(201);

    const del = await s.call('content_type_delete', { slug: 'ctorph' });
    expect(del.isError, del.text).toBe(false);
    expect(del.json).toMatchObject({ deleted: true, orphaned_posts: 1 });
    expect((await wp('GET', '/wp-json/wp/v2/ctorph')).status).toBe(404);

    await s.call('content_type_set', { slug: 'ctorph', label: 'Orph' });
    const back = await wp('GET', `/wp-json/wp/v2/ctorph/${post.json.id}`);
    expect(back.status).toBe(200);
    expect(back.json.id).toBe(post.json.id);

    await wp('DELETE', `/wp-json/wp/v2/ctorph/${post.json.id}?force=true`);
    await s.call('content_type_delete', { slug: 'ctorph' });
  });

  it('forces custom-fields support when meta targets a type, so meta reaches REST', async () => {
    await s.call('content_type_set', { slug: 'ctcf', label: 'CF', supports: ['title'] });
    await s.call('content_meta_set', { key: 'ct_cf', post_types: ['ctcf'], type: 'string' });
    const post = await wp('POST', '/wp-json/wp/v2/ctcf', { title: 't', status: 'publish', meta: { ct_cf: 'v' } });
    expect(post.status, post.text).toBe(201);
    expect(post.json.meta).toMatchObject({ ct_cf: 'v' });
    await wp('DELETE', `/wp-json/wp/v2/ctcf/${post.json.id}?force=true`);
  });

  it('reports dangling references as warnings instead of failing', async () => {
    const r = await s.call('content_type_set', { slug: 'ctdangle', label: 'Dangle', taxonomies: ['ctmissing'] });
    expect(r.isError, r.text).toBe(false);
    const m = await model();
    expect(m.warnings.join('\n')).toMatch(/ctdangle.*ctmissing/);
  });

  describe('validation', () => {
    it.each([
      ['a core type', { slug: 'post', label: 'X' }],
      ['page', { slug: 'page', label: 'X' }],
      ['attachment', { slug: 'attachment', label: 'X' }],
      ['wp_template', { slug: 'wp_template', label: 'X' }],
      ['an uppercase slug', { slug: 'CtBad', label: 'X' }],
      ['a slug with spaces', { slug: 'ct bad', label: 'X' }],
      ['a slug over 20 characters', { slug: 'ct' + 'a'.repeat(19), label: 'X' }],
      ['a slug starting with a digit', { slug: '1ct', label: 'X' }],
      ['a missing label', { slug: 'ctnolabel' }],
      ['an empty label', { slug: 'ctnolabel', label: '' }],
      ['an unknown supports value', { slug: 'ctbad', label: 'X', supports: ['title', 'teleport'] }],
      ['a reserved rest_base', { slug: 'ctbad', label: 'X', rest_base: 'posts' }],
      ['another reserved rest_base', { slug: 'ctbad', label: 'X', rest_base: 'users' }],
      ['an invalid rest_base', { slug: 'ctbad', label: 'X', rest_base: 'a/b' }],
      ['a non-dashicon menu_icon', { slug: 'ctbad', label: 'X', menu_icon: 'http://evil.test/x.svg' }],
      ['a script menu_icon', { slug: 'ctbad', label: 'X', menu_icon: 'javascript:alert(1)' }],
      ['a non-boolean public', { slug: 'ctbad', label: 'X', public: 'yes' }],
    ])('rejects a post type with %s and saves nothing', async (_l, def) => {
      const before = JSON.stringify((await model()).post_types);
      const r = await s.call('content_type_set', def as never);
      expect(r.isError).toBe(true);
      expect(JSON.stringify((await model()).post_types)).toBe(before);
    });

    it('rejects a rest_base already used by another type in the model', async () => {
      await s.call('content_type_set', { slug: 'ctone', label: 'One', rest_base: 'ctshared' });
      const r = await s.call('content_type_set', { slug: 'cttwo', label: 'Two', rest_base: 'ctshared' });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/rest_base_in_use/);
    });

    it.each([
      ['category', { slug: 'category', label: 'X' }],
      ['post_tag', { slug: 'post_tag', label: 'X' }],
      ['nav_menu', { slug: 'nav_menu', label: 'X' }],
      ['an uppercase slug', { slug: 'CtTax', label: 'X' }],
      ['a reserved rest_base', { slug: 'cttax', label: 'X', rest_base: 'categories' }],
    ])('rejects a taxonomy with %s', async (_l, def) => {
      const r = await s.call('content_taxonomy_set', def as never);
      expect(r.isError).toBe(true);
    });

    it.each([
      ['a protected underscore key', { key: '_ct_secret', post_types: ['post'], type: 'string' }],
      ['a wp_ prefixed key', { key: 'wp_ct', post_types: ['post'], type: 'string' }],
      ['an uppercase key', { key: 'CT_x', post_types: ['post'], type: 'string' }],
      ['an unknown type', { key: 'ct_x', post_types: ['post'], type: 'object' }],
      ['no post types', { key: 'ct_x', post_types: [], type: 'string' }],
      ['an invalid post type slug', { key: 'ct_x', post_types: ['Bad Slug'], type: 'string' }],
      ['an array without a valid items_type', { key: 'ct_x', post_types: ['post'], type: 'array', items_type: 'object' }],
      ['a default of the wrong type', { key: 'ct_x', post_types: ['post'], type: 'integer', default: 'abc' }],
    ])('rejects a meta field with %s', async (_l, def) => {
      const before = JSON.stringify((await model()).meta);
      const r = await s.call('content_meta_set', def as never);
      expect(r.isError, r.text).toBe(true);
      expect(JSON.stringify((await model()).meta)).toBe(before); // nothing was saved
    });

    it('rejects unknown fields instead of silently ignoring a typo', async () => {
      const r = await wp('POST', '/wp-json/agent/v1/content-model/post-types/cttypo', { label: 'Typo', suports: ['title'] });
      expect(r.status).toBe(422);
      expect(r.json.message).toMatch(/suports/);
    });

    it('returns 404 when deleting something that is not in the model', async () => {
      for (const tool of [['content_type_delete', { slug: 'ctnothere' }], ['content_taxonomy_delete', { slug: 'ctnothere' }], ['content_meta_delete', { key: 'ct_nothere' }]] as const) {
        const r = await s.call(tool[0], tool[1] as never);
        expect(r.isError, tool[0]).toBe(true);
      }
    });
  });
});
