import { validate_env } from './env.js';
import { enrich_error, explain_http_failure, explain_network_error } from './errors.js';
import { fetch_same_origin, is_redirect, redirect_message } from './safe-fetch.js';

export type StepStatus = 'ok' | 'warn' | 'fail' | 'skipped';

export interface Step {
  name: 'config' | 'reach' | 'authenticate' | 'bridge';
  status: StepStatus;
  summary: string;
  hint?: string;
}

/** What GET /status on the bridge returns (see php-agent-bridge StatusRoute). */
export interface BridgeStatus {
  bridge: { version: string; namespace?: string; routes: number };
  wordpress: { version: string; multisite: boolean };
  php: { version: string };
  site: { url: string; theme: string; theme_type: string };
  features: Record<string, unknown> & { file_write?: boolean; file_edit_blocked?: boolean; php_verification?: boolean; cli?: { enabled: boolean; mode: string }; db_api?: boolean; option_groups?: string[] };
  user: { login: string; roles: string[]; can: Record<string, boolean> };
}

export interface Report {
  ok: boolean;
  target: string;
  steps: Step[];
  problems: string[];
  bridge?: BridgeStatus;
}

export interface DiagnosticsInput {
  baseUrl: string;
  username: string;
  appPassword: string;
  timeoutMs?: number;
}

type Outcome =
  | { kind: 'response'; status: number; contentType: string; text: string; json?: any; url: string }
  | { kind: 'error'; code: string; message: string };

