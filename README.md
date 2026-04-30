# wp-agent-mcp

MCP server for WordPress — gives AI agents full control over posts, media, plugins, themes, users, menus, and WP-CLI via a PHP bridge plugin.

Connect any MCP-compatible AI client (Claude Desktop, Claude Code, Cursor, or any custom agent) to a live WordPress site and let it read, write, and administer content through a clean, schema-validated tool interface.

## Features

- **Posts and pages** — list, get, create, update, delete, duplicate; supports custom post types, ACF fields, scheduled publishing
- **Media** — upload from URL or base64, update metadata, replace files, regenerate thumbnail sizes
- **Plugins** — list, install, activate, deactivate, update, delete, read/write allowlisted options
- **Themes** — list, install, activate, update, delete, read/write theme mods, export/import customizer settings
- **Menus** — list menus, get with full item tree, add/update/delete items
- **Taxonomy** — list, create, update, and delete terms across any registered taxonomy
- **Options** — get and set allowlisted WordPress site options
- **Users** — list and get users by ID or current authenticated user
- **WP-CLI** — run allowlisted WP-CLI commands safely (no shell interpolation)
- **Database** — run SELECT queries and optionally INSERT/UPDATE/DELETE via prepared statements
- **Dual transport** — stdio (default, for desktop clients) or streamable HTTP

## Prerequisites

- **Node.js 20+** and npm
- **WordPress site** with the [php-agent-bridge](https://github.com/NonmaskableInt/php-agent-bridge) plugin installed and activated
- A WordPress **Application Password** for the agent user (Admin panel: Users > Your Profile > Application Passwords)

## Installation

```bash
git clone https://github.com/NonmaskableInt/wp-agent-mcp.git
cd wp-agent-mcp
./setup.sh
```

`setup.sh` checks prerequisites, installs dependencies, compiles TypeScript, and creates `.env` from `.env.example`.

### Manual setup

```bash
npm install
npm run build
cp .env.example .env
```

## Configuration

Edit `.env` with your WordPress credentials:

```bash
WP_BASE_URL=https://yoursite.com
WP_USERNAME=agent-user
WP_APP_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx
MCP_TRANSPORT=stdio
MCP_HTTP_PORT=3456
LOG_LEVEL=info
```

| Variable | Required | Description |
|----------|----------|-------------|
| `WP_BASE_URL` | Yes | WordPress site URL (no trailing slash) |
| `WP_USERNAME` | Yes | WordPress username for the agent account |
| `WP_APP_PASSWORD` | Yes | WordPress Application Password |
| `MCP_TRANSPORT` | No | `stdio` (default) or `http` |
| `MCP_HTTP_PORT` | No | HTTP listen port (default: `3456`) |
| `LOG_LEVEL` | No | `debug`, `info`, `warn`, or `error` (default: `info`) |

### Creating a WordPress Application Password

1. Log in to WordPress admin
2. Go to **Users > Your Profile**
3. Scroll to **Application Passwords**
4. Enter a name (e.g., `agent`) and click **Add New Application Password**
5. Copy the generated password into `WP_APP_PASSWORD` in `.env`

## Usage with Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "wordpress": {
      "command": "node",
      "args": ["/absolute/path/to/wp-agent-mcp/dist/index.js"],
      "env": {
        "WP_BASE_URL": "https://yoursite.com",
        "WP_USERNAME": "agent-user",
        "WP_APP_PASSWORD": "xxxx xxxx xxxx xxxx xxxx xxxx"
      }
    }
  }
}
```

Restart Claude Desktop. The WordPress tools will appear in the tool picker.

The config file location:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

## Usage with Claude Code

```bash
claude mcp add wordpress -- node /absolute/path/to/wp-agent-mcp/dist/index.js
```

Or add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "wordpress": {
      "command": "node",
      "args": ["dist/index.js"],
      "env": {
        "WP_BASE_URL": "https://yoursite.com",
        "WP_USERNAME": "agent-user",
        "WP_APP_PASSWORD": "xxxx xxxx xxxx xxxx xxxx xxxx"
      }
    }
  }
}
```

## HTTP Transport

For remote agents or multi-client setups:

```bash
MCP_TRANSPORT=http MCP_HTTP_PORT=3456 node dist/index.js
```

The server will accept MCP connections on `http://localhost:3456`.

## Available Tools

### Posts

