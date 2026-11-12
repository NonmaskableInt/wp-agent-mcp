import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

async function main(): Promise<void> {
  // Diagnose a setup from the command line, without an MCP client. Must not load ./config.js,
  // which exits when the configuration is incomplete; the check reports that itself.
  if (process.argv.includes('--check')) {
    const { run_check } = await import('./check.js');
    process.exit(await run_check());
  }

  const { config } = await import('./config.js');
  const { create_server } = await import('./server.js');
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
