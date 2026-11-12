import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { config } from '../config.js';
import { run_diagnostics } from '../diagnostics.js';
import { tool_success } from '../types.js';

export function register(server: McpServer): void {
  server.tool(
    'bridge_status',
    'Check this MCP server\'s connection to the WordPress site, step by step: configuration, reaching the REST API, authentication, ' +
      'and the php-agent-bridge plugin. Each step reports ok / warn / fail / skipped with a plain-language hint for fixing it. ' +
      'On success it also reports what the bridge allows on this site: its version, whether file writes are enabled (and whether ' +
      'DISALLOW_FILE_EDIT blocks them), WP-CLI mode, the database API, enabled option groups, whether PHP can be verified on this host, ' +
      'and which capabilities the authenticated user has. Call this first when anything fails or before attempting writes. Never reveals secrets.',
    {},
    { readOnlyHint: true },
    async () => tool_success(await run_diagnostics({ baseUrl: config.wp.baseUrl, username: config.wp.username, appPassword: config.wp.appPassword })),
  );
}
