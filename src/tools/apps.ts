import { lstat, readdir, readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { zipSync } from 'fflate';
import { z } from 'zod';
import { BridgeClient } from '../client.js';
import { tool_success, tool_error, handle_tool_error } from '../types.js';

const MAX_ZIP_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 5000;
const MAX_RAW_BYTES = 50 * 1024 * 1024;

const real = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    throw new Error(`Directory does not exist: ${p}`);
  }
};

/**
 * Confines build_dir to an allowed root so an agent (or an injected prompt) cannot publish
 * arbitrary local files to a public website. The root is WP_MCP_BUILD_ROOT, or the current
 * working directory when unset. Symlinks are resolved first, so a link pointing out is refused.
 * Returns the resolved directory.
 */
export function resolve_build_dir(dir: string, root_setting: string | undefined = process.env.WP_MCP_BUILD_ROOT): string {
  const root = real(resolve(root_setting ?? process.cwd()));
  const home = real(homedir());
  const fix = 'Set WP_MCP_BUILD_ROOT to the project directory that holds your build output.';

  if (root === parse(root).root || root === home) {
    throw new Error(`The allowed build root is ${root}, which is too broad to publish from. ${fix}`);
  }

  const outside = (path: string) => {
    const rel = relative(root, path);
    return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  };
  const refuse = (path: string) => new Error(`${path} is outside the allowed build root ${root}. ${fix}`);

  // Lexical check first: refuse without probing the filesystem, so a path outside the jail
  // cannot be used to learn what exists there.
  const wanted = isAbsolute(dir) ? resolve(dir) : resolve(root, dir);
  if (outside(wanted)) throw refuse(wanted);

  // Then resolve symlinks and check again: a link inside the root must not lead out of it.
  const target = real(wanted);
  if (target === parse(target).root || target === home) {
    throw new Error(`Publishing ${target} is not allowed. ${fix}`);
  }
  if (outside(target)) throw refuse(target);
  return target;
}

export interface ZipResult {
  data: Buffer;
  files: string[];
}

/** Zips a local build directory (e.g. dist/). Skips hidden files; refuses symlinks; enforces size limits up front. */
export async function zip_directory(
  dir: string,
  limits: { max_files?: number; max_bytes?: number } = {},
): Promise<ZipResult> {
  const max_files = limits.max_files ?? MAX_FILES;
  const max_bytes = limits.max_bytes ?? MAX_RAW_BYTES;
  const root = resolve(dir);
  const found: Array<{ rel: string; full: string }> = [];
  let total = 0;

  // Walk and stat first; nothing is read until the whole tree is known to be within limits.
  async function walk(current: string): Promise<void> {
    for (const entry of await readdir(current)) {
      if (entry.startsWith('.')) continue;
      const full = join(current, entry);
      const st = await lstat(full);
      if (st.isSymbolicLink()) throw new Error(`Symlink not allowed in build output: ${relative(root, full)}`);
      if (st.isDirectory()) {
        await walk(full);
      } else if (st.isFile()) {
        if (found.length + 1 > max_files) throw new Error(`Build output has more than ${max_files} files.`);
        total += st.size;
        if (total > max_bytes) throw new Error(`Build output is larger than ${max_bytes} bytes.`);
        found.push({ rel: relative(root, full).split(sep).join('/'), full });
      }
    }
  }
  await walk(root);

  if (!found.length) throw new Error(`No files found in ${root}`);
  const files: Record<string, Uint8Array> = {};
  for (const f of found) files[f.rel] = new Uint8Array(await readFile(f.full));

  const data = Buffer.from(zipSync(files, { level: 6 }));
  if (data.length > MAX_ZIP_BYTES) {
    throw new Error(`Bundle is ${data.length} bytes zipped; the limit is ${MAX_ZIP_BYTES}.`);
  }
  return { data, files: found.map((f) => f.rel) };
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
      build_dir: z.string().optional().describe('Local build output directory to zip and upload. Must be inside WP_MCP_BUILD_ROOT (default: the current working directory); hidden files are skipped.'),
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
        let uploaded: { source: string; file_count: number; files: string[] } | undefined;
        if (input.build_dir) {
          const source = resolve_build_dir(input.build_dir);
          const zipped = await zip_directory(source);
          archive_base64 = zipped.data.toString('base64');
          // Tell the agent exactly what left this machine.
          uploaded = { source, file_count: zipped.files.length, files: zipped.files.slice(0, 100) };
        }
        const data = await client.post('/apps/deploy', {
          slug: input.slug,
          mount: input.mount,
          spa: input.spa,
          allow_root: input.allow_root,
          archive_base64,
        });
        return tool_success(uploaded ? { ...(data as object), uploaded } : data);
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
