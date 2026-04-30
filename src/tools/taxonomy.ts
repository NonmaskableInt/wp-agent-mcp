import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BridgeClient } from '../client.js';
import { tool_success, handle_tool_error } from '../types.js';

export function register(server: McpServer, client: BridgeClient): void {

  server.tool(
    'term_list',
    'List taxonomy terms.',
    {
      taxonomy: z.string().describe('Taxonomy slug, e.g. category, post_tag'),
      search: z.string().optional(),
      parent: z.number().int().optional().describe('Filter by parent term ID'),
      hide_empty: z.boolean().default(false),
    },
    { readOnlyHint: true },
    async (input) => {
      try {
        const params: Record<string, string> = {
          hide_empty: String(input.hide_empty),
        };
        if (input.search) params.search = input.search;
        if (input.parent !== undefined) params.parent = String(input.parent);
        const data = await client.get(`/taxonomies/${input.taxonomy}/terms`, params);
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'term_create',
    'Create a new taxonomy term.',
    {
      taxonomy: z.string(),
      name: z.string(),
      slug: z.string().optional(),
      parent: z.number().int().optional(),
      description: z.string().optional(),
    },
    async (input) => {
      try {
        const { taxonomy, ...body } = input;
        const data = await client.post(`/taxonomies/${taxonomy}/terms`, body);
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'term_update',
    'Update an existing taxonomy term.',
    {
      taxonomy: z.string(),
      id: z.number().int().positive(),
      name: z.string().optional(),
      slug: z.string().optional(),
      parent: z.number().int().optional(),
      description: z.string().optional(),
    },
    async (input) => {
      try {
        const { taxonomy, id, ...body } = input;
        const data = await client.patch(`/taxonomies/${taxonomy}/terms/${id}`, body);
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'term_delete',
    'Delete a taxonomy term.',
    {
      taxonomy: z.string(),
      id: z.number().int().positive(),
    },
    { destructiveHint: true },
    async (input) => {
      try {
        const data = await client.delete(`/taxonomies/${input.taxonomy}/terms/${input.id}`);
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );
}
