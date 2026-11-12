import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BridgeClient } from '../client.js';
import { tool_success, handle_tool_error } from '../types.js';

// Values are z.unknown() on purpose: the bridge is the single authority on validation.
const any = (description: string) => z.unknown().optional().describe(description);
const defined = (input: Record<string, unknown>) => Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));

export function register(server: McpServer, client: BridgeClient): void {

  server.tool(
    'template_list',
    'List what renders the site. Block themes: every template (or template part with type="part"), whether it comes from the theme ' +
      '(source "theme") or from a database override (source "custom"; masks_theme_file=true means an override is hiding the theme file, ' +
      'so editing that file will appear to do nothing). Classic themes: the PHP template files, parts and page templates, with their ' +
      'paths for the file_* tools.',
    { type: any('"template" (default) or "part" (block themes only)') },
    { readOnlyHint: true },
    async (input) => {
      try {
        return tool_success(await client.get('/templates', input.type ? { type: String(input.type) } : undefined));
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'template_get',
    'Read a block template or part: its block markup, and for an override the theme file content it hides (theme_content). ' +
      'Block themes only; for classic themes read the PHP file with file_read.',
    { id: z.string().describe('"single" or "<theme>//single" (active theme only)'), type: any('"template" (default) or "part"') },
    { readOnlyHint: true },
    async (input) => {
      try {
        const params: Record<string, string> = { id: input.id };
        if (input.type) params.type = String(input.type);
        return tool_success(await client.get('/templates/item', params));
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'template_resolve',
    'Find out which template WordPress renders for a URL (a path like "/blog/hello/" or "/?p=12", or a full URL on this site). ' +
      'Works for block and classic themes. Returns the template (id, source theme|custom, masks_theme_file) or the PHP file, ' +
      'the template type, and the candidate hierarchy. Use it before editing: it shows exactly what to change.',
    { url: z.string() },
    { readOnlyHint: true },
    async (input) => {
      try {
        return tool_success(await client.post('/templates/resolve', { url: input.url }));
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'template_set',
    'Create or update a block template or part in the database (what the Site Editor does). For a template the theme also ships this ' +
      'is an OVERRIDE that takes precedence over the theme file; a new slug creates a custom template. Content is block markup ' +
      '(<!-- wp:group -->…). Block themes only. Use template_reset to remove an override. To change the theme\'s own files, use file_write.',
    {
      id: z.string().describe('"single" / "<theme>//single" (active theme); a new slug creates a custom template'),
      content: any('Block markup (string, max 500000 bytes)'),
      type: any('"template" (default) or "part"'),
      title: any('Display title (max 100)'),
      description: any('Max 300'),
      area: any('Parts only: header | footer | uncategorized'),
    },
    async (input) => {
      try {
        return tool_success(await client.post('/templates/item', defined(input)));
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'template_reset',
    'Remove a database override so the theme\'s own file applies again (a custom-only template is deleted). The content is backed up first; ' +
      'see template_backups / template_restore. Refuses templates that have no override.',
    { id: z.string(), type: any('"template" (default) or "part"') },
    async (input) => {
      try {
        const params: Record<string, string> = { id: input.id };
        if (input.type) params.type = String(input.type);
        return tool_success(await client.delete('/templates/item', params));
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'template_backups',
    'List saved copies of template overrides that were reset, newest first.',
    {},
    { readOnlyHint: true },
    async () => {
      try {
        return tool_success(await client.get('/templates/backups'));
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'template_restore',
    'Bring back a template override from a backup listed by template_backups.',
    { name: z.string() },
    async (input) => {
      try {
        return tool_success(await client.post('/templates/restore', { name: input.name }));
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );
}
