import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BridgeClient } from '../client.js';
import { tool_success, handle_tool_error } from '../types.js';

// Values are z.unknown() on purpose: the bridge is the single authority on validation
// (strict types, reserved names, collisions), so its errors reach the agent verbatim.
const any = (description: string) => z.unknown().optional().describe(description);

const defined = (input: Record<string, unknown>, omit: string[]) =>
  Object.fromEntries(Object.entries(input).filter(([k, v]) => v !== undefined && !omit.includes(k)));

export function register(server: McpServer, client: BridgeClient): void {

  server.tool(
    'content_model_get',
    'Get the custom data model: post types, taxonomies and meta fields defined through the bridge, plus warnings about dangling references.',
    {},
    { readOnlyHint: true },
    async () => {
      try {
        return tool_success(await client.get('/content-model'));
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'content_type_set',
    'Create or update a custom post type (e.g. "book"). It is registered on every request with REST enabled, so it is ' +
      'immediately available at /wp-json/wp/v2/<rest_base> for a headless front end. Re-running with the same slug updates it. ' +
      'Core types (post, page, attachment, …) cannot be redefined. Removing a type later keeps its posts in the database.',
    {
      slug: z.string().describe('Lowercase letters, digits, _ or -; starts with a letter; max 20 chars'),
      label: any('Plural display name, e.g. "Books" (required)'),
      singular_label: any('e.g. "Book" (defaults to label)'),
      description: any('Up to 200 characters'),
      public: any('boolean, default true: has a front-end page at /<rewrite_slug>/<post>/'),
      hierarchical: any('boolean, default false'),
      has_archive: any('boolean, default false'),
      supports: any('list from: title, editor, author, thumbnail, excerpt, trackbacks, custom-fields, comments, revisions, page-attributes, post-formats (default ["title","editor"])'),
      taxonomies: any('list of taxonomy slugs to attach'),
      rest_base: any('REST path segment (default: the slug). Cannot clash with core or another type'),
      menu_icon: any('dashicons class, e.g. "dashicons-book"'),
      menu_position: any('integer 5-100'),
      rewrite_slug: any('URL prefix for public pages (default: the slug)'),
    },
    async (input) => {
      try {
        return tool_success(await client.post(`/content-model/post-types/${encodeURIComponent(input.slug)}`, defined(input, ['slug'])));
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'content_type_delete',
    'Remove a custom post type definition. Its REST route disappears; existing posts stay in the database (the response reports how many) and return if the type is defined again.',
    { slug: z.string() },
    async (input) => {
      try {
        return tool_success(await client.delete(`/content-model/post-types/${encodeURIComponent(input.slug)}`));
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'content_taxonomy_set',
    'Create or update a custom taxonomy (e.g. "genre") with REST enabled at /wp-json/wp/v2/<rest_base>. Core taxonomies (category, post_tag, …) cannot be redefined.',
    {
      slug: z.string().describe('Lowercase letters, digits, _ or -; starts with a letter; max 20 chars'),
      label: any('Plural display name (required)'),
      singular_label: any('Defaults to label'),
      object_types: any('list of post type slugs it applies to'),
      hierarchical: any('boolean, default false (true = category-like)'),
      rest_base: any('REST path segment (default: the slug)'),
      public: any('boolean, default true'),
    },
    async (input) => {
      try {
        return tool_success(await client.post(`/content-model/taxonomies/${encodeURIComponent(input.slug)}`, defined(input, ['slug'])));
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'content_taxonomy_delete',
    'Remove a custom taxonomy definition (its REST route disappears; term data stays in the database).',
    { slug: z.string() },
    async (input) => {
      try {
        return tool_success(await client.delete(`/content-model/taxonomies/${encodeURIComponent(input.slug)}`));
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'content_meta_set',
    'Define a typed custom field on one or more post types. It is exposed in the REST "meta" object of those posts, ' +
      'validated by type (a string sent to an integer field is rejected), and the post type gets custom-fields support automatically. ' +
      'Keys are lowercase, must not start with "_" or "wp_".',
    {
      key: z.string().describe('e.g. "isbn"; lowercase letters, digits, _ ; starts with a letter; max 64'),
      post_types: any('non-empty list of post type slugs (required)'),
      type: any('string | integer | number | boolean | array'),
      items_type: any('for type=array: string | integer | number | boolean (default string)'),
      single: any('boolean, default true'),
      description: any('Up to 200 characters'),
      default: any('Default value for scalar types; must match the type'),
    },
    async (input) => {
      try {
        return tool_success(await client.post(`/content-model/meta/${encodeURIComponent(input.key)}`, defined(input, ['key'])));
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'content_meta_delete',
    'Remove a custom field definition. It stops being exposed over REST; stored values stay in the database.',
    { key: z.string() },
    async (input) => {
      try {
        return tool_success(await client.delete(`/content-model/meta/${encodeURIComponent(input.key)}`));
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );
}
