# Python documentation at request time: what the sources actually give

Measured 2026-11-11 while deciding whether 0.2 could be a Python adapter. The
short answer: no single request-time fetch meets the Go gate. Python needs a
search-then-fetch path over HTML, or it does not ship.

## Method

Nine real Python questions across four packages. For each question the expected
API string was looked up in three candidate corpora, fetched once per package:

| Corpus | What it is |
| --- | --- |
| `pypi` | `https://pypi.org/pypi/<name>/json`, `info.description` (README, Markdown or reST) |
| `repo` | the project's `README.md` from `raw.githubusercontent.com` |
| `docs` | the documentation site's landing page, tags stripped |

Sizes are estimated tokens (characters ÷ 4), the same estimate `fact` budgets in.

| Question | Package | PyPI | Repo README | Docs landing |
| --- | --- | --- | --- | --- |
| send a GET request | requests | yes (724) | yes (724) | no (1,083) |
| set a timeout | requests | no | no | no |
| upload a file | requests | no | no | no |
| define a route | flask | yes (410) | yes (410) | no (1,749) |
| return JSON | flask | no | no | no |
| define a model | django | no (505) | no (3) | no (2,650) |
| filter a queryset | django | no | no | no |
| create a model | pydantic | yes (34,756) | yes (898) | yes (1,947) |
| add a field | pydantic | yes (34,756) | no | no |

Coverage: **PyPI 4/9, repository README 3/9, documentation landing page 1/9.**

## What this says

- READMEs answer quickstart questions (`requests.get`, `@app.route`,
  `BaseModel`) and almost nothing else. API detail — a timeout parameter, file
  uploads, `jsonify`, `models.Model`, queryset filters — lives in the
  documentation site, on deep pages the landing page does not link to in text.
- Pydantic's PyPI description is **34,756 tokens**, more than the entire budget
  of a Go answer; Django's repository README is a three-token stub.
- The documentation landing pages are small but cover one question of nine.
  Answering the rest requires following the site's search or navigation, then
  converting HTML to something an agent can read.

## Consequence for 0.2

The Go gate — 11 of 12 answers inside 1,500 tokens, median at or below 1,500 —
cannot be met by one PyPI or README fetch. Python is therefore **not** an
adapter problem; it is a different retrieval architecture: query the project's
Sphinx/ReadTheDocs search, fetch the top page, strip HTML, rank sections. That
is more requests, noisier text, and a new failure mode per site.

Decision: 0.2 remains unstarted. The next step is a throwaway prototype of the
search-then-fetch path on these nine questions. It ships Python only if it
passes the same gate; otherwise Python is dropped and the next ecosystem is
chosen for a Markdown documentation API like the one Go has.

## Prototype: 2026-11-11

A throwaway script used each site's own search index, fetched the top source
pages, parsed reST sections and ranked them with the same code the Go path
uses. Budget: 1,500 tokens.

| Question | Source | Result |
| --- | --- | --- |
| requests: send a GET request | Sphinx `searchindex.js` | answered |
| requests: set a timeout | Sphinx | answered |
| requests: upload a file | Sphinx | answered |
| flask: define a route | Sphinx | **miss** — the site's index has no term `route`, `routes` or `routing`, so no document was selected |
| flask: return JSON | Sphinx | answered |

Sphinx path: **4/5**. The index is 87 KB for requests and 186 KB for flask;
the sources are `_sources/<doc>.rst.txt`. The one miss is an index gap, not a
ranking failure: the API name is absent from the site's own vocabulary.

The other four questions cannot run through one path:

- **Django** has no `searchindex.js`. Its search is server-rendered HTML: the
  "define a model" result page contains `models.Model`, but the page is about
  10,000 tokens of HTML and needs its own parser and slicer.
- **Pydantic** uses Pagefind (`pagefind-body` and a `/pagefind/` index), a
  WASM-backed static index rather than a term map. Searching it needs a
  Pagefind client, not a JSON lookup.

So Python is a collection of per-site backends — Sphinx, Django's server
search, Pagefind, and likely others. That is the real cost of the ecosystem,
and it is why "add Python" is not one adapter.

## Verdict

Python does not pass the same-gate rule as a single ecosystem. A Sphinx-only
subset would answer 4/5 and could be extended, but calling that "Python
finished" would be false: the two most prominent frameworks in the sample
(Django, pydantic) are outside it and need different machinery.

Recommendation: **drop Python as the 0.2 ecosystem.** The next ecosystem must
expose a Markdown documentation API like pkg.go.dev's; none obvious does. 0.2
is therefore unassigned, and if no such ecosystem appears it becomes **Go,
deeper** — close the one remaining benchmark miss (`net/http` timeout) and
ship 12/12 rather than a second ecosystem that cannot meet the standard.

