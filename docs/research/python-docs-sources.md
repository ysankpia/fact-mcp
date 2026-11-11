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