| Tool | Description |
|------|-------------|
| `post_list` | List posts with filtering by type, status, category, tag, search |
| `post_get` | Get a single post with full content, meta, ACF fields, and terms |
| `post_upsert` | Create or update a post; supports scheduling, ACF, custom meta |
| `post_delete` | Move to trash or permanently delete |
| `post_duplicate` | Clone a post as a new draft, preserving all meta and terms |

### Media

| Tool | Description |
|------|-------------|
| `media_list` | List attachments with mime type and search filtering |
| `media_get` | Get attachment details including all registered image sizes |
| `media_upload` | Upload a file from a URL or base64-encoded data |
| `media_update` | Update alt text, caption, description, or title |
| `media_replace` | Replace the physical file while preserving the attachment ID |
| `media_regenerate_sizes` | Regenerate thumbnail sizes without replacing the file |
| `media_delete` | Permanently delete an attachment and all generated sizes |

### Plugins

| Tool | Description |
|------|-------------|
| `plugin_list` | List installed plugins by status |
| `plugin_get` | Get full details for a plugin |
| `plugin_install` | Install from wordpress.org or a zip URL |
| `plugin_activate` | Activate a plugin |
| `plugin_deactivate` | Deactivate a plugin |
| `plugin_update` | Update to the latest version |
| `plugin_delete` | Delete plugin files (must be inactive first) |
| `plugin_options_get` | Read allowlisted plugin options |
| `plugin_options_set` | Write allowlisted plugin options |

### Themes

| Tool | Description |
|------|-------------|
| `theme_list` | List installed themes |
| `theme_get` | Get full theme details |
| `theme_install` | Install from wordpress.org or a zip URL |
| `theme_activate` | Switch active theme |
| `theme_update` | Update to the latest version |
| `theme_delete` | Delete theme files (active theme is protected) |
| `theme_mods_get` | Get customizer theme mods |
| `theme_mods_set` | Update customizer theme mods |
| `customizer_export` | Export all customizer settings as a portable JSON blob |
| `customizer_import` | Import customizer settings from an export blob |

### Menus

| Tool | Description |
|------|-------------|
| `menu_list` | List all nav menus with their assigned theme locations |
| `menu_get` | Get a menu with full nested item tree |
| `menu_item_add` | Add an item to a nav menu |
| `menu_item_update` | Update or reorder a nav menu item |
| `menu_item_delete` | Remove an item from a nav menu |

### Taxonomy

| Tool | Description |
|------|-------------|
| `term_list` | List terms in any registered taxonomy |
| `term_create` | Create a new taxonomy term |
| `term_update` | Update an existing taxonomy term |
| `term_delete` | Delete a taxonomy term |

### Options

| Tool | Description |
|------|-------------|
| `option_get` | Get one or more WordPress options by key |
| `option_set` | Set one or more allowlisted WordPress options |

### Users

| Tool | Description |
|------|-------------|
| `user_list` | List users, filterable by role |
| `user_get` | Get a user by ID, or pass `"me"` for the current API user |

### WP-CLI

| Tool | Description |
|------|-------------|
| `wp_cli_run` | Run an allowlisted WP-CLI command (no shell interpolation) |

### Database

| Tool | Description |
|------|-------------|
| `db_list_tables` | List all database tables |
| `db_get_schema` | Inspect columns and indexes for a table |
| `db_select` | Run a SELECT/SHOW/EXPLAIN query with prepared statements |
| `db_query` | Run INSERT/UPDATE/DELETE with prepared statements |

## Development

```bash
npm run dev       # Start with hot reload (tsx watch)
npm run build     # Compile TypeScript to dist/
npm run inspect   # Open MCP Inspector against the built server
npm test          # Run tests with vitest
```

See [CLAUDE.md](CLAUDE.md) for full architecture context, key file descriptions, and copy-pasteable commands.

## PHP Bridge Plugin

This server requires the [php-agent-bridge](https://github.com/NonmaskableInt/php-agent-bridge) WordPress plugin. Install it on your WordPress site to expose the REST API endpoints that this MCP server calls.

See `endpoints.md` for the complete REST API reference including all routes, request/response schemas, capability requirements, and bridge configuration constants.

## Using with Claude Code

This project includes a `CLAUDE.md` that gives Claude Code full context about the codebase, architecture, and available commands.

```bash
claude    # Start Claude Code — reads CLAUDE.md automatically
```

## License

MIT — see [LICENSE](LICENSE)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md)
