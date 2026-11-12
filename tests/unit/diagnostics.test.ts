import { spawn } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { format_report, run_diagnostics } from '../../src/diagnostics.js';
import { basic, start_fake_wp, type Handler } from '../helpers/fake-wp.js';

const USER = 'agent-user';
const PASS = 'Zq9xK2mP7wLr4TnB8vYcHd3F'; // distinctive, so any leak into output is detectable

const STATUS = {
  bridge: { version: '1.0.0', routes: 62 },
  wordpress: { version: '7.1.4', multisite: false },
  php: { version: '8.3.36' },
  site: { url: 'https://example.test', theme: 'yith-wonder', theme_type: 'block' },
  features: { file_write: false, file_edit_blocked: true, cli: { enabled: true, mode: 'allowlist' }, db_api: false, option_groups: ['general', 'reading'], php_verification: true },
  user: { login: USER, roles: ['administrator'], can: { manage_options: true, edit_themes: true } },
};

const authed = (req: { headers: Record<string, unknown> }) => req.headers.authorization === basic(USER, PASS);
const healthy = (): Record<string, Handler> => ({
  'GET /wp-json/': () => ({ status: 200, body: { name: 'Welcome', url: 'https://example.test', authentication: { 'application-passwords': {} } } }),
  'GET /wp-json/wp/v2/users/me': (req) => authed(req)
    ? { status: 200, body: { id: 2, slug: USER, roles: ['administrator'] } }
    : { status: 401, body: { code: 'rest_not_logged_in', message: 'You are not currently logged in.', data: { status: 401 } } },
  'GET /wp-json/agent/v1/status': (req) => authed(req)
    ? { status: 200, body: { ok: true, data: STATUS } }
    : { status: 401, body: { code: 'rest_forbidden', message: 'Sorry, you are not allowed to do that.', data: { status: 401 } } },
});

let fake: Awaited<ReturnType<typeof start_fake_wp>> | undefined;
const serve = async (routes: Record<string, Handler>) => {
  await fake?.close();
  fake = await start_fake_wp(routes);
  return fake.url;
};
afterAll(async () => fake?.close());

const step = (r: Awaited<ReturnType<typeof run_diagnostics>>, name: string) => r.steps.find((s) => s.name === name)!;
const run = (url: string, over: Partial<{ username: string; appPassword: string }> = {}) =>
  run_diagnostics({ baseUrl: url, username: USER, appPassword: PASS, ...over, timeoutMs: 5000 });

