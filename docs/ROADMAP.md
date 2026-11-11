# Roadmap

One rule decides every version here: **an ecosystem ships only when it is
finished to the same standard as the one before it.** A version number marks
completed work, not started work. Go is finished before Python begins; Python
is finished before a third ecosystem begins.

The standard is measured, not felt: a fixed set of real developer questions,
run against real documentation, with the answering declaration's position and
the response size as the numbers. A release that does not move one of those
numbers does not need to exist.

## Where we are — 0.1.1

**Shipped**

- Two tools, `search` and `get`, reading pkg.go.dev's live Markdown API.
- Go only, for now: module paths, `owner/repo`, bare names resolved through
  GitHub star order, and the standard library.
- An optional, self-hosted proxy for slow routes; direct mode is the default.
- 158 offline unit tests against committed pkg.go.dev fixtures, a 43-case live
  matrix, and CI that gates on both. Releases publish to npm over OIDC.

**Measured** — twelve real questions ("how do I add middleware", "how do I
create a window", …) against the packages that answer them:

| Metric | Today | Gate for the 0.1 line |
| --- | --- | --- |
| Answer among the first 3 sections | 7 / 12 | ≥ 9 / 12 |
| Answer present at the default budget | 12 / 12 | 12 / 12 |
| Median response at the default budget | ~2,980 tokens | ≤ 1,500 tokens |
| Non-Go library refused explicitly | 0 / 4 | 4 / 4 |

**Gaps behind those numbers**

- Responses are whole declarations. A `WindowOptions` struct is 8 KB, so the
  median response fills the default budget and the answer competes with noise.
- Fields cannot be fetched: `get(symbol="WindowOptions.Transparent")` and
  `get(symbol="Server.ReadTimeout")` miss, because a field lives inside its
  struct's body rather than as a declaration of its own.
- A name from another ecosystem resolves to an unrelated Go package: `react`
  becomes `github.com/rocketlaunchr/react`, `mongodb` becomes Go driver
  candidates. A plausible wrong answer is worse than a refusal.
- Ranking is still literal. `how do I define a flag` puts `Flags` at roughly
  1,880 tokens because "define" appears in no API name.

## 0.1.x — Go, finished

The 0.1 line stays open until the gate above passes. Patches ship as work lands;
one item may take more than one patch, and the version numbers below are the
order, not a promise of one patch each.

**0.1.2 — the gate, and honest refusal.** Commit the twelve-question benchmark
as a script, run it in CI, and make a non-Go name say it is not covered instead
of resolving to a Go package. No ranking change in this release: it exists to
make the standard enforceable.

**0.1.3 — answers, not pages.** Field-level lookup (`Type.Field`) and snippet
responses: the signature plus the prose around the match, not the whole
declaration. Target: median at or below 1,500 tokens with the answer still
present in all twelve.

**0.1.4 — ranking precision.** Close the top-3 gap the benchmark exposes.
Extend the verb table only where a benchmark question proves it helps; no
speculative synonyms.

**0.1.5 … 0.1.x — whatever the benchmark still shows.** Every patch states the
metric it moves. 0.2 does not start until the 0.1 line passes.

## 0.2 — Python, finished

Same gate, same thresholds, different ecosystem. Python ships when it passes,
not when it starts.

- An adapter behind the existing `buildBundle({ name, version, page, want })`
  shape, with resolution routed by ecosystem.
- Documentation read from Python's own package index API at request time: no
  index, nothing on disk, no keys.
- The benchmark rewritten with Python libraries and the same thresholds —
  answer in the top 3 for at least 9 of 12, present for 12 of 12, median at or
  below 1,500 tokens.
- Non-Python names refused explicitly, as in 0.1.x.

## 0.3 and later — more ecosystems

Candidates, unscheduled. Each is a `0.x` release that ships finished by the same
gate. The order follows demand, not ease.

## Not doing

- **An index or a prebuilt corpus.** Answers are read from the source at request
  time. That includes repository `docs/*.md` guides: they answer "how do I"
  better than API reference does, but indexing them is a different product.
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
