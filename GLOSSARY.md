# Glossary

Terms this project uses in its own way. When an issue, a proposal or a commit
message names one of these, it means what is written here.

## Documentation concepts

**Bundle** — Everything one library lookup returns: the resolved module, its
version list, its package list, the chosen primary package, and (unless an
overview was asked for) that package's Markdown. Built by `buildBundle` in
`src/orchestrator.ts`. It is the unit the cache stores and the proxy returns.

**Overview** — A bundle with `want: "overview"`: versions and packages, but no
Markdown body. What a caller gets when they name a library and ask nothing.

**Section** — One searchable unit of pkg.go.dev Markdown. pkg.go.dev emits `##`
groups (Constants, Functions, Types) and then one fenced Go block per
declaration followed by its prose; a declaration block starts a section. There
are no per-symbol headings, so `src/sections.ts` splits on the fences rather than
on headings. A section carries its `name`, `kind` and, for a method, its
`receiver` as separate fields, so nothing has to re-parse a display heading.

**Declaration** — A single `type`, `func`, `const` or `var` in a Go package, as
it appears in one fenced block. What `get` returns when given a `symbol`.

## Resolution concepts

**Bare name** — A library named the way a person says it (`mygo`), with no host
and no owner. Resolving one costs a GitHub search, so it is the only thing that
touches the rate-limited API.

**Module path** — `github.com/owner/repo`. Resolved by a direct pkg.go.dev
lookup; never searches.

**Owner/repo** — `owner/repo` with no host, tried as `github.com/owner/repo`
before any search. Cheaper than a bare name, and how people usually write a
library they already know.

**Leader rule** — When several repositories match a bare name and the top one
has at least ten times the stars of the second, it is chosen without asking.
Below that, the caller gets candidates instead of a guess.

## Deployment concepts

**Direct mode** — The default. The client builds bundles itself; no server is
involved. Costs several round trips to pkg.go.dev, which is fine on a fast
route.

**Proxy mode** — Opt-in via `FACT_PROXY_URL`. A `fact-proxy` next to pkg.go.dev
performs every upstream fetch and returns the bundle in one response, turning
several slow round trips into one.

**fact-proxy** — The stateless orchestrator in `server/proxy.ts`. It stores
nothing: no cache, no database, no files.

## Cache concepts

**In-process cache** — The client's only cache. Holds bundles for five minutes
in memory, then forgets them. Nothing is written to disk.

**Name memo** — The proxy's short-lived record of how a bare name resolved, so a
repeated question does not spend another rate-limited search. Holds no document
content.

**Rate limit** — GitHub's unauthenticated search allows 10 requests a minute,
counted per IP. A token raises it to 30. Only bare-name resolution spends one.