describe('run_diagnostics', () => {
  it('a healthy setup passes every step and reports what the bridge allows', async () => {
    const r = await run(await serve(healthy()));
    expect(r.ok).toBe(true);
    expect(r.steps.map((s) => s.name)).toEqual(['config', 'reach', 'authenticate', 'bridge']);
    expect(r.steps.every((s) => s.status === 'ok' || s.status === 'warn')).toBe(true);
    expect(r.problems).toEqual([]);
    expect(step(r, 'authenticate').summary).toContain(USER);
    expect(r.bridge?.bridge.version).toBe('1.0.0');
    expect(r.bridge?.features.file_write).toBe(false);
    expect(step(r, 'bridge').summary).toMatch(/1\.0\.0/);
  });

  it('a wrong password fails at authentication with the application-password hint, and skips what depends on it', async () => {
    const r = await run(await serve(healthy()), { appPassword: 'definitely-wrong' });
    expect(r.ok).toBe(false);
    expect(step(r, 'reach').status).toBe('ok');
    expect(step(r, 'authenticate').status).toBe('fail');
    expect(step(r, 'authenticate').hint).toMatch(/application password/i);
    expect(step(r, 'bridge').status).toBe('skipped');
    expect(r.problems.join(' ')).toMatch(/application password/i);
  });

  it('a wrong host (HTML 404 for the REST API) fails at reach and names the URL', async () => {
    const url = await serve({ '*': () => ({ status: 404, body: '<!doctype html><html><body>404</body></html>' }) });
    const r = await run(url);
    expect(r.ok).toBe(false);
    expect(step(r, 'reach').status).toBe('fail');
    expect(step(r, 'reach').summary).toContain(url);
    expect(step(r, 'reach').hint).toMatch(/URL|www|WP_BASE_URL/i);
    expect(step(r, 'authenticate').status).toBe('skipped');
    expect(step(r, 'bridge').status).toBe('skipped');
    // Skipped means skipped: exactly four steps, and the only request made was the unauthenticated reach check.
    expect(r.steps).toHaveLength(4);
    expect(fake!.hits).toEqual(['GET /wp-json/']);
  });

  it('after a failed authentication nothing further is requested', async () => {
    const r = await run(await serve(healthy()), { appPassword: 'definitely-wrong' });
    expect(r.steps).toHaveLength(4);
    expect(fake!.hits).toEqual(['GET /wp-json/', 'GET /wp-json/wp/v2/users/me']);
  });

  it('a host firewall (406) is called out as such', async () => {
    const r = await run(await serve({ '*': () => ({ status: 406, body: '<html><title>Not Acceptable!</title></html>' }) }));
    expect(step(r, 'reach').status).toBe('fail');
    expect(step(r, 'reach').hint).toMatch(/firewall|ModSecurity/i);
  });

  it('a server error (500) says to look at the server', async () => {
    const r = await run(await serve({ '*': () => ({ status: 500, body: '<html>Internal Server Error</html>' }) }));
    expect(step(r, 'reach').status).toBe('fail');
    expect(step(r, 'reach').hint).toMatch(/error log|\.htaccess|PHP/i);
  });

  it('a maintenance/login page served with 200 is recognised as "not WordPress JSON"', async () => {
    const r = await run(await serve({ '*': () => ({ status: 200, body: '<html><body>Coming soon</body></html>' }) }));
    expect(step(r, 'reach').status).toBe('fail');
    expect(step(r, 'reach').hint).toMatch(/HTML|maintenance|different site|redirect/i);
  });

  it('nothing listening is reported as a refused connection', async () => {
    const r = await run_diagnostics({ baseUrl: 'http://127.0.0.1:9', username: USER, appPassword: PASS, timeoutMs: 3000 });
    expect(r.ok).toBe(false);
    expect(step(r, 'reach').status).toBe('fail');
    expect(step(r, 'reach').hint).toMatch(/refused|listening|port|URL/i);
  });

  it('an unresolvable host is reported as a DNS problem', async () => {
    const r = await run_diagnostics({ baseUrl: 'http://no-such-host.invalid', username: USER, appPassword: PASS, timeoutMs: 8000 });
    expect(step(r, 'reach').status).toBe('fail');
    expect(step(r, 'reach').hint).toMatch(/resolve|DNS|spell/i);
  });

  it('the bridge plugin missing is distinguished from bad credentials', async () => {
    const routes = healthy();
    routes['GET /wp-json/agent/v1/status'] = () => ({ status: 404, body: { code: 'rest_no_route', message: 'No route was found matching the URL and request method.', data: { status: 404 } } });
    routes['GET /wp-json/agent/v1/options/schema'] = () => ({ status: 404, body: { code: 'rest_no_route', message: 'No route.', data: { status: 404 } } });
    const r = await run(await serve(routes));
    expect(r.ok).toBe(false);
    expect(step(r, 'authenticate').status).toBe('ok');
    expect(step(r, 'bridge').status).toBe('fail');
    expect(step(r, 'bridge').hint).toMatch(/php-agent-bridge|not installed|inactive|activate/i);
  });

  it('an OLDER bridge (no /status, but the API works) is accepted with a warning', async () => {
    const routes = healthy();
    routes['GET /wp-json/agent/v1/status'] = () => ({ status: 404, body: { code: 'rest_no_route', message: 'No route.', data: { status: 404 } } });
    routes['GET /wp-json/agent/v1/options/schema'] = (req) => authed(req) ? { status: 200, body: { ok: true, data: { groups: {} } } } : { status: 401, body: { code: 'rest_forbidden', message: 'x', data: { status: 401 } } };
    const r = await run(await serve(routes));
    expect(r.ok).toBe(true);
    expect(step(r, 'bridge').status).toBe('warn');
    expect(step(r, 'bridge').summary).toMatch(/older|no status|before/i);
  });

  it('a non-administrator is told what they lack', async () => {
    const routes = healthy();
    routes['GET /wp-json/agent/v1/status'] = () => ({ status: 403, body: { ok: false, code: 'insufficient_capability', message: 'You need manage_options capability for this operation.', data: { status: 403 } } });
    const r = await run(await serve(routes));
    expect(step(r, 'bridge').status).toBe('fail');
    expect(step(r, 'bridge').hint).toMatch(/administrator/i); // the advice, not just the server's raw message
  });

  it('warns (without failing) when the site does not advertise application passwords', async () => {
    const routes = healthy();
    routes['GET /wp-json/'] = () => ({ status: 200, body: { name: 'Welcome', url: 'http://example.test', authentication: [] } });
    const r = await run(await serve(routes));
    expect(step(r, 'reach').status).toBe('warn');
    expect(step(r, 'reach').hint).toMatch(/HTTPS|application passwords/i);
  });

  it('subdirectory installs work (the base URL keeps its path)', async () => {
    const routes: Record<string, Handler> = {};
    for (const [k, v] of Object.entries(healthy())) routes[k.replace(' /wp-json', ' /blog/wp-json')] = v;
    const url = await serve(routes);
    const r = await run(`${url}/blog`);
    expect(r.ok).toBe(true);
  });

  it('a config problem is reported as the first step and nothing is requested', async () => {
    const url = await serve(healthy());
    const hitsBefore = fake!.hits.length;
    const r = await run_diagnostics({ baseUrl: 'example.com', username: USER, appPassword: PASS, timeoutMs: 2000 });
    expect(r.ok).toBe(false);
    expect(step(r, 'config').status).toBe('fail');
    expect(step(r, 'reach').status).toBe('skipped');
    expect(fake!.hits.length).toBe(hitsBefore);
    expect(url).toBeTruthy();
  });

  it('NEVER leaks the password into the report or its text', async () => {
    for (const wrong of [PASS, 'definitely-wrong-password-XYZ']) {
      const r = await run(await serve(healthy()), { appPassword: wrong });
      expect(JSON.stringify(r)).not.toContain(wrong);
      expect(format_report(r)).not.toContain(wrong);
    }
  });
});

