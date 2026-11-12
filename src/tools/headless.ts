import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BridgeClient } from '../client.js';
import { tool_success, handle_tool_error } from '../types.js';

export function register(server: McpServer, client: BridgeClient): void {

  server.tool(
    'headless_get',
    'Get the headless-CMS configuration (front-end URL, CORS allowlist, redirect, preview) and live status (REST base URL, site origin).',
    {},
    { readOnlyHint: true },
    async () => {
      try {
        return tool_success(await client.get('/headless'));
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'headless_set',
    'Configure WordPress as a headless CMS. Only the settings you pass are changed; the whole result is validated and ' +
      'nothing is saved if any part is invalid. ' +
      'cors_origins: exact origins allowed to call the REST API from a browser (no wildcards); empty list restores WordPress defaults. ' +
      'frontend_url: where the separate front end lives (different origin, or a path on this site; no query/fragment). ' +
      'redirect_frontend: send public pages to frontend_url (302/301); wp-admin, wp-login, REST, robots and sitemaps are never redirected, ' +
      'and apps deployed with app_deploy still take precedence. Needs frontend_url on a different origin. ' +
      'preview: point the editor Preview button at <frontend_url>/preview?post_id=…&post_type=…&status=…. ' +
      'Pass null for frontend_url to clear it.',
    {
      frontend_url: z.string().nullable().optional(),
      cors_origins: z.array(z.unknown()).optional(),
      redirect_frontend: z.boolean().optional(),
      redirect_status: z.number().optional().describe('301 or 302 (default 302)'),
      preview: z.boolean().optional(),
    },
    async (input) => {
      try {
        // Only send what the caller supplied (undefined must not become a change).
        const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
        return tool_success(await client.patch('/headless', patch));
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'headless_preview_link',
    'Get the preview URL for a post: the front-end preview URL when headless preview is configured, otherwise the normal WordPress preview.',
    { post_id: z.number().int().positive() },
    { readOnlyHint: true },
    async (input) => {
      try {
        return tool_success(await client.get('/headless/preview-link', { post_id: String(input.post_id) }));
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );
}
