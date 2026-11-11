# Is fact worth maintaining?

Measured 2026-11-12, after the project reached 0.1.3 and the multi-language
question was settled. This is the honest record, including the parts that argue
against the project.

## The question

`fact` answers Go API questions from pkg.go.dev at request time. Was it worth
building, and is it worth continuing?

## What the evidence says

**Usage, measured in the session that built it.** Across 657 tool calls, `fact`
was called **6 times** (4 `search`, 2 `get`) — and most of those were testing
the tool itself, not using it to write code.

**Adoption.** npm downloads last month: **326 万** for Context7's MCP server,
**382** for `fact`.

**What already exists.**

- `gopls` is installed on the development machine. It gives exact types,
  signatures and navigation inside the editor, instantly and offline.
- Context7's REST API answers **anonymously** (HTTP 200, no key) and covers every
  language.
- General web search answers most "how do I" questions.

**What `fact` uniquely adds.** In an environment with no editor — an agent
answering a Go question in a terminal or a chat — it returns the current API
reference at the installed version, sliced to the answer, in 1–3 seconds. No
other tool does exactly that: Context7 returns repository prose, gopls needs a
local module, and search returns blog posts.

## First-principles reading

The product optimises **supply** — latency, token budget, ranking, ecosystems —
and never measured **demand**. The one demand signal available (this session) is
close to zero. That does not prove nobody needs it; it proves the case is
unproven, and further supply-side work would be optimising an unvalidated
premise.

The primary contradiction is not "how good is the answer" but "does the question
get asked in a context where this tool is the only option".

## Decision

**Maintenance mode.** No new features. Bug fixes and dependency updates only.

The project keeps two kinds of value:

1. **The tool itself**, for the cases above, at its current quality: 12/12
   benchmark answers inside 1,500 tokens, median ~1,470, 1–3 s per call.
2. **A worked example** of a complete Go-adjacent project: CI, OIDC publishing,
   a benchmark gate, ADRs, an issue workflow, and a documented decision to stop.

## The test that would change this

For two weeks, record every moment you want to look up a Go API, and where it
happened:

- in the editor → `gopls` already covers it;
- inside an agent, with no editor → this is `fact`'s only case;
- on the web → Context7 or search covers it.

If the agent case appears **10 or more times**, resume work: it is validated, and
the roadmap's 0.1 line is the foundation. If it appears **fewer than 3 times**,
archive the repository with a pointer to this document and stop.

Cheap to run, and it is the only measurement that can answer the question.
