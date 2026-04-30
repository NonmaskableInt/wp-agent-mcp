#!/usr/bin/env bash
set -euo pipefail

# wp-agent-mcp — First-time setup
# Usage: ./setup.sh

echo "=== wp-agent-mcp Setup ==="
echo ""

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "Error: Node.js is required (v20+). https://nodejs.org"; exit 1; }
command -v npm >/dev/null 2>&1  || { echo "Error: npm is required. It ships with Node.js."; exit 1; }

NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Error: Node.js 20 or higher is required (found v$(node -v | tr -d 'v'))."
  exit 1
fi

echo "Node.js $(node -v) detected."

# Environment
if [ ! -f .env ]; then
  cp .env.example .env
  echo ""
  echo "Created .env from .env.example."
  echo "  --> Edit .env and fill in WP_BASE_URL, WP_USERNAME, and WP_APP_PASSWORD before running the server."
else
  echo ".env already exists — skipping."
fi

# Dependencies
echo ""
echo "Installing dependencies..."
npm install

# Build
echo ""
echo "Building TypeScript..."
npm run build

echo ""
echo "=== Setup complete! ==="
echo ""
echo "Next steps:"
echo "  1. Edit .env with your WordPress site URL and credentials"
echo "  2. Run:  npm run dev            (development, hot-reload)"
echo "  3. Run:  node dist/index.js     (production, stdio transport)"
echo "  4. Run:  npm run inspect        (open MCP Inspector UI)"
echo ""
echo "Claude Code users: CLAUDE.md has all commands and architecture context."
echo "Claude Desktop users: see README.md for the mcpServers config snippet."