async function request(url: string, timeoutMs: number, authorization?: string): Promise<Outcome> {
  try {
    const res = await fetch_same_origin(url, {
      headers: { Accept: 'application/json', ...(authorization ? { Authorization: authorization, 'X-Agent-Authorization': authorization } : {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (is_redirect(res.status)) {
      return { kind: 'error', code: 'redirect_blocked', message: redirect_message(res, url) };
    }
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { kind: 'response', status: res.status, contentType: res.headers.get('content-type') ?? '', text, json, url };
  } catch (err) {
    const e = explain_network_error(err, url);
    return { kind: 'error', code: e.code, message: e.message };
  }
}

/** A failure explanation for an outcome that is not the JSON we wanted. */
function why(o: Outcome): string {
  if (o.kind === 'error') return o.message;
  if (o.json && typeof o.json === 'object' && (o.json.code || o.json.message)) {
    return enrich_error(String(o.json.code ?? ''), String(o.json.message ?? ''), o.status);
  }
  return explain_http_failure({ status: o.status, url: o.url, contentType: o.contentType, body: o.text }).message;
}

const skipped = (name: Step['name'], because: string): Step => ({ name, status: 'skipped', summary: `Skipped: ${because}` });

export async function run_diagnostics(input: DiagnosticsInput): Promise<Report> {
  const timeoutMs = input.timeoutMs ?? 30_000;
  const steps: Step[] = [];
  const finish = (bridge?: BridgeStatus): Report => {
    const problems = steps.filter((s) => s.status === 'fail').map((s) => `${s.name}: ${s.summary}${s.hint ? ` — ${s.hint}` : ''}`);
    return { ok: problems.length === 0, target: input.baseUrl, steps, problems, ...(bridge ? { bridge } : {}) };
  };

  // 1. configuration
  const env = validate_env({ WP_BASE_URL: input.baseUrl, WP_USERNAME: input.username, WP_APP_PASSWORD: input.appPassword });
  if (!env.values) {
    steps.push({ name: 'config', status: 'fail', summary: 'The configuration is not usable.', hint: env.problems.join(' ') });
    steps.push(skipped('reach', 'fix the configuration first'), skipped('authenticate', 'fix the configuration first'), skipped('bridge', 'fix the configuration first'));
    return finish();
  }
  const { baseUrl, username, appPassword } = env.values;
  steps.push({ name: 'config', status: 'ok', summary: `Using ${baseUrl} as ${username}.`, ...(env.notes.length ? { hint: env.notes.join(' ') } : {}) });
  const authorization = 'Basic ' + Buffer.from(`${username}:${appPassword}`).toString('base64');

  // 2. can we reach the REST API at all (no credentials)?
  const index = await request(`${baseUrl}/wp-json/`, timeoutMs);
  if (index.kind === 'response' && index.status === 401 && index.json?.code === 'rest_login_required') {
    steps.push({ name: 'reach', status: 'warn', summary: 'The REST API requires login even for the index; continuing with credentials.' });
  } else if (index.kind !== 'response' || index.status !== 200 || !index.json || typeof index.json !== 'object') {
    const effective: Outcome = index.kind === 'response' && index.status === 200 && !index.json
      ? { ...index, status: 200 }
      : index;
    steps.push({ name: 'reach', status: 'fail', summary: `Could not read the REST API at ${baseUrl}/wp-json/.`, hint: why(effective) });
    steps.push(skipped('authenticate', 'the site could not be reached'), skipped('bridge', 'the site could not be reached'));
    return finish();
  } else {
    const advertised = Object.keys(index.json.authentication ?? {});
    if (advertised.includes('application-passwords')) {
      steps.push({ name: 'reach', status: 'ok', summary: `WordPress "${index.json.name ?? 'site'}" answers at ${baseUrl}/wp-json/.` });
    } else {
      steps.push({
        name: 'reach',
        status: 'warn',
        summary: `WordPress "${index.json.name ?? 'site'}" answers at ${baseUrl}/wp-json/.`,
        hint: 'The site does not advertise application passwords. They need HTTPS (or a local development environment) and must not be disabled by a plugin; authentication may fail.',
      });
    }
  }

  // 3. do the credentials work?
  const me = await request(`${baseUrl}/wp-json/wp/v2/users/me?context=edit&_fields=id,slug,roles`, timeoutMs, authorization);
  if (me.kind !== 'response' || me.status !== 200 || !me.json?.slug) {
    steps.push({ name: 'authenticate', status: 'fail', summary: `The site did not accept ${username}'s credentials.`, hint: why(me) });
    steps.push(skipped('bridge', 'authentication failed'));
    return finish();
  }
  steps.push({ name: 'authenticate', status: 'ok', summary: `Authenticated as ${me.json.slug}${Array.isArray(me.json.roles) ? ` (${me.json.roles.join(', ')})` : ''}.` });

  // 4. is the bridge there, and what does it allow?
  const status = await request(`${baseUrl}/wp-json/agent/v1/status`, timeoutMs, authorization);
  if (status.kind === 'response' && status.status === 200 && status.json?.ok && status.json.data) {
    const b = status.json.data as BridgeStatus;
    const f = b.features ?? {};
    steps.push({
      name: 'bridge',
      status: 'ok',
      summary: `php-agent-bridge ${b.bridge?.version} (${b.bridge?.routes} routes) on WordPress ${b.wordpress?.version}, PHP ${b.php?.version}. File writes ${f.file_write ? 'ON' : 'off'}${f.file_edit_blocked ? ' (blocked by DISALLOW_FILE_EDIT/MODS)' : ''}.`,
      ...(f.file_write && f.php_verification === false ? { hint: 'PHP writes will be refused: this host cannot run php or proc_open, which the bridge needs to verify PHP before saving it.' } : {}),
    });
    return finish(b);
  }

  if (status.kind === 'response' && (status.status === 401 || status.status === 403)) {
    const needsAdmin = status.status === 403 || status.json?.code === 'insufficient_capability';
    steps.push({
      name: 'bridge',
      status: 'fail',
      summary: `The bridge refused ${username}.`,
      hint: needsAdmin ? 'The bridge needs an administrator (the manage_options capability). Use an administrator account.' : why(status),
    });
    return finish();
  }

  if (status.kind === 'response' && status.status === 404) {
    // Perhaps an older bridge without /status: does the rest of the API answer?
    const schema = await request(`${baseUrl}/wp-json/agent/v1/options/schema`, timeoutMs, authorization);
    const older = await request(`${baseUrl}/wp-json/agent/v1/options`, timeoutMs, authorization);
    for (const probe of [schema, older]) {
      if (probe.kind === 'response' && probe.status === 200 && probe.json?.ok) {
        steps.push({
          name: 'bridge',
          status: 'warn',
          summary: 'An older php-agent-bridge is installed (it has no status endpoint), so its version and enabled features cannot be reported.',
          hint: 'Update the plugin to see what it allows on this site.',
        });
        return finish();
      }
    }
    steps.push({
      name: 'bridge',
      status: 'fail',
      summary: 'The php-agent-bridge plugin was not found on this site.',
      hint: 'Install and activate the php-agent-bridge plugin, or check that WP_BASE_URL points at the right site.',
    });
    return finish();
  }

  steps.push({ name: 'bridge', status: 'fail', summary: 'The bridge status could not be read.', hint: why(status) });
  return finish();
}

const MARK: Record<StepStatus, string> = { ok: '[ OK ]', warn: '[WARN]', fail: '[FAIL]', skipped: '[ -- ]' };

export function format_report(report: Report): string {
  const lines = [`wp-agent-mcp self-check for ${report.target || '(no URL)'}`, ''];
  for (const s of report.steps) {
    lines.push(`  ${MARK[s.status]}  ${s.name.padEnd(13)} ${s.summary}`);
    if (s.hint) lines.push(`${' '.repeat(24)}→ ${s.hint}`);
  }
  lines.push('');
  if (report.bridge) {
    const f = report.bridge.features;
    lines.push(
      `  Bridge on this site: file writes ${f.file_write ? 'ON' : 'off'}, WP-CLI ${f.cli?.mode ?? '?'}, database API ${f.db_api ? 'ON' : 'off'}, ` +
        `PHP verification ${f.php_verification === false ? 'UNAVAILABLE' : 'available'}, option groups: ${(f.option_groups ?? []).join(', ') || 'none'}.`,
      '',
    );
  }
  lines.push(
    report.ok
      ? 'Result: OK — everything needed is working; the MCP server is ready to use with these settings.'
      : `Result: FAILED — ${report.problems.length} problem${report.problems.length === 1 ? '' : 's'} above. Fix the first one and run the check again.`,
  );
  return lines.join('\n');
}
