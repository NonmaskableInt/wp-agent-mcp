import 'dotenv/config';

function require_env(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

export const config = {
  wp: {
    baseUrl: require_env('WP_BASE_URL').replace(/\/$/, ''),
    username: require_env('WP_USERNAME'),
    appPassword: require_env('WP_APP_PASSWORD'),
  },
  transport: (process.env.MCP_TRANSPORT ?? 'stdio') as 'stdio' | 'http',
  httpPort: Number(process.env.MCP_HTTP_PORT ?? 3456),
  logLevel: (process.env.LOG_LEVEL ?? 'info') as 'debug' | 'info' | 'warn' | 'error',
};