describe('format_report', () => {
  it('prints each step with its status, hints on failures, and a clear verdict', async () => {
    const bad = await run(await serve(healthy()), { appPassword: 'nope' });
    const t = format_report(bad);
    expect(t).toMatch(/authenticate/i);
    expect(t).toMatch(/FAIL/);
    expect(t).toMatch(/application password/i);
    const good = format_report(await run(await serve(healthy())));
    expect(good).toMatch(/OK/);
    expect(good).toMatch(/ready|everything/i);
  });
});

describe('node dist/index.js --check (the command line)', () => {
  // Must be async: the fake WordPress lives in THIS process, so a blocking spawn would starve it.
  const check = (env: Record<string, string>) =>
    new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = spawn('npx', ['tsx', 'src/index.ts', '--check'], { cwd: process.cwd(), env: { PATH: process.env.PATH!, HOME: process.env.HOME!, ...env } });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
      const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
      child.on('close', (status) => {
        clearTimeout(timer);
        resolve({ status, stdout, stderr });
      });
    });

  let url = '';
  beforeAll(async () => { url = await serve(healthy()); });

  it('exits 0 and says so when everything works', async () => {
    const r = await check({ WP_BASE_URL: url, WP_USERNAME: USER, WP_APP_PASSWORD: PASS });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/OK|ready/i);
    expect(r.stdout + r.stderr).not.toContain(PASS);
  });

  it('exits 1 with the application-password hint for a wrong password', async () => {
    const r = await check({ WP_BASE_URL: url, WP_USERNAME: USER, WP_APP_PASSWORD: 'wrong-password-1234' });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/application password/i);
    expect(r.stdout + r.stderr).not.toContain('wrong-password-1234');
  });

  it('exits 1 listing every missing setting, and explains where they go', async () => {
    const r = await check({});
    expect(r.status).toBe(1);
    const out = r.stdout + r.stderr;
    for (const k of ['WP_BASE_URL', 'WP_USERNAME', 'WP_APP_PASSWORD']) expect(out).toContain(k);
    expect(out).toMatch(/env/);
  });
});
