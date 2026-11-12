import 'dotenv/config';
import { config_help, validate_env } from './env.js';

const env = validate_env(process.env);
if (!env.values) {
  // Most MCP clients hide a server's stderr and just show "Connection closed", so say it clearly and exit.
  process.stderr.write(config_help(env.problems) + '\n');
  process.exit(1);
}
for (const note of env.notes) process.stderr.write(`[note] ${note}\n`);

export const config = {
  wp: {
    baseUrl: env.values.baseUrl,
    username: env.values.username,
    appPassword: env.values.appPassword,
  },
  transport: (process.env.MCP_TRANSPORT ?? 'stdio') as 'stdio' | 'http',
  httpPort: Number(process.env.MCP_HTTP_PORT ?? 3456),
  logLevel: (process.env.LOG_LEVEL ?? 'info') as 'debug' | 'info' | 'warn' | 'error',
};
