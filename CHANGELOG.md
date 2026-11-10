# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-11-11

First public release.

### Added

- `search` tool: resolves a library name and returns the passages that answer a
  query, or a version and package overview when given only a library.
- `get` tool: returns one documentation page or one Go declaration at full
  fidelity.
- Go support through the official pkg.go.dev `/v1` API, which returns Markdown
  directly, so no HTML scraping or conversion is involved.
- Name resolution ranked by GitHub stars, because pkg.go.dev's own search buries
  a popular module under same-named forks.
- Standard library support: `encoding/json`, `net/http` and the rest map to the
  `std` module.
- `owner/repo` shorthand: `gorilla/websocket` is tried as
  `github.com/gorilla/websocket` before any search.
- Ambiguity handling: a close race returns the candidates with star counts
  instead of guessing.
- Two deployment modes:
  - **direct** (default): everything runs in the client process, no server
    needed.
  - **proxy** (opt-in): one request to a `fact-proxy` that sits next to
    pkg.go.dev, for slow or lossy routes.
- In-process cache with a 5 minute TTL. Nothing is written to disk.
- Server-side memo of name resolutions for 30 minutes, so a repeated question
  does not spend a rate-limited GitHub search.
- `fact-proxy`, a stateless orchestrator with a health endpoint, bearer auth,
  gzip responses and structured errors.
- `scripts/release.sh`: typecheck, bump, build, pack, install, repoint config.
- `scripts/deploy-server.sh`: syntax check, upload, checksum, restart, rollback.
- `scripts/setup-server.sh`: provision a fresh host from scratch.
- `scripts/test-matrix.ts`: 31 cases covering every tool argument and a spread
  of real-world questions.

### Known limits

- Go only. Other ecosystems need an adapter next to `src/orchestrator.ts`; the
  tools, caching and resolution logic are already ecosystem-neutral.
- Only the `##` groups and Go declarations that pkg.go.dev emits are parsed.
  Prose guides on a project's own site are not covered.
- Bare-name resolution spends one GitHub search. Without a token that is 10 a
  minute; a module path or `owner/repo` skips search entirely.

[Unreleased]: https://github.com/ysankpia/fact-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ysankpia/fact-mcp/releases/tag/v0.1.0
