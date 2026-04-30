import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BridgeClient } from '../client.js';
import { tool_success, handle_tool_error } from '../types.js';

export function register(server: McpServer, client: BridgeClient): void {

  server.tool(
    'post_list',
    'List posts with optional filtering. Returns summary objects (no content) to stay within context.',
    {
      post_type: z.string().default('post').describe('Post type slug'),
      status: z.enum(['publish', 'draft', 'private', 'future', 'trash']).optional(),
      search: z.string().optional(),
      category: z.string().optional().describe('Category slug'),
      tag: z.string().optional().describe('Tag slug'),
      per_page: z.number().int().min(1).max(100).default(20),
      page: z.number().int().min(1).default(1),
    },
    { readOnlyHint: true },
    async (input) => {
      try {
        const params: Record<string, string> = {
          post_type: input.post_type,
          per_page: String(input.per_page),
          page: String(input.page),
        };
        if (input.status) params.status = input.status;
        if (input.search) params.search = input.search;
        if (input.category) params.category = input.category;
        if (input.tag) params.tag = input.tag;
        const data = await client.get('/posts', params);
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'post_get',
    'Get a single post with full content, meta, ACF fields, terms, and featured media.',
    {
      id: z.number().int().positive(),
    },
    { readOnlyHint: true },
    async (input) => {
      try {
        const data = await client.get(`/posts/${input.id}`);
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'post_upsert',
    'Create or update a post atomically. Pass id to update, omit to create.',
    {
      id: z.number().int().optional().describe('Post ID — omit to create'),
      title: z.string(),
      content: z.string(),
      excerpt: z.string().optional(),
      status: z.enum(['draft', 'publish', 'private', 'future']).default('draft'),
      post_type: z.string().default('post'),
      date: z.string().optional().describe('ISO 8601 publish date (for scheduled posts)'),
      terms: z.record(z.array(z.string())).optional().describe('e.g. { "category": ["news"], "tag": ["ai"] }'),
      meta: z.record(z.unknown()).optional(),
      acf: z.record(z.unknown()).optional(),
      featured_media: z.number().int().optional().describe('Attachment ID'),
    },
    async (input) => {
      try {
        const { id, ...body } = input;
        let data: unknown;
        let created: boolean;
        if (id) {
          data = await client.patch(`/posts/${id}`, body);
          created = false;
        } else {
          data = await client.post('/posts', body);
          created = true;
        }
        const post = data as Record<string, unknown>;
        return tool_success({ id: post.id, url: post.permalink, status: post.status, created });
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'post_delete',
    'Delete a post. force=false moves to trash, force=true permanently deletes.',
    {
      id: z.number().int().positive(),
      force: z.boolean().default(false).describe('true = permanent delete, false = trash'),
    },
    { destructiveHint: true },
    async (input) => {
      try {
        const data = await client.delete(`/posts/${input.id}`, { force: String(input.force) });
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'post_duplicate',
    'Clone a post as a new draft, preserving all meta, terms, and ACF fields.',
    {
      id: z.number().int().positive(),
      new_title: z.string().optional().describe('Override the title on the new post'),
      new_status: z.enum(['draft', 'private']).default('draft'),
    },
    async (input) => {
      try {
        const clone = await client.post(`/posts/${input.id}/duplicate`, {}) as Record<string, unknown>;

        // PHP bridge always creates with " (Copy)" title and draft status
        // Apply overrides if they differ from defaults
        const needs_patch =
          (input.new_title !== undefined) ||
          (input.new_status !== 'draft');

        if (needs_patch) {
          const patch: Record<string, unknown> = {};
          if (input.new_title !== undefined) patch.title = input.new_title;
          if (input.new_status !== 'draft') patch.status = input.new_status;
          const updated = await client.patch(`/posts/${clone.id}`, patch) as Record<string, unknown>;
          return tool_success({ id: updated.id, url: updated.permalink, status: updated.status });
        }

        return tool_success({ id: clone.id, url: clone.permalink, status: clone.status });
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );
}
