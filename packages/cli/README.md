# zarel — Zarel CLI

Command-line interface for the [Zarel](https://github.com/zarel-ai) (Zarel) API.
Built on [`@zarel-ai/sdk`](https://www.npmjs.com/package/@zarel-ai/sdk) and [`commander`](https://github.com/tj/commander.js).

## Installation

```bash
npm install -g @zarel-ai/cli
```

**The package is `@zarel-ai/cli`; the command is `zarel`.** Those are two different names and only
the first one appears in an install line — `bin` puts a `zarel` executable on your PATH regardless
of what the package is called, so every example below is what you actually type.

The unscoped name `zarel` is not available on npm: the registry refuses it as
*"too similar to existing packages babel, parcel"*, which is its typo-squatting guard and applies
to everyone rather than to this project. `npx @zarel-ai/cli` is the one place the scope shows.

## Quick Start

```bash
# Configure credentials (one token per plane)
zarel config set runtimeToken eyJhbGciOiJI...    # JWT class: tenant
zarel config set contractToken eyJhbGciOiJI...   # JWT class: contract
zarel config set tenant my_application           # tenant slug (application)

# Conversation with the cognitive agent (a session is created first)
zarel runtime conversation session create --scope runtime --channel cli
zarel runtime conversation send "Show my open tickets" --session-key <session_key>

# Approve a pending transition request
zarel runtime state-machine approve <id> --notes "Looks good"

# List entity records
zarel runtime records list tickets --format table

# Apply a YAML contract atomically
zarel contract spec diff ./contracts/support.yaml          # markdown diff vs deployed
zarel contract spec apply ./contracts/support.yaml --mode replace --require-no-breaking

# Reproduce a past dispatch
zarel runtime trace get trc_01J4Z000000000000000000000
zarel runtime trace bundle trc_01J4Z000000000000000000000 --output incident.tar.gz
zarel verify ./incident.tar.gz --keys ./trust-keys.json

# Quantify the impact of a contract change before shipping it
zarel contract spec dry-run ./contracts/support.candidate.yaml \
  --replay-window 30d --format markdown --watch

# Import tenant data
zarel runtime records bulk tickets --items '[{"data":{"title":"Bulk bug"}}]'
zarel runtime imports snapshot ./support.data.json
```

## Configuration

Config is stored in `~/.zarel/config.json`. Environment variables take precedence.

| Config Key | Env Variable | Description |
| ---------- | ------------ | ----------- |
| `runtimeToken` | `ZAREL_RUNTIME_TOKEN` | Runtime-plane JWT (`token_class: tenant`) |
| `contractToken` | `ZAREL_CONTRACT_TOKEN` | Contract-plane JWT (`token_class: contract`) |
| `tenant` | `ZAREL_TENANT` | Tenant slug (application) |
| `baseUrl` | `ZAREL_BASE_URL` | Runtime API base URL override |
| `contractBaseUrl` | `ZAREL_CONTRACT_API_URL` | Contract API base URL override (auto-derived from `baseUrl` when absent) |
| `locale` | `ZAREL_LOCALE` | Default locale for labels/descriptions |
| — | `ZAREL_API_VERSION` | Sends `X-Zarel-Api-Version: <value>` on every request (opt-in) |
| — | `ZAREL_DEBUG` | When set, logs each HTTP request/response (and retries) to **stderr** |

```bash
zarel config set <key> <value>
zarel config get <key>
zarel config delete <key>
zarel config list
```

### Debugging requests

Every request automatically carries a `User-Agent: @zarel-ai/sdk/<version>` header
and honours a server `Retry-After` on `429`/`503` — no flags needed. To see the
HTTP traffic, pass the global `--debug` flag (or set `ZAREL_DEBUG=1`); each attempt
is logged to stderr, so stdout stays clean for piping command output:

```bash
zarel --debug runtime records list plans
# → GET https://my_application.zarel.ai/v1/runtime/records/plans (attempt 0)
# ← 200 https://my_application.zarel.ai/v1/runtime/records/plans (attempt 0)
```

## Commands

Commands are organized by plane: `zarel runtime <resource> <verb>` and
`zarel contract <resource> <verb>`. Top-level commands that are plane-independent:
`config`, `trust-keys`, `verify`, `audit`, `receipts`.

### Conversation

```bash
# A send needs a session: `--session-key` is required, and a send without one is
# refused before a request is made.
zarel runtime conversation send "What are my pending tasks?" --session-key <session_key>
zarel runtime conversation clear

# Explicit conversation sessions (no lazy create) + per-turn LLM override
zarel runtime conversation session create --scope runtime --llm-service gemini-flash
zarel runtime conversation session get <session_key>
zarel runtime conversation session close <session_key>

zarel runtime conversation send "Approve ticket #42" \
  --session-key <session_key> \
  --llm-service claude-sonnet      # optional per-turn override

zarel runtime conversation sessions --limit 10 --channel api
zarel runtime conversation show <session_key>
zarel runtime conversation actions <session_key>
```

### Contract assistant

Conversational contract authoring on the contract plane. The conversation stages edits
into a single changeset; `changeset apply` is the **only** mutation and REQUIRES
`--base-hash` (deliberate out-of-band consent over a known base).

```bash
zarel contract assistant session create --llm-service primary
zarel contract assistant conversation send --session <key> --message "add an optional tier field to clients"
zarel contract assistant changeset get <changeset_id>          # status, base, diff, YAML
zarel contract assistant changeset apply <changeset_id> --base-hash v33 \
  [--reject-breaking] [--max-changes 20] [--force]             # one version bump
zarel contract assistant changeset discard <changeset_id>
```


### LLM service catalog

```bash
# Inspect the catalog you're authorized to use (actor-filtered; --scope required)
zarel runtime llm-service list --scope runtime
zarel runtime llm-service get gemini-flash --scope runtime
```

### LLM credentials (write-only on the wire)

```bash
# Set / rotate a credential — api_key is read from STDIN (TTY refused)
echo -n "$GEMINI_API_KEY" | zarel runtime llm-credential set gemini-flash --api-key-stdin

# Inspect masked metadata (api_key_masked = "••••<fingerprint>"; never plaintext)
zarel runtime llm-credential list
zarel runtime llm-credential get gemini-flash

# Remove (refused while sessions pinned to that service are active)
zarel runtime llm-credential unset gemini-flash
```

### Embedding credentials (write-only on the wire)

Keyed per `(tenant, provider)`. The secret is read from STDIN only (no flag).

```bash
# apiKey providers (gemini / openai / anthropic-via-Voyage)
echo -n "$OPENAI_API_KEY" | zarel runtime embedding-credential set openai --api-key-stdin

# Amazon Bedrock — AWS credential JSON on STDIN
echo -n '{"accessKeyId":"AKIA…","secretAccessKey":"…","region":"us-east-1"}' \
  | zarel runtime embedding-credential set bedrock --aws-stdin

# Inspect masked metadata (credential_masked = "••••<fingerprint>"; never the secret)
zarel runtime embedding-credential list
zarel runtime embedding-credential get openai

# Remove (soft-delete + sensitive wipe)
zarel runtime embedding-credential unset openai
```

### LLM authorization

The one authorization family the CLI manages directly. `--action` accepts only
`use` (the sole action in the `llm/services` family — it maps to SQL `USAGE`);
`--scope` names the plane the grant applies to, so a grant may be held on the
`contract` scope, the `runtime` scope, or both.

```bash
zarel contract auth-llm-service list --scope runtime [--service gemini-flash]
zarel contract auth-llm-service set --scope runtime --service gemini-flash --role customer --action use
zarel contract auth-llm-service unset --scope runtime --service gemini-flash --role customer --action use
```

> **Other authorization grants are not managed from the CLI.** The full
> path-addressed surface — config sections, `records/{entity}`, `flows/{flow}` —
> is reachable through `client.contract.authorization.*` in the SDK, the
> dashboard, or the YAML contract. Only this LLM-service family has a CLI
> command; the rest was never exposed here.

### Tools

```bash
zarel runtime tools list                          # Discover available tools
zarel runtime tools mcp list --format json        # List raw MCP tools
zarel runtime tools call create_tickets -p title="Bug report" -p priority=high
```

### MCP transport

Send one MCP JSON-RPC message to the tenant's MCP transport (`POST /runtime/mcp`)
and print the response. The message is read from `--message` or stdin.

```bash
zarel runtime mcp call --message '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | zarel runtime mcp call
```

### Records

```bash
zarel runtime records list tickets --limit 10 --format table
zarel runtime records list tickets --all --format json   # auto-paginate every page (--limit = page size)
zarel runtime records get tickets 42
zarel runtime records create tickets --data '{"title": "New bug", "priority": "high"}'
zarel runtime records bulk tickets --items '[{"data":{"title":"Bulk bug"}}]' --mode best_effort
zarel runtime records update tickets 42 --data '{"status": "resolved"}'
zarel runtime records delete tickets 42
```

### Events

`events tail` streams live tenant events (Server-Sent Events over
`GET /runtime/events/stream`) to the terminal — one event per line. It buffers
between the stream and the printer in a bounded ring (`--buffer-size`, default
1024); if you fall behind, the oldest events drop and a count is reported on
stderr. Press Ctrl-C to stop (the stream is torn down cleanly). The other
subcommands manage webhook subscriptions.

```bash
zarel runtime events tail                                   # stream live events until Ctrl-C
zarel runtime events tail --buffer-size 256 --format table  # bounded buffer; tabular output
zarel runtime events tail --last-event-id evt-42            # resume from a known SSE id
zarel runtime events tail --no-reconnect                    # stop on a transient disconnect

zarel runtime events subscribe -e app.requested -u https://example.com/hook
zarel runtime events list --format table
zarel runtime events delete <subscriptionId>
```

### State machine

```bash
# List state-machine events (filter by entity OR instance, exactly one selector required)
zarel runtime state-machine events --entity tickets
zarel runtime state-machine events --instance <uuid>

# Transition requests — pending list + resolution
zarel runtime state-machine pending --role credit_analyst
zarel runtime state-machine approve <id> --notes "Looks good"
zarel runtime state-machine reject <id> --notes "Insufficient justification"
```

### Actions

```bash
# Dispatch a YAML-declared action (entity-level — no record_id)
zarel runtime actions dispatch bulk_close_pending

# Dispatch a record-scoped action with payload
zarel runtime actions dispatch cancel_booking --record-id 42 --notes "customer asked" \
  --payload '{"reason": "billing dispute"}'

# Idempotency key (V1 wire-format pass-through)
zarel runtime actions dispatch place_order --payload '{"cart_id": 7}' \
  --idempotency-key "user-supplied-key"
```

### State machine replay

```bash
# Replay a state-machine instance against a new policy config
zarel runtime state-machine replay --instance <uuid> --config '{"field":"status","initial":"requested","transitions":[]}'
```

### Role assignments

```bash
zarel runtime role-assignments list
zarel runtime role-assignments create --user alice --role credit_analyst
zarel runtime role-assignments delete alice credit_analyst
```

### Entities

```bash
zarel contract entities list
zarel contract entities get tickets --format json
zarel contract entities create --name tasks --data '{"description": "Task entity"}'
zarel runtime entities recompute orders
```

### Spec (contract document)

`zarel contract spec apply` replaces `import` (mode-aware: `upsert` or
`replace` with optional optimistic concurrency via `--expected-hash`).
`zarel contract spec diff` emits a Markdown diff vs the deployed spec — exit
code 1 on differences per `git diff` convention so CI can gate on it.

```bash
# Read-only diff vs deployed spec (markdown default; JSON via --format json)
zarel contract spec diff ./contract.yaml

# Apply atomically with gating + optimistic concurrency
zarel contract spec snapshot --format json | jq -r .spec_hash > .deployed.hash
zarel contract spec apply ./contract.yaml \
  --mode replace \
  --expected-hash "$(cat .deployed.hash)" \
  --require-no-breaking

# Plan as ceiling: grants exceeding the plan envelope are
# STRIPPED (reported in stripped_grants[] + audited). When more than 10
# would be stripped the publish/apply fails 422 unless forced:
zarel contract spec apply ./contract.yaml --mode upsert --force

# Print the deployed contract snapshot
zarel contract spec snapshot --format yaml --output deployed.yaml
```

`zarel contract spec apply --mode upsert` replaces the deprecated
`zarel contracts import`.

### Authorization introspection

```bash
# Effective authorizations of the authenticated actor: roles (+ implicit
# `self`), manageable contract sections, runtime system actions, and
# per-entity record permissions — derived by the same resolvers the
# enforcement paths use. Self-scoped: no actor parameter exists.
zarel runtime authorizations effective
```

### Trace observability

Every conversation turn and action dispatch mints a `trace_id` (`trc_<26-char
ULID>`). An originator gate restricts visibility to the
trace's originator and superusers; everyone else sees a 404
indistinguishable from a genuine miss.

```bash
# Full chronology of one dispatch
zarel runtime trace get trc_01J4Z000000000000000000000

# Paginated query with filters
zarel runtime trace query --flow refund_request --outcome refused \
  --from 2026-04-01 --to 2026-04-30 --limit 50

# Auto-paginate every page across cursors (--limit = page size)
zarel runtime trace query --outcome refused --all --format json
```

### Trace replay and signed bundles

```bash
# Re-run deterministic governance stages against the proposed spec.
# Exit 1 on any divergence — useful in CI as a regression gate.
zarel runtime trace replay trc_01J4Z000000000000000000000 --against-current-spec

# Export a signed evidence bundle (Ed25519 over canonical JSON).
zarel runtime trace bundle trc_01J4Z000000000000000000000 --output incident.tar.gz

# Fetch the public trust-keys manifest for offline verification
zarel trust-keys fetch acme-prod.zarel.io --output ./trust-keys.json

# Verify a bundle without runtime access (signature + content hashes
# + optional replay attestation reproduction)
zarel verify ./incident.tar.gz --keys ./trust-keys.json
```

### Audit tamper-evidence bundles

`zarel verify` also verifies **audit evidence bundles** — a tenant's event-log
cryptographic hash-chain plus its signed checkpoints. It auto-detects an audit
bundle (the presence of `events.json`), recomputes the chain from the raw event
content, validates the checkpoint signatures against the published trust keys,
and reports any tampering at the exact sequence position. No runtime access is
needed — only the bundle and the operator's public key.

**External timestamp anchoring.** When the bundle carries
`anchors.json` (RFC 3161 TSA anchors over the checkpoints' Merkle roots), pass
`--tsa-roots <pinned-roots.pem>` to *also* verify anchoring offline. The verifier
rebuilds each anchored checkpoint's Merkle root, checks it against the
TSA-signed token (which must chain to a **pinned** root — never the OS trust
store), and reports the **anchored range vs. the un-anchored tail** with a
freshness note. The honest boundary: this proves **anti-backdating**
(checkpoints provably existed before the TSA-attested time) — *not*
unconditional anti-rewrite, content veracity, non-equivocation, or revocation.
Omitting `--tsa-roots` leaves the chain verdict unchanged and reports anchoring
as *"present but NOT verified"* (never silently anchored); a tampered anchor
exits non-zero.

```bash
# Pull an evidence bundle for a tenant's state-machine (or flows) hash-chain
# (gated by `view_traces`; → GET /runtime/audit/{log}/evidence, SDK
#  `client.runtime.audit.evidence('state_machine')`).
zarel audit evidence state_machine --output audit-evidence.tar.gz

# Bound a large log with an inclusive seq range (--from/--to). The server
# refuses an over-cap request with HTTP 413; narrow it with these flags.
zarel audit evidence flows --from 1 --to 50000 --output audit-evidence.tar.gz

# Verify offline. --keys is a trust-keys manifest JSON; --tsa-roots (optional) is
# a PEM of pinned RFC 3161 TSA roots to also verify external anchoring.
zarel verify ./audit-evidence.tar.gz --keys ./trust-keys.json --tsa-roots ./tsa-roots.pem

#   ✓ Audit chain ... verified and attested.   (covered seq + checkpoints verified)   → exit 0
#   ⚠ ... internally consistent but UNATTESTED  (chain valid, no checkpoint yet)        → exit 0
#   ✗ Audit chain verification FAILED           (e.g. "seq 42: event_hash_mismatch")    → exit 1
#   ✓ Anchored by an independent TSA through <genTime> ...  (with --tsa-roots)
#   ✗ Anchoring verification FAILED             (tampered anchor/token/path)            → exit 1
```

### Audit log row listing

`zarel audit list <log>` browses the rows of a tenant's privacy-preserving audit
table — `binding_violations` (blocked field-binding parameter-injection
attempts) or `topic_refusals` (blocked regulatory-boundary refusals).
Newest-first, cursor-paginated, gated by the `view_traces` runtime-system action (an unauthorized actor or an unknown log
gets an opaque 404). Each row exposes only a SHA-256 hash + a deterministic
PII-mask of the offending value — never the raw value (it is never stored).
Wraps `client.runtime.audit.list(log, params)` (→ `GET /runtime/audit/{log}`).

Distinct from `audit evidence <log>` above: that downloads a signed
tamper-evidence bundle for an **event hash-chain** (`state_machine` | `flows`);
this lists the **audit row-tables** (`binding_violations` | `topic_refusals`).

```bash
# Blocked binding violations, filtered (newest first):
zarel audit list binding_violations --entity Account --binding-mode immutable

# Blocked topic refusals, filtered:
zarel audit list topic_refusals --category investment_advice --reason matched

# Shared filters + pagination + output format:
#   --from/--to <iso8601>   inclusive created_at bounds
#   --limit <n>             page size (1–500, default 50)
#   --cursor <opaque>       continuation cursor from a previous page
#   --all                   auto-paginate across cursors (--limit = page size)
#   -f, --format <fmt>      table (default) | json | yaml
zarel audit list topic_refusals --from 2026-06-01 --all --format json
```

### Dry-run quantification

Async replay of historical traffic against a proposed spec.
Concurrency is capped per tenant (default 1, configurable per plan tier
through the tenant's resource limits).

```bash
# Submit + watch (polls until terminal)
zarel contract spec dry-run ./contracts/support.candidate.yaml \
  --replay-window 30d --format markdown --watch

# Or submit, then poll separately
zarel contract spec dry-run ./contracts/support.candidate.yaml --replay-window 7d
zarel contract spec dry-run get rep_<id>
zarel contract spec dry-run cancel rep_<id>      # release the cap counter
```

### Imports

```bash
zarel runtime imports snapshot ./tenant.data.json
zarel runtime imports snapshot ./tenant.data.json --mode restore --validation-mode collect-errors
```

## Output Formats

All list/get commands support `--format`:

- **`table`** (default) — Human-readable columnar output
- **`json`** — Machine-readable JSON
- **`yaml`** — YAML-style output

Pipe-friendly: no color when stdout is not a TTY.

## Exit Codes

| Code | Meaning     |
| ---- | ----------- |
| `0`  | Success     |
| `1`  | API error   |
| `2`  | Usage error |

## Development

```bash
# Run tests
npm test

# Build
npm run build
```

## License

MIT
