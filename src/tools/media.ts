import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BridgeClient } from '../client.js';
import { tool_success, handle_tool_error } from '../types.js';

const SourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('url'), url: z.string().url() }),
  z.object({
    type: z.literal('base64'),
    data: z.string(),
    mime_type: z.string(),
    filename: z.string(),
  }),
]);

async function resolve_source(
  source: z.infer<typeof SourceSchema>,
  client: BridgeClient,
  path: string,
  meta?: Record<string, string>,
): Promise<unknown> {
  if (source.type === 'url') {
    const res = await fetch(source.url);
    if (!res.ok) throw new Error(`Failed to fetch ${source.url}: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get('content-type') ?? 'application/octet-stream';
    const filename = source.url.split('/').pop()?.split('?')[0] ?? 'upload';
    return client.upload_media(path, buf, mime, filename, meta);
  } else {
    const body: Record<string, unknown> = {
      filename: source.filename,
      data: source.data,
      mime_type: source.mime_type,
      ...meta,
    };
    return client.upload_media_base64(path, body);
  }
}

export function register(server: McpServer, client: BridgeClient): void {

  server.tool(
    'media_list',
    'List media attachments with optional filtering.',
    {
      mime_type: z.string().optional().describe('e.g. image/jpeg, application/pdf'),
      search: z.string().optional(),
      post_parent: z.number().int().optional().describe('Filter by parent post ID'),
      per_page: z.number().int().max(100).default(20),
      page: z.number().int().default(1),
    },
    { readOnlyHint: true },
    async (input) => {
      try {
        const params: Record<string, string> = {
          per_page: String(input.per_page),
          page: String(input.page),
        };
        if (input.mime_type) params.mime_type = input.mime_type;
        if (input.search) params.search = input.search;
        if (input.post_parent !== undefined) params.parent_post = String(input.post_parent);
        const data = await client.get('/media', params);
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'media_get',
    'Get full attachment details including all registered image sizes.',
    {
      id: z.number().int().positive(),
    },
    { readOnlyHint: true },
    async (input) => {
      try {
        const [detail, sizes] = await Promise.all([
          client.get(`/media/${input.id}`),
          client.get(`/media/${input.id}/sizes`),
        ]);
        return tool_success({ ...(detail as object), sizes });
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'media_upload',
    'Upload a new file from a URL or base64 data.',
    {
      source: SourceSchema,
      alt: z.string().optional(),
      caption: z.string().optional(),
      description: z.string().optional(),
      post_parent: z.number().int().optional(),
    },
    async (input) => {
      try {
        const meta: Record<string, string> = {};
        if (input.alt) meta.alt = input.alt;
        if (input.caption) meta.caption = input.caption;
        if (input.description) meta.description = input.description;
        if (input.post_parent !== undefined) meta.post_parent = String(input.post_parent);
        const data = await resolve_source(input.source, client, '/media/upload', meta);
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'media_update',
    'Update attachment metadata (alt, caption, description, title) without changing the file.',
    {
      id: z.number().int().positive(),
      alt: z.string().optional(),
      caption: z.string().optional(),
      description: z.string().optional(),
      title: z.string().optional(),
    },
    async (input) => {
      try {
        const { id, ...body } = input;
        const data = await client.patch(`/media/${id}`, body);
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'media_replace',
    'Replace the physical file for an existing attachment. The attachment ID and all post references are preserved. New thumbnail sizes are regenerated automatically.',
    {
      id: z.number().int().positive(),
      source: SourceSchema,
      alt: z.string().optional(),
      caption: z.string().optional(),
    },
    { destructiveHint: true },
    async (input) => {
      try {
        const meta: Record<string, string> = {};
        if (input.alt) meta.alt = input.alt;
        if (input.caption) meta.caption = input.caption;
        const data = await resolve_source(input.source, client, `/media/${input.id}/replace`, meta);
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'media_regenerate_sizes',
    'Trigger thumbnail regeneration without replacing the file.',
    {
      id: z.number().int().positive(),
    },
    async (input) => {
      try {
        const data = await client.post(`/media/${input.id}/regenerate`, {});
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );

  server.tool(
    'media_delete',
    'Permanently delete an attachment file and all generated sizes. Cannot be undone.',
    {
      id: z.number().int().positive(),
    },
    { destructiveHint: true },
    async (input) => {
      try {
        const data = await client.delete(`/media/${input.id}`, { force: 'true' });
        return tool_success(data);
      } catch (err) {
        return handle_tool_error(err);
      }
    },
  );
}
