# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- `get(symbol="Type.Method")` selects the declaration the caller named instead
  of the first one sharing the method name. A qualified symbol used to have its
  receiver thrown away, so on `github.com/egoist/mygo` — where
  `Application.Title` does not exist — `get(symbol="Application.Title")`
  returned `func (w *Window) Title() string`, `get(symbol="NoSuchType.Window")`
  returned a `Window` method, and `get(symbol="Tray.Close")` returned
  `Channel.Close`, none reported as a miss. An agent reading that wrote code
  against a declaration it never asked for.
- A bare `symbol` that matches several declarations returns the candidates
  instead of one arbitrary match, and a miss names which part failed — the
  receiver or the name — and points at the declaration that does carry it.
  Generics work either way round: `Document[T].Window` and `Document.Window`
  are the same request.
- `max_tokens` is now a real ceiling. The budget used to cover the body only,
  so the provenance header and the truncation footer pushed every truncated
  response over: `search max_tokens=500` returned 2135 characters against a
  2000 budget, `get max_tokens=500` returned 2250. Both the header and the
  footer are now measured before the body is cut, and a response that fits is
  returned byte for byte unchanged.
- A truncated response is valid Markdown again. The cut used to land at an
  arbitrary character offset, so a response that ended inside a fenced Go block
  carried a single ``` marker and an agent parsing by fence swallowed
  everything after it. The cut now prefers a line boundary and closes a fence
  it lands inside.
- `search(query=...)` with no `library` now searches the resolved library's
  documentation. It previously fetched only an overview and then reported that
  the package had no godoc text, blaming upstream for a mistake the tool made:
  `search(query="cobra")` said the package had none while `get` returned its
  3,452 characters of godoc.
- A documentation fetch that fails is reported as a fetch failure, not as a
  package with no godoc text. The overview fallback is unchanged.

## [0.1.1] - 2026-11-11

First release published by CI. No user-facing change; this version exists to
validate the npm trusted publisher configuration, so later releases need no
manual `npm publish`.

### Changed

- Publishing runs from GitHub Actions on a `v*` tag, authenticated with OIDC
  instead of a stored npm token. Releases carry a provenance attestation.

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
- `scripts/test-matrix.ts`: 34 cases covering every tool argument and a spread
  of real-world questions.

### Known limits

- Go only. Other ecosystems need an adapter next to `src/orchestrator.ts`; the
  tools, caching and resolution logic are already ecosystem-neutral.
- Only the `##` groups and Go declarations that pkg.go.dev emits are parsed.
  Prose guides on a project's own site are not covered.
- Bare-name resolution spends one GitHub search. Without a token that is 10 a
  minute; a module path or `owner/repo` skips search entirely.

[Unreleased]: https://github.com/ysankpia/fact-mcp/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/ysankpia/fact-mcp/releases/tag/v0.1.1
[0.1.0]: https://github.com/ysankpia/fact-mcp/releases/tag/v0.1.0
