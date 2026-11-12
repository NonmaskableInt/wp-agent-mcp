import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { zipSync } from 'fflate';
import { z } from 'zod';
import { BridgeClient } from '../client.js';
import { tool_success, tool_error, handle_tool_error } from '../types.js';

const MAX_ZIP_BYTES = 20 * 1024 * 1024;

/** Zips a local build directory (e.g. dist/). Skips hidden files; refuses symlinks. */
export async function zip_directory(dir: string): Promise<Buffer> {
  const root = resolve(dir);
  const files: Record<string, Uint8Array> = {};

  async function walk(current: string): Promise<void> {
    for (const entry of await readdir(current)) {
      if (entry.startsWith('.')) continue;
      const full = join(current, entry);
      const st = await lstat(full);
      if (st.isSymbolicLink()) throw new Error(`Symlink not allowed in build output: ${relative(root, full)}`);
      if (st.isDirectory()) await walk(full);
      else if (st.isFile()) files[relative(root, full).split(sep).join('/')] = new Uint8Array(await readFile(full));
    }
  }
  await walk(root);

  if (!Object.keys(files).length) throw new Error(`No files found in ${root}`);
  const zipped = Buffer.from(zipSync(files, { level: 6 }));
  if (zipped.length > MAX_ZIP_BYTES) {
    throw new Error(`Bundle is ${zipped.length} bytes zipped; the limit is ${MAX_ZIP_BYTES}.`);
  }
  return zipped;
}

export function register(server: McpServer, client: BridgeClient): void {

  server.tool(
    'app_deploy',
    'Deploy a built front-end app (React, Vue, static) and serve it at a mount path on the WordPress site. ' +
      'Provide build_dir (a local folder such as dist/, zipped for you) or archive_base64 (a prebuilt zip). ' +
      'Each deploy is a new immutable release that goes live atomically; roll back with app_rollback. ' +
      'Bundles may contain static assets only (no PHP). mount="/" replaces the whole front end and needs allow_root=true; ' +
      'wp-admin, wp-json and other WordPress paths are never intercepted. Requires AGENT_BRIDGE_ALLOW_FILE_WRITE.',
    {
      slug: z.string().describe('Lowercase id, e.g. "dashboard"'),
      mount: z.string().describe('URL path to serve at, e.g. "/app" or "/" (headless front end)'),
      build_dir: z.string().optional().describe('Local build output directory to zip and upload'),
      archive_base64: z.string().optional().describe('Prebuilt zip, base64-encoded (alternative to build_dir)'),
      spa: z.boolean().default(true).describe('Serve index.html for unknown extension-less paths (client-side routing)'),
      allow_root: z.boolean().default(false),
    },
    async (input) => {
      try {
        if (!!input.build_dir === !!input.archive_base64) {
          return tool_error('validation_error', 'Provide exactly one of build_dir or archive_base64.');
        }
        let archive_base64 = input.archive_base64;
        if (input.build_dir) {
          archive_base64 = (await zip_directory(input.build_dir)).toString('base64');
        }
        const data = await client.post('/apps/deploy', {
          slug: input.slug,
          mount: input.mount,
          spa: input.spa,
          allow_root: input.allow_root,
          archive_base64,
        });
        return tool_success(data);
      } catch (err) {
        if (err instanceof Error && err.name !== 'BridgeError') return tool_error('deploy_failed', err.message);
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'app_list',
    'List deployed apps with their mount path, URL and live release.',
    {},
    { readOnlyHint: true },
    async () => {
      try {
        return tool_success(await client.get('/apps'));
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'app_get',
    'Get one deployed app including all stored releases (newest first).',
    { slug: z.string() },
    { readOnlyHint: true },
    async (input) => {
      try {
        return tool_success(await client.get(`/apps/${encodeURIComponent(input.slug)}`));
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'app_rollback',
    'Make an earlier release live again (the one before the current release unless release_id is given). Instant; no rebuild.',
    { slug: z.string(), release_id: z.string().optional() },
    async (input) => {
      try {
        const body = input.release_id ? { release_id: input.release_id } : {};
        return tool_success(await client.post(`/apps/${encodeURIComponent(input.slug)}/rollback`, body));
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'app_delete',
    'Remove an app: its route stops serving first, then all releases are deleted.',
    { slug: z.string() },
    async (input) => {
      try {
        return tool_success(await client.delete(`/apps/${encodeURIComponent(input.slug)}`));
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );
}
