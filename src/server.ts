import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BridgeClient } from './client.js';
import { register as register_posts } from './tools/posts.js';
import { register as register_media } from './tools/media.js';
import { register as register_taxonomy } from './tools/taxonomy.js';
import { register as register_options } from './tools/options.js';
import { register as register_menus } from './tools/menus.js';
import { register as register_plugins } from './tools/plugins.js';
import { register as register_themes } from './tools/themes.js';
import { register as register_cli } from './tools/cli.js';
import { register as register_database } from './tools/database.js';
import { register as register_users } from './tools/users.js';

export function create_server(): McpServer {
  const server = new McpServer({
    name: 'wordpress-mcp',
    version: '1.0.0',
  });

  const client = new BridgeClient();

  register_posts(server, client);
  register_media(server, client);
  register_taxonomy(server, client);
  register_options(server, client);
  register_menus(server, client);
  register_plugins(server, client);
  register_themes(server, client);
  register_cli(server, client);
  register_database(server, client);
  register_users(server, client);

  return server;
}
