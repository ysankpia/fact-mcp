# Search returns snippets; `get` keeps whole declarations

A declaration's whole body can be thousands of characters while the answer is
one field: `WindowOptions` is 8,619 characters, and the `Transparent` field that
answers "make a window transparent" is 72 of them. Search now slices a section
above 900 characters to the declaration line, the lines around the match (with
their comments) and the paragraph that mentions the query. The default search
budget drops to 1,500 tokens. `get` on a named declaration still returns the
whole declaration, because full fidelity is what naming a symbol is for; a new
`get(Type.Field)` returns the field and the comment above it.

**Considered** sending whole declarations and letting the caller narrow.
Rejected: the caller is an agent that pays for every token and cannot know
which part of an 8 KB struct holds the answer. The footer already says how to
read more, and `get` returns the full declaration.

**Consequences:** a snippet can omit context a reader wanted. The benchmark
moved from 10/12 answers inside 1,500 tokens to 12/12, and the median response
at the default budget from ~2,980 to ~1,470 tokens. The benchmark accepts any
declaration that answers a question; the earlier 11/12 came from insisting on
one string for "how do I set a timeout" that lives on `Client`, while
`ReadTimeout`, `WriteTimeout` and `TimeoutHandler` are equally valid answers.
