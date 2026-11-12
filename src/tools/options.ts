import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BridgeClient } from '../client.js';
import { tool_success, handle_tool_error } from '../types.js';

export function register(server: McpServer, client: BridgeClient): void {

  server.tool(
    'option_get',
    'Get one or more WordPress options by key.',
    {
      keys: z.array(z.string()).min(1).max(20),
    },
    { readOnlyHint: true },
    async (input) => {
      try {
        const data = await client.get('/options', { keys: input.keys });
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'option_set',
    'Set one or more WordPress options.',
    {
      options: z.record(z.unknown()).describe('Key-value pairs to write'),
    },
    async (input) => {
      try {
        const data = await client.patch('/options', input.options);
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'option_schema',
    'Describe which site options can be read or set: groups (general, reading, discussion, media, permalinks, site_url), ' +
      'each key with its type and limits, which groups are enabled on this site, and which keys can never be changed ' +
      '(default_role, admin_email, blog_public, …). Call this before option_set. Values are validated and a batch is ' +
      'applied all-or-nothing. Groups that are off are enabled by the site owner in wp-config.php.',
    {},
    { readOnlyHint: true },
    async () => {
      try {
        const data = await client.get('/options/schema');
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );
}
