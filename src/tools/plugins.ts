import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BridgeClient } from '../client.js';
import { BridgeError, tool_success, tool_error, handle_tool_error } from '../types.js';

export function register(server: McpServer, client: BridgeClient): void {

  server.tool(
    'plugin_list',
    'List installed plugins.',
    {
      status: z.enum(['active', 'inactive', 'all']).default('all'),
      search: z.string().optional(),
    },
    { readOnlyHint: true },
    async (input) => {
      try {
        const params: Record<string, string> = { status: input.status };
        if (input.search) params.search = input.search;
        const data = await client.get('/plugins', params);
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'plugin_get',
    'Get full details for a single plugin.',
    {
      slug: z.string().describe('Plugin slug, e.g. woocommerce or akismet/akismet'),
    },
    { readOnlyHint: true },
    async (input) => {
      try {
        const data = await client.get(`/plugins/${input.slug}`);
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'plugin_install',
    'Install a plugin from wordpress.org or a zip URL.',
    {
      source: z.enum(['wordpress.org', 'url']),
      slug: z.string().optional().describe('Required when source = wordpress.org'),
      url: z.string().url().optional().describe('Required when source = url (zip file)'),
      activate: z.boolean().default(false).describe('Activate after install (requires AGENT_BRIDGE_ALLOW_PLUGIN_AUTOACTIVATE)'),
    },
    { destructiveHint: true },
    async (input) => {
      try {
        const data = await client.post('/plugins/install', input);
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'plugin_activate',
    'Activate an installed plugin. Activation errors are returned as tool results rather than exceptions.',
    {
      slug: z.string(),
      network_wide: z.boolean().default(false),
    },
    async (input) => {
      try {
        const data = await client.post(`/plugins/${input.slug}/activate`, {
          network_wide: input.network_wide,
        });
        return tool_success(data);
      } catch (err) {
        if (err instanceof BridgeError && err.code === 'plugin_activation_error') {
          return tool_error(err.code, err.message);
        }
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'plugin_deactivate',
    'Deactivate an active plugin.',
    {
      slug: z.string(),
    },
    { destructiveHint: true },
    async (input) => {
      try {
        const data = await client.post(`/plugins/${input.slug}/deactivate`, {});
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'plugin_update',
    'Update a plugin to the latest version from wordpress.org. The plugin is briefly deactivated and reactivated.',
    {
      slug: z.string(),
    },
    { destructiveHint: true },
    async (input) => {
      try {
        const data = await client.post(`/plugins/${input.slug}/update`, {});
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'plugin_delete',
    'Delete a plugin. The plugin must be inactive first.',
    {
      slug: z.string(),
    },
    { destructiveHint: true },
    async (input) => {
      try {
        const data = await client.delete(`/plugins/${input.slug}`);
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'plugin_options_get',
    'Get allowlisted plugin options.',
    {
      slug: z.string(),
      keys: z.array(z.string()).optional().describe('Specific option keys; omit for all allowlisted'),
    },
    { readOnlyHint: true },
    async (input) => {
      try {
        const params: Record<string, string | string[]> = {};
        if (input.keys?.length) params.keys = input.keys;
        const data = await client.get(`/plugins/${input.slug}/options`, params);
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'plugin_options_set',
    'Update allowlisted plugin options.',
    {
      slug: z.string(),
      options: z.record(z.unknown()),
    },
    async (input) => {
      try {
        const data = await client.patch(`/plugins/${input.slug}/options`, input.options);
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );
}
