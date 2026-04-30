import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config } from './config.js';
import { create_server } from './server.js';

async function main(): Promise<void> {
  const server = create_server();

  if (config.transport === 'http') {
    // Dynamically import to avoid loading HTTP deps in stdio mode
    const { StreamableHTTPServerTransport } = await import(
      '@modelcontextprotocol/sdk/server/streamableHttp.js'
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);

    const http = await import('node:http');
    const httpServer = http.createServer((req, res) => {
      transport.handleRequest(req, res);
    });
    httpServer.listen(config.httpPort, () => {
      process.stderr.write(`[info] wordpress-mcp HTTP server listening on port ${config.httpPort}\n`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write('[info] wordpress-mcp stdio server started\n');
  }
}

main().catch(err => {
  process.stderr.write(`[fatal] ${err}\n`);
  process.exit(1);
});
