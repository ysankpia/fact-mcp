# Detect unsupported libraries by the GitHub leader across all languages

A bare name can denote another ecosystem's library: `react` is a JavaScript
project before it is a Go package, and a Go-only search cannot see that. `fact`
therefore searches GitHub once without the language filter and refuses the name
when its leading repository is not Go and the best same-named Go repository is
either absent or at most a tenth of the leader's stars. The check runs only
when that Go match is absent or small, so an ordinary lookup of a Go library
does not spend the second search.

**Considered options:** querying npm and PyPI instead. Rejected because a name
may exist in several registries (`django` has an npm package as well as the
Python one), so a hit does not say which library the caller meant, and it adds
two network sources to a tool that otherwise reads one. The star ratio reuses
the Leader rule the glossary already defines.

**Consequences:** a name whose famous project is not Go is refused even when a
same-named Go package exists, unless that package is within ten times the
leader's stars. `zap` is unaffected because `uber-go/zap` is far larger than the
Batchfile repository that outranks it.
