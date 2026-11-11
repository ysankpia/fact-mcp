# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- An offline unit-test suite, run by `bun test`. The repository had none, so
  every check needed a live pkg.go.dev call and the only suite asserted
  substrings of live responses. That is why the defects below shipped green.
  Sectioning, ranking, truncation and both tool bodies are now driven from
  committed pkg.go.dev fixtures, and CI and the release workflow run the suite
  before building.

### Fixed

- A question is ranked by what it asks for, not only by the words it uses.
  `search(query="how do I create a window")` used to lead with the
  `WindowOptions` struct — the longest section that repeats "window" — because
  no API name contains "create". A fixed, reviewable verb-to-API table now
  contributes the stem (`create` → `new`, `start` → `listen`, `print` →
  `format`) and question words are dropped. Measured on twelve real questions
  against real godoc: the answering declaration moved into the top three for 7
  of 12, against 1 of 12 before, and into the top five for 10 of 12. The
  default budget drops from 6000 to 3000 tokens as a result: every one of those
  twelve answers now fits, where 6000 covered 8.
- `get(symbol="Name")` prefers the package-level declaration, as Go itself
  does. A bare name that matched a type and methods of the same name (or a func
  and a method) used to demand a choice; the unqualified name means the
  package-level one, and only several package-level declarations of the same
  name are ambiguous. `get(symbol="ListenAndServe")` returns the function again
  instead of a menu.
- An ambiguous `get` no longer suggests the call it just rejected. When the
  first candidate was a package-level declaration, the suggested symbol was the
  bare name — the same ambiguous call, a loop. The suggestion is now always
  receiver-qualified.
- `search(topic=...)` is a ranking hint, not a filter. Filtering on the literal
  word dropped the answer whenever the prose did not use it: `topic="sizing"`
  kept one section, `topic="authentication"` three of eighty-eight, and
  `topic="create a window"` filtered nothing at all. The sections that mention
  the topic now rank first and none are removed. The schema, the README and the
  footer describe the hint, and a topic with no query still becomes the query.
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
- A standard-library response cites a link that resolves. The `source:` line
  used the module address with a version, so `encoding/json` was reported as
  `https://pkg.go.dev/encoding/json@v1.27.4`, which answers HTTP 400; it is now
  `https://pkg.go.dev/encoding/json`, which answers 200. A versioned module
  keeps its `@version` link, which still answers 200.
- The overview is valid Markdown again. Joining the lines dropped every empty
  one, so `## Versions` and the other headings sat directly under the previous
  line and a rendering client showed them as prose. Every heading is now
  preceded by a blank line.
- The version in `serverInfo` comes from `package.json` instead of a literal
  that had gone stale: the server reported `0.1.0` while the published package
  was `0.1.1`. Bumping the manifest now moves the reported version with it.
- Six test-matrix cases asserted something that could not fail: a bare length,
  or a substring the provenance header of every response already carries. A
  no-match response satisfied them, so they proved nothing about the behaviour
  they were named for. Each now requires the API it names, and each was checked
  against a no-match response to confirm it rejects it.

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
