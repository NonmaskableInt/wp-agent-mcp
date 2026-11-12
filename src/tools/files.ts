import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BridgeClient } from '../client.js';
import { tool_success, handle_tool_error } from '../types.js';

const PATH_HELP =
  'Path relative to wp-content. Allowed roots: themes, plugins, mu-plugins, agent-apps. ' +
  'wp-admin, wp-includes, wp-config.php and the bridge plugin itself are never accessible.';

export function register(server: McpServer, client: BridgeClient): void {

  server.tool(
    'file_list',
    'List a directory under wp-content. Omit path to list the allowed roots.',
    { path: z.string().optional().describe(PATH_HELP) },
    { readOnlyHint: true },
    async (input) => {
      try {
        const data = await client.get('/files', input.path ? { path: input.path } : undefined);
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'file_read',
    'Read a file (text as utf8, binary as base64) with its sha256, for use as expected_sha256 on a later write.',
    { path: z.string().describe(PATH_HELP) },
    { readOnlyHint: true },
    async (input) => {
      try {
        const data = await client.get('/files/content', { path: input.path });
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'file_write',
    'Create or replace a file. PHP is linted before it lands, the previous version is backed up, and WordPress is ' +
      'boot-tested afterwards; if the site would break, the change is rolled back automatically and an error is returned. ' +
      'Requires AGENT_BRIDGE_ALLOW_FILE_WRITE on the site.',
    {
      path: z.string().describe(PATH_HELP),
      content: z.string().describe('File contents (utf8, or base64 when encoding is base64)'),
      encoding: z.enum(['utf8', 'base64']).default('utf8'),
      expected_sha256: z
        .string()
        .optional()
        .describe('Fail with a conflict if the file changed since this hash (optimistic concurrency)'),
    },
    async (input) => {
      try {
        const data = await client.post('/files/content', input);
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'file_delete',
    'Delete a file (backed up first) or, with recursive=true, a directory. Active themes/plugins and root directories are refused.',
    {
      path: z.string().describe(PATH_HELP),
      recursive: z.boolean().default(false),
    },
    async (input) => {
      try {
        const data = await client.delete('/files', {
          path: input.path,
          recursive: String(input.recursive),
        });
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'file_backups',
    'List stored previous versions of a file, newest first.',
    { path: z.string().describe(PATH_HELP) },
    { readOnlyHint: true },
    async (input) => {
      try {
        const data = await client.get('/files/backups', { path: input.path });
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'file_restore',
    'Restore a file from a backup (latest unless backup_id is given). Goes through the same lint and health-check pipeline as a write.',
    {
      path: z.string().describe(PATH_HELP),
      backup_id: z.string().optional(),
    },
    async (input) => {
      try {
        const data = await client.post('/files/restore', input);
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );
}
