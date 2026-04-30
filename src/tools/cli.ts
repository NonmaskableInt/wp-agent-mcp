import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BridgeClient } from '../client.js';
import { tool_success, handle_tool_error } from '../types.js';

export function register(server: McpServer, client: BridgeClient): void {

  server.tool(
    'wp_cli_run',
    'Run an allowlisted WP-CLI command. The PHP bridge enforces its own allowlist and uses safe argument tokenization (no shell interpolation).',
    {
      command: z.string().describe('WP-CLI command without the "wp" prefix, e.g. "cache flush"'),
      args: z.record(z.string()).optional().describe('Named arguments merged into the command string'),
    },
    async (input) => {
      try {
        let cmd = input.command;
        if (input.args) {
          for (const [key, val] of Object.entries(input.args)) {
            cmd += ` --${key}=${val}`;
          }
        }
        const data = await client.post('/wp-cli', { command: cmd });
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );
}
