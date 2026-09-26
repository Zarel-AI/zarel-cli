# AGENTS.md — zarel CLI

Command-line interface for the Zarel (Zarel) API.
Built on `commander` + `@zarel-ai/sdk`.

## Faithful layer rule

This package is a **faithful 1-to-1 CLI layer over `@zarel-ai/sdk`**. Each subcommand maps to exactly one method on the SDK surface. The CLI does only:

- argument parsing (string → typed value);
- token / tenant / base-URL resolution (`ZAREL_TOKEN` env → `~/.zarel/config.json`);
- output formatting (`--format table|json|yaml`);
- error mapping (`ZarelAPIError` / `ZarelAuthError` / `ZarelTimeoutError` → exit codes).

If `@zarel-ai/sdk` doesn't have a method for it, this CLI shouldn't do it either.

**Forbidden:**

1. **No multi-step orchestration.** Sequencing two SDK calls into one command, batch fan-outs, "create-then-link" macros — that belongs upstream (in the user's script, in `apps/*`, or as a dedicated SDK helper). The CLI exposes primitives, not pipelines.
2. **No imports of the platform SDK, or of any package that is not published.** Operator-class commands — tenant lifecycle, resource limits, job replay — belong to a separate, private tool and must never reach this one. Everything `zarel` depends on has to be installable by anyone who installs `zarel`.
3. **No accounts-domain or platform-domain knowledge in command modules.** `accounts` is just another tenant from the SDK's perspective — never hardcode entity names like `plans` / `clients` / `users` in command logic. Generic `records`/`entities`/etc. commands handle them uniformly.

## Architecture

- **`commands/`** — One module per resource (conversation, tools, records, transitions, workflows, entities, contracts, config, imports)
- **`config.ts`** — `~/.zarel/config.json` reader/writer
- **`auth.ts`** — Token resolution: `ZAREL_TOKEN` env → config file → error
- **`parsers/`** — Shared CLI input parsing helpers for JSON, key/value pairs, numbers, and output formats
- **`formatters/`** — Output formatters: table (default), json, yaml
- **`printers/`** — stdout/stderr/output printers that render formatter output
- **`client.ts`** — SDK client factory using resolved auth + config

## Layer

Standalone package. Single runtime dependency: `commander`.
Uses `@zarel-ai/sdk` (workspace link).

## Key Rules

- Exit codes: 0 success, 1 API error, 2 usage error
- Pipe-friendly: no color when stdout is not a TTY
- `--format table|json|yaml` on all list/get commands
- Config file: `~/.zarel/config.json` (token, tenant, baseUrl)
- Env vars override config file values

## Testing

```bash
npm test
```
