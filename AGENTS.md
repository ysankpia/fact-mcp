# fact-mcp

**Fact, not memory.** An MCP server that answers library questions from the
official documentation at request time, instead of from a prebuilt index.

This codebase is yours: what it's for and how it's built are your call, and
you'll keep building on it.

## What this is

Two tools over stdio:

- `search` — resolve a library and return the passages that answer a query
- `get` — fetch one documentation page or one Go declaration

No index, nothing on disk. Answers come from pkg.go.dev's `/v1` API, which
returns Markdown directly.

## Layout

| Path                     | Role                                                |
| ------------------------ | --------------------------------------------------- |
| `src/index.ts`           | Entry point: stdio transport and startup banner     |
| `src/server.ts`          | The MCP server: identity and both tool registrations |
| `src/version.ts`         | The reported version, read from `package.json`      |
| `src/sections.ts`        | Splitting pkg.go.dev Markdown into sections         |
| `src/rank.ts`            | Tokenising a query and scoring sections against it  |
| `src/snippet.ts`         | Slicing a section to the part that answers a query  |
| `src/render.ts`          | Response assembly, truncation, headers and overviews |
| `src/tools-search.ts`    | The `search` tool body, taking an already-built bundle |
| `src/tools-get.ts`       | The `get` tool body, taking an already-built bundle |
| `src/orchestrator.ts`    | Resolution and fetching, shared by client and proxy |
| `src/go.ts`              | Bundle source selection (direct or proxy) and cache |
| `src/proxy.ts`           | Proxy transport with retry                          |
| `src/cache.ts`           | In-process LRU, five minute TTL                     |
| `server/proxy.ts`        | The optional `fact-proxy` orchestrator              |
| `scripts/test-matrix.ts` | 44 cases covering every tool argument               |
| `scripts/bench.ts`       | Twelve-question product benchmark and its ratchet   |
| `scripts/harness.ts`     | Build selection and GitHub token for the live scripts |
| `test/`                  | Offline unit tests and the pkg.go.dev fixture       |

The tool modules take a bundle as an argument and never fetch, so a fixture
drives every branch with no network. The server does the fetching and passes
the result in; keep that direction.

## Commands

```sh
bun install
bun run typecheck
bun run build
bun test                           # offline unit tests, no network
bun run test-matrix --delay=6500   # paces only the cases that spend a search
bun run bench                      # the 12-question product benchmark
bun run inspect                    # MCP Inspector
```

## Guardrails

Enable the commit hook once per clone:

```sh
git config core.hooksPath scripts/hooks
```

It refuses a commit whose server code does not parse, and typechecks when a
TypeScript source file is staged. CI runs the same checks plus the unit tests
and the test matrix, so a green local hook and a green CI agree.

## Remote hosts

Deploying over SSH through a tunnel drops connections often enough that a
single attempt is unreliable. Use `scripts/retry.sh` rather than writing a
retry loop by hand:

```sh
./scripts/retry.sh ssh "$FACT_HOST" 'systemctl is-active fact-mcp'
```

It retries only transient failures (connection reset, TLS errors, timeouts,
HTTP 429/502/503/504) and reports a real failure on the first attempt.

A value written on the remote side travels through a pipe, never a heredoc:

```sh
printf '%s\n' "$VALUE" | ssh "$FACT_HOST" 'sudo tee /etc/fact-mcp.env >/dev/null'
```

A heredoc replaces stdin, so a script fed with `ssh 'bash -s' <<EOF` cannot
also receive piped data: the script body itself is what `tee` writes into the
file. This happened once to `/etc/fact-mcp.env` and had to be restored from a
backup.

## Agent harness

Background tasks report completion on their own. `TaskOutput` is for one
`block=false` peek at progress; after that, end the turn and wait for the
notification rather than polling.

## Releasing

```sh
npm version patch --no-git-tag-version
git add -A && git commit -m "chore: release vX.Y.Z"
git tag vX.Y.Z && git push && git push --tags
```

A tag publishes to npm through OIDC trusted publishing and opens a GitHub
Release from the changelog. No token is stored anywhere. The workflow refuses
to publish when `CHANGELOG.md` has no section for the tag, or when the tag and
`package.json` disagree.

## Conventions

- No prebuilt index and nothing written to disk: that is the product.
- A test that only asserts "no exception" is not a test.

## Agent skills

### Issue tracker

Issues live in GitHub Issues, driven by the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles, label strings equal to their names. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` at the root plus `docs/adr/`. See `docs/agents/domain.md`.
