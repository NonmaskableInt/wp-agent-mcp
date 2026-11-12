import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BridgeClient } from '../client.js';
import { tool_success, handle_tool_error } from '../types.js';

const any = (description: string) => z.unknown().optional().describe(description);
const defined = (input: Record<string, unknown>) => Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));

export function register(server: McpServer, client: BridgeClient): void {

  server.tool(
    'global_styles_get',
    'Read the site\'s user-level global styles (the Site Editor "Styles" layer: colours, typography, spacing, palettes). It is stored in the ' +
      'database and OVERRIDES the theme\'s theme.json, so editing theme.json can appear to do nothing. Pass include="theme" to also get ' +
      'the theme.json defaults being overridden. Block themes / themes with theme.json only.',
    { include: any('"theme" to include the theme.json defaults') },
    { readOnlyHint: true },
    async (input) => {
      try {
        return tool_success(await client.get('/global-styles', input.include ? { include: String(input.include) } : undefined));
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'global_styles_set',
    'Change the site\'s global styles. "settings" and "styles" use theme.json structure, e.g. styles:{color:{background:"#fff"},typography:{fontSize:"18px"}} ' +
      'or settings:{color:{palette:{custom:[{slug:"brand",name:"Brand",color:"#12ab34"}]}}}. By default changes MERGE into what is there (lists such as ' +
      'palettes are replaced as a whole); merge=false replaces the given section. Properties WordPress would silently ignore are not saved and are ' +
      'returned in "ignored". Take a look at global_styles_get include="theme" for valid names.',
    {
      settings: any('theme.json "settings" object'),
      styles: any('theme.json "styles" object'),
      merge: any('boolean, default true'),
    },
    async (input) => {
      try {
        return tool_success(await client.post('/global-styles', defined(input)));
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'global_styles_reset',
    'Remove all user style customisations so the theme\'s own theme.json applies again. Backed up first (see global_styles_backups / global_styles_restore).',
    {},
    async () => {
      try {
        return tool_success(await client.delete('/global-styles'));
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'global_styles_backups',
    'List saved copies of global styles removed by global_styles_reset, newest first.',
    {},
    { readOnlyHint: true },
    async () => {
      try {
        return tool_success(await client.get('/global-styles/backups'));
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'global_styles_restore',
    'Bring back global styles from a backup listed by global_styles_backups (same theme only).',
    { name: z.string() },
    async (input) => {
      try {
        return tool_success(await client.post('/global-styles/restore', { name: input.name }));
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );
}
