# Contributing to wp-agent-mcp

Thanks for your interest in contributing.

## Development setup

```bash
git clone https://github.com/NonmaskableInt/wp-agent-mcp.git
cd wp-agent-mcp
./setup.sh
# Edit .env with your WordPress credentials
npm run dev
```

## Adding a new tool

1. Create or extend a file in `src/tools/`.
2. Register the tool in `src/server.ts` following the existing pattern.
3. Run `npm run build` and verify with `npm run inspect`.

Each tool should use the `tool_success` / `tool_error` helpers from `src/types.ts` and accept a `BridgeClient` instance rather than instantiating its own.

## Pull requests

- Keep PRs focused — one feature or fix per PR.
- Run `npm run build` before submitting; the build must pass cleanly.
- If you're adding a tool, include the corresponding PHP bridge endpoint in `endpoints.md`.

## Reporting issues

Use the GitHub issue templates. For security vulnerabilities, please open a private advisory instead of a public issue.

## License

By contributing you agree that your contributions will be licensed under the MIT License.
