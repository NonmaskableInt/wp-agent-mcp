import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BridgeClient } from '../client.js';
import { tool_success, handle_tool_error } from '../types.js';

export function register(server: McpServer, client: BridgeClient): void {

  server.tool(
    'db_list_tables',
    'List all database tables. Requires AGENT_BRIDGE_DB_API=true on the bridge.',
    {},
    { readOnlyHint: true },
    async () => {
      try {
        const data = await client.get('/db/tables');
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'db_get_schema',
    'Get columns and indexes for a specific database table. Requires AGENT_BRIDGE_DB_API=true on the bridge.',
    {
      table: z.string().describe('Table name to inspect'),
    },
    { readOnlyHint: true },
    async (input) => {
      try {
        const data = await client.get('/db/schema', { table: input.table });
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'db_select',
    'Run a SELECT, SHOW, or EXPLAIN query against the database using prepared statements. Requires AGENT_BRIDGE_DB_API=true on the bridge. DDL and write statements are blocked here — use db_query for INSERT/UPDATE/DELETE.',
    {
      sql: z.string().describe('SQL query (SELECT, SHOW, or EXPLAIN only)'),
      params: z.array(z.union([z.string(), z.number(), z.null()])).optional()
        .describe('Ordered positional parameters bound via wpdb->prepare()'),
    },
    { readOnlyHint: true },
    async (input) => {
      try {
        const data = await client.post('/db/select', {
          sql: input.sql,
          params: input.params ?? [],
        });
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'db_query',
    'Run an INSERT, UPDATE, or DELETE query against the database using prepared statements. Requires AGENT_BRIDGE_DB_API=true on the bridge. DDL (CREATE/DROP/ALTER) is blocked unless AGENT_BRIDGE_DB_ALLOW_DDL=true. Returns rows_affected and insert_id.',
    {
      sql: z.string().describe('SQL query (INSERT, UPDATE, DELETE, or DDL if enabled)'),
      params: z.array(z.union([z.string(), z.number(), z.null()])).optional()
        .describe('Ordered positional parameters bound via wpdb->prepare()'),
    },
    { destructiveHint: true },
    async (input) => {
      try {
        const data = await client.post('/db/query', {
          sql: input.sql,
          params: input.params ?? [],
        });
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );
}
