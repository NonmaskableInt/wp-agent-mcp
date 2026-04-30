import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BridgeClient } from '../client.js';
import { tool_success, handle_tool_error } from '../types.js';

export function register(server: McpServer, client: BridgeClient): void {

  server.tool(
    'theme_list',
    'List installed themes.',
    {
      status: z.enum(['active', 'inactive', 'all']).default('all'),
    },
    { readOnlyHint: true },
    async (input) => {
      try {
        const data = await client.get('/themes', { status: input.status });
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'theme_get',
    'Get full details for a theme.',
    {
      stylesheet: z.string().describe('Theme stylesheet slug, e.g. astra or astra-child'),
    },
    { readOnlyHint: true },
    async (input) => {
      try {
        const data = await client.get(`/themes/${input.stylesheet}`);
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'theme_install',
    'Install a theme from wordpress.org or a zip URL.',
    {
      source: z.enum(['wordpress.org', 'url']),
      slug: z.string().optional().describe('Required when source = wordpress.org'),
      url: z.string().url().optional().describe('Required when source = url (zip file)'),
      activate: z.boolean().default(false),
    },
    { destructiveHint: true },
    async (input) => {
      try {
        const data = await client.post('/themes/install', input);
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'theme_activate',
    'Switch the active theme. Note: this fires switch_theme which can reset widget areas and nav menu locations. Returns the previous theme slug for potential rollback.',
    {
      stylesheet: z.string(),
    },
    { destructiveHint: true },
    async (input) => {
      try {
        const data = await client.post(`/themes/${input.stylesheet}/activate`, {});
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'theme_update',
    'Update a theme to the latest version.',
    {
      stylesheet: z.string(),
    },
    { destructiveHint: true },
    async (input) => {
      try {
        const data = await client.post(`/themes/${input.stylesheet}/update`, {});
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'theme_delete',
    'Delete a theme. The active theme cannot be deleted.',
    {
      stylesheet: z.string(),
    },
    { destructiveHint: true },
    async (input) => {
      try {
        const data = await client.delete(`/themes/${input.stylesheet}`);
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'theme_mods_get',
    'Get all customizer/theme_mod values for a theme.',
    {
      stylesheet: z.string().optional().describe('Defaults to the active theme'),
    },
    { readOnlyHint: true },
    async (input) => {
      try {
        const params: Record<string, string> = {};
        if (input.stylesheet) params.stylesheet = input.stylesheet;
        const data = await client.get('/themes/mods', params);
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'theme_mods_set',
    'Partially update customizer theme mods. Only supplied keys are written.',
    {
      mods: z.record(z.unknown()).describe('Theme mod key-value pairs'),
      stylesheet: z.string().optional().describe('Defaults to the active theme'),
    },
    async (input) => {
      try {
        const data = await client.patch('/themes/mods', input);
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'customizer_export',
    'Export all customizer settings (theme mods, widget settings, nav menus) as a portable JSON blob. Useful before switching themes or making bulk changes.',
    {},
    { readOnlyHint: true },
    async () => {
      try {
        const data = await client.get('/themes/customizer');
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'customizer_import',
    'Import customizer settings from a previously exported JSON blob.',
    {
      data: z.string().describe('JSON blob from customizer_export'),
      overwrite_widgets: z.boolean().default(false),
      overwrite_menus: z.boolean().default(false),
    },
    { destructiveHint: true },
    async (input) => {
      try {
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(input.data) as Record<string, unknown>;
        } catch {
          return { content: [{ type: 'text' as const, text: 'Error parse_error: data is not valid JSON' }], isError: true };
        }

        const body: Record<string, unknown> = {
          stylesheet: parsed.stylesheet,
          theme_mods: parsed.theme_mods,
        };
        if (input.overwrite_widgets) body.widget_options = parsed.widget_options;
        if (input.overwrite_menus) body.sidebars = parsed.sidebars;

        const result = await client.post('/themes/customizer', body);
        return tool_success(result);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );
}
