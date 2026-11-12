export interface EnvValues {
  baseUrl: string;
  username: string;
  appPassword: string;
}

export interface EnvResult {
  /** Human-readable problems; empty when the configuration is usable. */
  problems: string[];
  /** Things that were quietly corrected (whitespace, surrounding quotes). */
  notes: string[];
  values?: EnvValues;
}

const DESCRIPTIONS: Record<string, string> = {
  WP_BASE_URL: 'the site address, e.g. https://example.com',
  WP_USERNAME: 'the WordPress username that owns the application password',
  WP_APP_PASSWORD: 'an application password (Users → Profile → Application Passwords), not the login password',
};

/** Trim, and drop one pair of matching surrounding quotes (a common copy/paste slip in JSON or .env files). */
function clean(name: string, raw: string | undefined, notes: string[]): string {
  let v = (raw ?? '').trim();
  const quoted = v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0];
  if (quoted) {
    v = v.slice(1, -1).trim();
    notes.push(`${name}: removed surrounding quote characters (they are not part of the value)`);
  }
  return v;
}

export function validate_env(env: Record<string, string | undefined>): EnvResult {
  const problems: string[] = [];
  const notes: string[] = [];

  const baseUrl = clean('WP_BASE_URL', env.WP_BASE_URL, notes);
  const username = clean('WP_USERNAME', env.WP_USERNAME, notes);
  const appPassword = clean('WP_APP_PASSWORD', env.WP_APP_PASSWORD, notes);

  for (const [name, value] of [['WP_BASE_URL', baseUrl], ['WP_USERNAME', username], ['WP_APP_PASSWORD', appPassword]] as const) {
    if (!value) problems.push(`Missing ${name}: ${DESCRIPTIONS[name]}.`);
  }

  let normalised = baseUrl;
  if (baseUrl) {
    let url: URL | undefined;
    try {
      url = /^https?:\/\//i.test(baseUrl) ? new URL(baseUrl) : undefined;
    } catch {
      url = undefined;
    }
    if (!url) {
      problems.push(`WP_BASE_URL "${baseUrl}" must start with http:// or https:// (e.g. https://example.com).`);
    } else if (url.username || url.password) {
      problems.push('WP_BASE_URL must not contain credentials; put them in WP_USERNAME and WP_APP_PASSWORD.');
    } else if (/\/wp-json(\/|$)/i.test(url.pathname)) {
      problems.push('WP_BASE_URL should be the site address only; remove "/wp-json…" (the server adds the API path itself).');
    } else {
      normalised = `${url.origin}${url.pathname}`.replace(/\/+$/, '');
    }
  }

  if (problems.length) return { problems, notes };
  return { problems, notes, values: { baseUrl: normalised, username, appPassword } };
}

/** Why a client that "has the file" can still start with nothing configured, and how to fix it. */
export function config_help(problems: string[]): string {
  return [
    'wp-agent-mcp cannot start: the configuration is incomplete.',
    '',
    ...problems.map((p) => `  - ${p}`),
    '',
    'An MCP client does NOT read a .env file for you. Put the three settings in the "env" block of this',
    'server\'s entry in your MCP client\'s configuration, for example:',
    '',
    '  "env": {',
    '    "WP_BASE_URL": "https://example.com",',
    '    "WP_USERNAME": "your-username",',
    '    "WP_APP_PASSWORD": "<application password>"',
    '  }',
    '',
    '(A .env file in the server\'s working directory is also read when you run it from a terminal.)',
    'To test your settings without an MCP client, run:  node dist/index.js --check',
  ].join('\n');
}
