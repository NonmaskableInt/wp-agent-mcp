# wp-agent-mcp

**Version:** 1.0.0 | **Transport:** stdio (default) or HTTP port 3456 | **Stack:** TypeScript, Node 20+, MCP SDK

## What

MCP server that gives AI agents full control over a WordPress site — posts, media, plugins, themes, menus, taxonomy, options, users, and WP-CLI — via a companion PHP bridge plugin installed on the target WordPress site.

## Quick Start

```bash
./setup.sh              # Install deps, build, create .env
# Edit .env with your WordPress credentials
npm run dev             # Start dev server (tsx watch, no build step)
npm run inspect         # Open MCP Inspector UI against the built server
```

## Commands

```bash
# Development
npm install             # Install dependencies
npm run dev             # Start server with hot reload (tsx watch src/index.ts)
npm run build           # Compile TypeScript → dist/
npm run inspect         # Launch MCP Inspector against dist/index.js

# Testing
npm test                # Run tests with vitest

# Run the compiled server directly
node dist/index.js      # stdio transport (default)
MCP_TRANSPORT=http MCP_HTTP_PORT=3456 node dist/index.js   # HTTP transport
```

## Architecture

```
src/
  index.ts        Entry point — picks stdio or HTTP transport from MCP_TRANSPORT
  config.ts       Reads env vars; fails fast on missing required vars
  server.ts       Creates McpServer and registers all tool modules
  client.ts       BridgeClient — authenticated HTTP fetch with retry logic
  types.ts        BridgeEnvelope, BridgeError, tool_success/tool_error helpers
  tools/
    posts.ts      post_list, post_get, post_upsert, post_delete, post_duplicate
    media.ts      media_list, media_get, media_upload, media_update, media_replace,
                  media_regenerate_sizes, media_delete
    taxonomy.ts   term_list, term_create, term_update, term_delete
    options.ts    option_get, option_set
    menus.ts      menu_list, menu_get, menu_item_add, menu_item_update, menu_item_delete
    plugins.ts    plugin_list, plugin_get, plugin_install, plugin_activate,
                  plugin_deactivate, plugin_update, plugin_delete,
                  plugin_options_get, plugin_options_set
    themes.ts     theme_list, theme_get, theme_install, theme_activate,
                  theme_update, theme_delete, theme_mods_get, theme_mods_set,
                  customizer_export, customizer_import
    users.ts      user_list, user_get
    cli.ts        wp_cli_run
    database.ts   db_list_tables, db_get_schema, db_select, db_query
```

`BridgeClient` calls `{WP_BASE_URL}/wp-json/agent/v1/*` with HTTP Basic auth (WordPress Application Password). All responses use `{ ok, data }` / `{ ok, code, message }` envelopes. The client retries on 5xx up to 3 times with exponential backoff. POST/PATCH/DELETE requests include an `X-Idempotency-Key` UUID header for safe retries.

## Key Files

```
src/index.ts          Transport selection and startup
src/server.ts         Tool registration hub — add new tool files here
src/client.ts         All HTTP communication with the WordPress bridge
src/config.ts         Environment variable parsing and validation
src/types.ts          Shared types and tool result helpers
endpoints.md          Full PHP bridge REST API reference
.env.example          Required environment variables template
```

## Configuration

All configuration is via environment variables. Copy `.env.example` to `.env`:

| Variable | Required | Description |
|----------|----------|-------------|
| `WP_BASE_URL` | Yes | WordPress site URL, e.g. `https://yoursite.com` |
| `WP_USERNAME` | Yes | WordPress username for the agent account |
| `WP_APP_PASSWORD` | Yes | WordPress Application Password (Users > Profile > Application Passwords) |
| `MCP_TRANSPORT` | No | `stdio` (default) or `http` |
| `MCP_HTTP_PORT` | No | HTTP port when `MCP_TRANSPORT=http` (default: `3456`) |
| `LOG_LEVEL` | No | `debug`, `info` (default), `warn`, or `error` |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
