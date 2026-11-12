import 'dotenv/config';
import { format_report, run_diagnostics } from './diagnostics.js';
import { config_help, validate_env } from './env.js';

/** `node dist/index.js --check`: diagnose a setup from the command line, no MCP client needed. */
export async function run_check(): Promise<number> {
  const env = validate_env(process.env);
  if (!env.values) {
    process.stdout.write(config_help(env.problems) + '\n');
    return 1;
  }
  const report = await run_diagnostics(env.values);
  process.stdout.write(format_report(report) + '\n');
  return report.ok ? 0 : 1;
}
