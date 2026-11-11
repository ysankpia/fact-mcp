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
| Answer present at a 1,500-token budget | 11 / 12 | ≥ 11 / 12 |
| Median response at the default budget (1,500) | ~1,470 tokens | ≤ 1,500 tokens |
| Non-Go library refused explicitly | 4 / 4 | 4 / 4 |
| Answer among the first 3 sections | diagnostic only | diagnostic only |

**Gaps behind those numbers**

- None against the gate. One benchmark answer, "how do I set a timeout" against
  `net/http`, is still outside 1,500 tokens: the answer is a field on `Server`
  and ranking prefers `TimeoutHandler`. It is recorded in ADR 0002 and is the
  next candidate only if 0.1 quality work resumes.

## 0.1.x — Go, finished

0.1 is complete at 0.1.3. 0.1.2 shipped the benchmark gate and the
cross-ecosystem refusal; 0.1.3 shipped snippets and field lookup, and passed
the gate above. Further 0.1 patches are for regressions, not new scope.

## 0.2 — Python, finished

Same gate, same thresholds, different ecosystem. Python ships when it passes,
not when it starts.

**The source comparison is done, and no single fetch passes.** Nine questions
across requests, flask, django and pydantic: PyPI's description answered 4/9,
the repository README 3/9, the documentation landing page 1/9. READMEs carry
quickstart snippets; API detail lives on deep documentation pages. Pydantic's
PyPI description alone is 34,756 tokens, larger than an entire Go answer, and
Django's repository README is a three-token stub.
[The measurements](research/python-docs-sources.md) are recorded in full.

Python is therefore not an adapter problem. It needs a search-then-fetch path
over HTML documentation: query the site's search, fetch the top page, strip
HTML, rank sections. 0.2 remains unstarted until a throwaway prototype of that
path passes the gate on the same nine questions. If it cannot, Python is
dropped and the next ecosystem is chosen for a Markdown documentation API like
the one Go has.

- A prototype of the search-then-fetch path, measured against the same gate —
  the next step, not an adapter.
- If it passes: an adapter behind the existing
  `buildBundle({ name, version, page, want })` shape, routed by ecosystem,
  with the benchmark rewritten for Python at the same thresholds.
- Non-Python names refused explicitly, as in 0.1.x.

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
