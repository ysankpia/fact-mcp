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

## Where we are — 0.1.2

**Shipped**

- Two tools, `search` and `get`, reading pkg.go.dev's live Markdown API.
- Go only, for now: module paths, `owner/repo`, bare names resolved through
  GitHub star order, and the standard library.
- An optional, self-hosted proxy for slow routes; direct mode is the default.
- 166 offline unit tests against committed pkg.go.dev fixtures, a 44-case live
  matrix, and CI that gates on both. Releases publish to npm over OIDC.
- A twelve-question benchmark (`bun run bench`) that gates on two numbers —
  answers inside a 1,500-token budget and the median response size — as a
  ratchet against `scripts/bench-baseline.json`.
- A bare name whose leading project is not Go is refused with that ecosystem
  named, instead of resolving to a weak same-named Go package.

**Measured** — twelve real questions ("how do I add middleware", "how do I
create a window", …) against the packages that answer them:

| Metric | Today | Gate for the 0.1 line |
| --- | --- | --- |
| Answer present at a 1,500-token budget | 10 / 12 | ≥ 11 / 12 |
| Answer present at the default budget (3,000) | 12 / 12 | 12 / 12 |
| Median response at the default budget | ~2,980 tokens | ≤ 1,500 tokens |
| Non-Go library refused explicitly | 4 / 4 | 4 / 4 |
| Answer among the first 3 sections | 7 / 12 | diagnostic only |

**Gaps behind those numbers**

- Responses are whole declarations, and that is what fills the budget.
  `WindowOptions` is 8,619 characters; the `Transparent` field that answers
  "make a window transparent" is 72 of them, **0.84% of what we send**. Slice a
  section to its signature and the match context and the same budget holds many
  more sections.
- That is also why two benchmark answers sit at rank 8 and 22 and miss a
  1,500-token budget: not because the ranking is bad, but because five whole
  declarations exhaust the budget before those sections are reached. Smaller
  sections cover them without a ranking change.
- Fields cannot be fetched: `get(symbol="WindowOptions.Transparent")` and
  `get(symbol="Server.ReadTimeout")` miss, because a field lives inside its
  struct's body rather than as a declaration of its own.

## 0.1.x — Go, finished

The 0.1 line stays open until the gate above passes. Patches ship as work lands;
one item may take more than one patch, and the version numbers below are the
order, not a promise of one patch each.

0.1.2 shipped the benchmark gate and the cross-ecosystem refusal.

**0.1.3 — answers, not pages.** Field-level lookup (`Type.Field`) and snippet
responses: a declaration's signature plus the prose or field lines around the
match, not the whole declaration. Smaller sections also mean more of them fit,
which is what covers the two benchmark answers that currently sit at rank 8 and
22. Target: the gate above — answer present at 1,500 tokens for at least 11 of
12, median at or below 1,500.

**0.1.4 … 0.1.x — whatever the gate still shows.** Every patch states the metric
it moves. If slicing alone does not reach the gate, the remaining gap is ranking;
only then extend the verb table, and only where a benchmark question proves it
helps. 0.2 does not start until the 0.1 line passes.

## 0.2 — Python, finished

Same gate, same thresholds, different ecosystem. Python ships when it passes,
not when it starts.

- An adapter behind the existing `buildBundle({ name, version, page, want })`
  shape, with resolution routed by ecosystem.
- Documentation read from Python's own package index API at request time: no
  index, nothing on disk, no keys.
- The benchmark rewritten with Python libraries and the same thresholds —
  answer present at a 1,500-token budget for at least 11 of 12, median at or
  below 1,500 tokens.
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
