# Roadmap

**This project is Go-only, and that is a decision, not a stage.** A second
ecosystem would need an official, structured documentation API that answers in
seconds — the same shape pkg.go.dev gives Go. Two candidates were measured and
neither qualifies: Rust's docs.rs ships megabytes of JSON per crate (15–37 s
per call), and Python has no single source at all. The evidence is in
[research/python-docs-sources.md](research/python-docs-sources.md) and on the
unmerged branch `feat/rust-prototype`.

One rule decides every version: **a release ships only when it moves a measured
number.** The numbers are whether the answer fits inside a token budget, and how
large the response is.

Position within the response is a diagnostic, not a gate. The reader is an agent
that reads the whole answer, so an answer at rank 5 costs the same as one at
rank 1; what changes the outcome is whether it is inside the budget at all.

## Where we are — 0.1.3

**Shipped**

- Two tools, `search` and `get`, reading pkg.go.dev's live Markdown API.
- Go only, for now: module paths, `owner/repo`, bare names resolved through
  GitHub star order, and the standard library.
- An optional, self-hosted proxy for slow routes; direct mode is the default.
- 173 offline unit tests against committed pkg.go.dev fixtures, a 44-case live
  matrix, and CI that gates on both. Releases publish to npm over OIDC.
- A twelve-question benchmark (`bun run bench`) that gates on two numbers —
  answers inside a 1,500-token budget and the median response size — as a
  ratchet against `scripts/bench-baseline.json`.
- A bare name whose leading project is not Go is refused with that ecosystem
  named, instead of resolving to a weak same-named Go package.
- `search` returns snippets: the declaration line, the lines around the match
  and the paragraph that mentions it. `get(Type.Field)` returns a field and its
  doc comment; `get(Type)` still returns the whole declaration.

**Measured** — twelve real questions ("how do I add middleware", "how do I
create a window", …) against the packages that answer them:

| Metric | Today | Gate for the 0.1 line |
| --- | --- | --- |
| Answer present at a 1,500-token budget | 12 / 12 | ≥ 11 / 12 |
| Median response at the default budget (1,500) | ~1,470 tokens | ≤ 1,500 tokens |
| Non-Go library refused explicitly | 4 / 4 | 4 / 4 |
| Answer among the first 3 sections | diagnostic only | diagnostic only |

**Gaps behind those numbers**

- None. The benchmark accepts any declaration that answers a question: "how do
  I set a timeout" on `net/http` is satisfied by `ReadTimeout`,
  `WriteTimeout` or `TimeoutHandler`, because the question does not name one
  type. The previous 11/12 came from insisting on a single string that lives on
  `Client`, not from a missing answer.

## 0.1.x — Go, finished

0.1 is complete at 0.1.3. 0.1.2 shipped the benchmark gate and the
cross-ecosystem refusal; 0.1.3 shipped snippets and field lookup, and passed
the gate above. Further 0.1 patches are for regressions, not new scope.

## 0.2 — not planned

**This project is Go-only.** A second ecosystem needs two properties, and no
candidate has both:

| Candidate | Source | Answers | Median | **Per call** |
| --- | --- | --- | --- | --- |
| Go (shipped) | pkg.go.dev Markdown | 12/12 | ~1,470 tok | **1–3 s** |
| Rust (prototype) | docs.rs rustdoc JSON, zstd | 8/9 | ~1,434 tok | **15–37 s** |
| Python (prototype) | PyPI / README / Sphinx | 4/9 single fetch, 4/5 Sphinx | — | — |

Rust has a real structured API and would pass the token gate, but each crate
ships 85 KB–475 KB of compressed JSON (1.4–3.2 MB decompressed) against
pkg.go.dev's tens of kilobytes of Markdown, so every call costs 15–37 seconds.
Python has no single source: PyPI descriptions are READMEs, and Django, Sphinx
and Pagefind each need their own scraper.

The prototype lives on the local branch `feat/rust-prototype`, unmerged, as the
evidence for this decision. The measurements are in
[research/python-docs-sources.md](research/python-docs-sources.md).

**The bar for a second ecosystem:** an official, structured documentation API
that answers in seconds, like pkg.go.dev. Anything less trades a 10× latency
increase for languages this project's users do not write. If such a source
appears, it gets the same gate; until then 0.2 does not exist.

## Not doing

- **A second ecosystem without such a source.** See above.
- **An index or a prebuilt corpus.** Answers are read from the source at request
  time. That includes repository `docs/*.md` guides: they answer "how do I"
  better than API reference does, but indexing them is a different product.
  [The Context7 comparison](research/context7-comparison.md) records why that
  corpus, not semantic search, is what an index would buy. Several projects
  already occupy that space (Context7, DeepWiki, GitMCP, Grounded Docs); this
  one's only unique asset is Go API-reference depth.
- **Writing to disk.** The only cache is in process memory, and it expires.
- **Hosted proxies or distribution.** The proxy stays optional and self-hosted;
  users configure their own. No accounts, no keys.
- **Answering for ecosystems that have not shipped.** A refusal is better than
  a plausible wrong answer from another language.
- **HTML scraping as a general path.** Converting HTML to Markdown works
  (measured), but discovery — which page, which version — stays per-site. Filed
  as #25 for the day a specific library needs it.

## How a release works

A `v*` tag runs `publish.yml`: typecheck, unit tests, the live matrix, a
`CHANGELOG.md` section for the tag, then npm publish and a GitHub Release. The
workflow refuses to publish when the tag, the manifest and the changelog
disagree. `main` takes changes only through a pull request with both required
checks green.
