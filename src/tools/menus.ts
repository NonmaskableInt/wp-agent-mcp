import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BridgeClient } from '../client.js';
import { tool_success, handle_tool_error } from '../types.js';

export function register(server: McpServer, client: BridgeClient): void {

  server.tool(
    'menu_list',
    'List all nav menus with their assigned theme locations.',
    {},
    { readOnlyHint: true },
    async () => {
      try {
        const data = await client.get('/menus');
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'menu_get',
    'Get a nav menu with full item tree and hierarchy.',
    {
      id: z.number().int().positive(),
    },
    { readOnlyHint: true },
    async (input) => {
      try {
        const data = await client.get(`/menus/${input.id}`);
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'menu_item_add',
    'Add an item to a nav menu.',
    {
      menu_id: z.number().int().positive(),
      type: z.enum(['post_type', 'taxonomy', 'custom']),
      object_id: z.number().int().optional().describe('Post/term ID (for post_type or taxonomy items)'),
      url: z.string().optional().describe('URL for custom items'),
      title: z.string().optional().describe('Override display title'),
      target: z.enum(['', '_blank']).optional(),
      parent_item_id: z.number().int().optional().describe('Parent menu item ID for nesting'),
      position: z.number().int().optional().describe('Menu order position'),
    },
    async (input) => {
      try {
        const { menu_id, ...body } = input;
        const data = await client.post(`/menus/${menu_id}/items`, body);
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'menu_item_update',
    'Update a nav menu item. Supports reordering by changing position.',
    {
      menu_id: z.number().int().positive(),
      item_id: z.number().int().positive(),
      title: z.string().optional(),
      url: z.string().optional(),
      target: z.enum(['', '_blank']).optional(),
      parent_item_id: z.number().int().optional(),
      position: z.number().int().optional(),
    },
    async (input) => {
      try {
        const { menu_id, item_id, ...body } = input;
        const data = await client.patch(`/menus/${menu_id}/items/${item_id}`, body);
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'menu_item_delete',
    'Delete a nav menu item.',
    {
      menu_id: z.number().int().positive(),
      item_id: z.number().int().positive(),
    },
    { destructiveHint: true },
    async (input) => {
      try {
        const data = await client.delete(`/menus/${input.menu_id}/items/${input.item_id}`);
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );
}
