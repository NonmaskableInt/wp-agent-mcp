import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeResponse {
  status: number;
  body?: unknown; // object => JSON; string => sent as-is
  type?: string;
}
export type Handler = (req: IncomingMessage) => FakeResponse;

/** A programmable stand-in for a WordPress site, so every failure mode can be produced on demand. */
export async function start_fake_wp(routes: Record<string, Handler>): Promise<{ url: string; close: () => Promise<void>; hits: string[] }> {
  const hits: string[] = [];
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    const key = `${req.method} ${path}`;
    hits.push(key);
    const handler = routes[key] ?? routes[`* ${path}`] ?? routes['*'];
    const r = handler ? handler(req) : { status: 404, body: '<html><body>Not Found</body></html>' };
    const is_json = typeof r.body === 'object' && r.body !== null;
    res.writeHead(r.status, { 'Content-Type': r.type ?? (is_json ? 'application/json' : 'text/html; charset=UTF-8') });
    res.end(r.body === undefined ? '' : is_json ? JSON.stringify(r.body) : String(r.body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    hits,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export const basic = (user: string, pass: string) => 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
