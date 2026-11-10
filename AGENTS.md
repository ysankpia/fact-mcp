# fact-mcp

**Fact, not memory.** An MCP server that answers library questions from the
official documentation at request time, instead of from a prebuilt index.

## What this is

Two tools over stdio:

- `search` — resolve a library and return the passages that answer a query
- `get` — fetch one documentation page or one Go declaration

No index, nothing on disk. Answers come from pkg.go.dev's `/v1` API, which
returns Markdown directly.

## Layout

| Path                     | Role                                                |
| ------------------------ | --------------------------------------------------- |
| `src/index.ts`           | MCP tools, Markdown sectioning, ranking, truncation |
| `src/orchestrator.ts`    | Resolution and fetching, shared by client and proxy |
| `src/go.ts`              | Bundle source selection (direct or proxy) and cache |
| `src/proxy.ts`           | Proxy transport with retry                          |
| `src/cache.ts`           | In-process LRU, five minute TTL                     |
| `server/proxy.ts`        | The optional `fact-proxy` orchestrator              |
| `scripts/test-matrix.ts` | 31 cases covering every tool argument               |

## Commands

```sh
bun install
bun run typecheck
bun run build
bun run test-matrix --delay=6500   # paces only the cases that spend a search
bun run inspect                    # MCP Inspector
```

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

- Comments explain why, not what. Match the surrounding density.
- No prebuilt index and nothing written to disk: that is the product.
- Failures say what went wrong and what to do next. Never answer from a guess.
- A test that only asserts "no exception" is not a test.

## Agent skills

### Issue tracker

Issues live in GitHub Issues, driven by the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles, label strings equal to their names. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` at the root plus `docs/adr/`. See `docs/agents/domain.md`.
