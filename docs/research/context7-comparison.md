# Context7 and fact: what the comparison showed

Measured 2026-11-11 while deciding whether `fact` needed semantic search. The
short answer: it did not. The gap was corpus and response granularity, not
embeddings.

## The comparison

Nine real Go questions were sent to Context7's public API and to `fact`, with
the declaration that answers each one as the needle. Positions are where that
declaration first appears in the response.

| Question | Context7 | fact |
| --- | --- | --- |
| how do I add middleware | ~12 tok | ~109 tok |
| how do I route requests | ~66 tok | ~438 tok |
| how do I read a JSON body | ~203 tok | ~208 tok |
| how do I add a subcommand | ~478 tok | ~261 tok |
| how do I define a flag | ~131 tok | ~1,880 tok |
| how do I create a window | ~8 tok | ~36 tok |
| how do I make a window transparent | ~157 tok | ~1,086 tok |
| how do I upload a file | absent | ~35 tok |
| how do I write a message | ~406 tok | ~40 tok |

Both tools return roughly 5,000–6,000 tokens per call. Context7 puts the answer
earlier on most questions; `fact` found the answer in 9/9, Context7 in 8/9.

## Why Context7's answers land earlier

Two reasons, neither of them the embedding model:

1. **Corpus.** Context7 indexes repository documentation — `README.md`,
   `docs/*.md`, guides — and those files are written as "how to do X". `fact`
   reads pkg.go.dev, which is API reference written as "`WindowOptions`
   configures `NewWindow`". A guide says "Create a window with
   `mygo.NewWindow`"; the reference does not.
2. **Granularity.** Context7 returns small snippets with a source link. `fact`
   returns whole declarations, so one 8,619-character struct can fill the
   response and push the next section out.

A direct corpus swap (same keyword ranking, repository markdown instead of
pkg.go.dev) did not improve rank on its own, which confirmed that granularity
is the lever that remains available without an index.

## Endpoints used

Public, no token required at the time of measurement:

- `GET https://context7.com/api/v1/search?query=<query>` — library search,
  returns `{"results":[{"id":"/owner/repo", ...}]}`.
- `GET https://context7.com/api/v1/<id>?topic=<topic>&tokens=<n>` — snippets
  for a library, e.g. `/egoist/mygo?topic=create%20a%20window&tokens=1200`.
  A `topic` is the search query in Context7's model; `fact` already has
  `query` for that job.

## What this means for `fact`

- **No index, no embeddings.** Context7's advantage is its prebuilt corpus of
  guides; adopting that would replace the product, not improve it.
- **Ranking has diminishing returns.** A deterministic verb map
  (`create → new`, `start → listen`, …) moved the answer into the top three for
  7/12 questions instead of 1/12 at a cost of 14 table entries. Further
  ranking work is secondary.
- **Granularity is the remaining lever.** Slicing a declaration to its
  signature plus the match context fits many more sections per token budget.
  See the 0.1.3 release in `docs/ROADMAP.md`.

## Caveats

- Nine questions, one run each, against live upstream docs; a documentation
  change can move any row.
- Context7's public API may change or start requiring a token. The MCP endpoint
  (`https://mcp.context7.com/mcp`) uses an API key even though the REST
  endpoints did not.
