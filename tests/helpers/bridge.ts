import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

/** Contract tests run against a real WordPress + php-agent-bridge (see php-agent-bridge/dev). */
export const bridgeConfigured = Boolean(
  process.env.BRIDGE_TEST_URL && process.env.BRIDGE_TEST_USER && process.env.BRIDGE_TEST_PASSWORD,
);

export interface ToolCallResult {
  isError: boolean;
  text: string;
  json: unknown;
}

/**
 * Boots the real MCP server (config is read at import time, so env must be set first)
 * and connects an in-memory MCP client to it.
 */
export async function connect(): Promise<{ call: (name: string, args?: Record<string, unknown>) => Promise<ToolCallResult>; close: () => Promise<void> }> {
  process.env.WP_BASE_URL = process.env.BRIDGE_TEST_URL!;
  process.env.WP_USERNAME = process.env.BRIDGE_TEST_USER!;
  process.env.WP_APP_PASSWORD = process.env.BRIDGE_TEST_PASSWORD!;

  const { create_server } = await import('../../src/server.js');
  const server = create_server();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'contract-test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    async call(name, args = {}) {
      const res = (await client.callTool({ name, arguments: args })) as {
        isError?: boolean;
        content: Array<{ type: string; text: string }>;
      };
      const text = res.content.map((c) => c.text).join('\n');
      let json: unknown = undefined;
      try {
        json = JSON.parse(text);
      } catch {
        /* error results are plain text */
      }
      return { isError: Boolean(res.isError), text, json };
    },
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
