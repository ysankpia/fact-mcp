# Roadmap

One rule decides every version here: **an ecosystem ships only when it is
finished to the same standard as the one before it.** A version number marks
completed work, not started work. Go is finished before Python begins; Python
is finished before a third ecosystem begins.

The standard is measured, not felt: a fixed set of real developer questions,
run against real documentation, with **whether the answer fits inside a token
budget** and **how large that response is** as the numbers. A release that does
not move one of those numbers does not need to exist.

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

## 0.2 — unassigned

Same gate, same thresholds. **Python is dropped as the 0.2 ecosystem.**

The source comparison and a throwaway prototype are recorded in
[research/python-docs-sources.md](research/python-docs-sources.md). In short:
PyPI descriptions answered 4/9 questions, repository READMEs 3/9, documentation
landing pages 1/9. A Sphinx search-index path answered 4/5 of its questions, but
Django needs server-rendered HTML and pydantic uses Pagefind, a WASM-backed
index. That is a collection of per-site scrapers, not one ecosystem adapter;
calling a Sphinx-only subset "Python finished" would be false.

The next ecosystem must expose a Markdown documentation API like pkg.go.dev's.
None obvious does. If none appears, 0.2 becomes **Go, deeper**: close the one
remaining benchmark miss (`net/http` timeout, a field on `Server`) and ship
12/12 rather than a second ecosystem that cannot meet the standard. This is a
decision for the next session, not a build in progress.

## 0.3 and later — more ecosystems

Candidates, unscheduled. Each is a `0.x` release that ships finished by the same
gate. The order follows demand, not ease.

## Not doing

- **An index or a prebuilt corpus.** Answers are read from the source at request
  time. That includes repository `docs/*.md` guides: they answer "how do I"
  better than API reference does, but indexing them is a different product.
  [The Context7 comparison](research/context7-comparison.md) records why that
  corpus, not semantic search, is what an index would buy.
- **Writing to disk.** The only cache is in process memory, and it expires.
- **Hosted proxies or distribution.** The proxy stays optional and self-hosted;
  users configure their own. No accounts, no keys.
- **Answering for ecosystems that have not shipped.** A refusal is better than
  a plausible wrong answer from another language.

## How a release works

A `v*` tag runs `publish.yml`: typecheck, unit tests, the live matrix, a
`CHANGELOG.md` section for the tag, then npm publish and a GitHub Release. The
workflow refuses to publish when the tag, the manifest and the changelog
disagree. `main` takes changes only through a pull request with both required
checks green.
