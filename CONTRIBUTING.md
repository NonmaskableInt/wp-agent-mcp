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

## Tests and CI

```bash
npm test          # typecheck-free unit tests; the contract tests skip without a WordPress
npx tsc --noEmit  # typecheck
```

The **contract tests** drive the real MCP tools against a real WordPress with the
[php-agent-bridge](https://github.com/NonmaskableInt/php-agent-bridge) plugin. With `podman` or `docker`
installed, one command builds a throwaway stack, runs them, and removes it:

```bash
../php-agent-bridge/dev/run-contract-tests.sh .
```

Pull requests run CI automatically: typecheck, build and unit tests on Node 20 and 22, then the contract
tests against the php-agent-bridge branch **with the same name as yours** while that branch has an open PR (so a change
spanning both repos is tested together), otherwise against its `main`. (A merged branch that still exists is ignored on
purpose: it is stale.)
