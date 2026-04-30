import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BridgeClient } from '../client.js';
import { tool_success, handle_tool_error } from '../types.js';

export function register(server: McpServer, client: BridgeClient): void {

  server.tool(
    'user_list',
    'List WordPress users. Returns id, login, email, display_name, roles, and registered date.',
    {
      role: z.string().optional().describe('Filter by role slug, e.g. "editor", "subscriber"'),
      search: z.string().optional().describe('Search by name, login, or email'),
      per_page: z.number().int().min(1).max(100).optional().default(20),
      page: z.number().int().min(1).optional().default(1),
    },
    { readOnlyHint: true },
    async (input) => {
      try {
        const params: Record<string, string> = {
          per_page: String(input.per_page),
          page: String(input.page),
        };
        if (input.role) params.role = input.role;
        if (input.search) params.search = input.search;
        const data = await client.get('/users', params);
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'user_get',
    'Get a single WordPress user by ID, or pass "me" to get the currently authenticated user.',
    {
      id: z.union([z.number().int().positive(), z.literal('me')])
        .describe('User ID or the string "me" for the current API user'),
    },
    { readOnlyHint: true },
    async (input) => {
      try {
        const data = await client.get(`/users/${input.id}`);
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );
}
