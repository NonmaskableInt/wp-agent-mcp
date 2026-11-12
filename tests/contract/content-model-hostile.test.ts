import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { bridgeConfigured } from '../helpers/bridge.js';

/**
 * Runtime safety must not depend on write-time validation: whatever is in the stored option
 * (an old bug, a direct database edit) must never redefine WordPress core.
 * Needs shell access to the dev container to write the option directly, bypassing the API.
 */
const CONTAINER = process.env.BRIDGE_TEST_CONTAINER;
const BASE = (process.env.BRIDGE_TEST_URL ?? '').replace(/\/$/, '');

const php = (code: string) =>
  execFileSync('podman', ['exec', CONTAINER!, 'php', '-r', `define("WP_USE_THEMES", false); require "/var/www/html/wp-load.php"; ${code}`], { encoding: 'utf8' });

describe.skipIf(!bridgeConfigured || !CONTAINER)('contract: hostile stored content model', () => {
  afterAll(() => {
    php('delete_option("agent_bridge_content_model");');
  });

  it('cannot rename core post types, taxonomies, or register wp_ meta, even if stored', async () => {
    php(`update_option("agent_bridge_content_model", [
      "post_types" => ["post" => ["label" => "HACKED"], "page" => ["label" => "HACKED2"], "attachment" => ["label" => "HACKED3"]],
      "taxonomies" => ["category" => ["label" => "HACKEDCAT"], "post_tag" => ["label" => "HACKEDTAG"]],
      "meta" => ["wp_siteurl_x" => ["type" => "string", "post_types" => ["post"]]],
    ]);`);

    const types = (await (await fetch(`${BASE}/wp-json/wp/v2/types`)).json()) as Record<string, { name: string }>;
    expect(types.post.name).toBe('Posts');
    expect(types.page.name).toBe('Pages');
    expect(types.attachment.name).toBe('Media');

    const taxes = (await (await fetch(`${BASE}/wp-json/wp/v2/taxonomies`)).json()) as Record<string, { name: string }>;
    expect(taxes.category.name).toBe('Categories');
    expect(taxes.post_tag.name).toBe('Tags');

    expect(php('echo registered_meta_key_exists("post", "wp_siteurl_x", "post") ? "YES" : "no";')).toBe('no');
  });

  it('a corrupt stored option never breaks the site', async () => {
    for (const junk of ['"a string"', '123', 'null', '["post_types" => "nope", "taxonomies" => 5, "meta" => [[]]]', '["post_types" => ["ctok" => ["label" => ["array"]], 7 => ["label" => "x"]]]']) {
      php(`update_option("agent_bridge_content_model", ${junk});`);
      const res = await fetch(`${BASE}/wp-json/`);
      expect(res.status, junk).toBe(200);
      expect((await fetch(`${BASE}/`, { redirect: 'manual' })).status, junk).toBeLessThan(500);
    }
  });
});
