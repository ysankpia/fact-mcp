/**
 * The search tool body, driven by an already-built bundle.
 *
 * No fetching happens here: the entry point resolves the library and passes
 * the bundle in, which is what lets a fixture drive every branch offline.
 */

import {
  CHARS_PER_TOKEN,
  type ResolvedBundle,
  documentMap,
  failure,
  fitToBudget,
  header,
  noMatchBody,
  overview,
  sectionsResponse,
  text,
} from "./render.ts";
import { rank, queryTerms, score, tokens } from "./rank.ts";
import { sections } from "./sections.ts";

export interface SearchArgs {
  query?: string;
  library?: string;
  topic?: string;
  max_tokens: number;
}

/**
 * The answer for a call with neither a query nor a library.
 *
 * Exported because the entry point must return it before resolving: there is
 * no name to look up, so no bundle can be built. The wording stays here, next
 * to the rest of the tool's responses.
 */
export function missingInput() {
  return failure(
    'Provide a query, a library name, or both. Example: search(query="create a window", library="mygo").',
  );
}

/**
 * What a `search` call must fetch, decided before any lookup.
 *
 * Two answers come out of the arguments: the name to resolve, and whether the
 * bundle needs the Markdown body. They belong together because they are the
 * same decision — a query is a request to search documentation, so the docs
 * body must be fetched even when the caller let the tool derive the name from
 * that query. A topic is the same request: it selects sections out of the
 * documentation, so it also needs the body. Only a bare library name, with no
 * query and no topic, is an overview.
 *
 * `undefined` means there is no name to look up at all.
 */
export function searchPlan(
  query: string,
  library: string,
  topic = "",
): { name: string; want: "overview" | "docs" } | undefined {
  const name = (library || query).trim();
  if (!name) return undefined;
  return {
    name,
    want: query.trim() || topic.trim() ? "docs" : "overview",
  };
}

export function searchDocs(args: SearchArgs, bundle: ResolvedBundle) {
  const maxChars = args.max_tokens * CHARS_PER_TOKEN;
  const query = (args.query ?? "").trim();
  const topic = (args.topic ?? "").trim();
  const libraryName = (args.library ?? "").trim();

  if (!query && !libraryName) return missingInput();

  // A bare library name, with neither a query nor a topic, is an overview
  // request. A topic on its own is not: it asks for the sections about that
  // topic, which only the docs body has.
  if (!query && !topic) {
    return text(
      fitToBudget(
        "",
        overview(bundle),
        maxChars,
        `Pass a query to search the docs, or call get(library="${bundle.module.path}", symbol="Name").`,
      ),
    );
  }

  // The query decides relevance; the topic then narrows the result. Ranking
  // with the query alone is what keeps a narrowed answer a subset of the
  // unnarrowed one — folding the topic into the same term list would only
  // reweight it. With no query the topic is the whole request, so it ranks.
  //
  // `queryTerms` adds the API stems a verb implies ("create" → "new") and
  // drops question words. Without it, "how do I create a window" scores the
  // long WindowOptions struct above the NewWindow func that answers it.
  const terms = queryTerms(query || topic);
  const topicTerms = tokens(topic);
  const doc = bundle.docs;
  const pkg = bundle.primaryPackage ?? bundle.module.path;

  if (!doc || !doc.markdown.trim()) {
    // `docsError` means the fetch failed; without it the fetch succeeded and
    // the package genuinely has no godoc text. Claiming the package has none
    // when the fetch failed blames upstream for a local mistake and sends the
    // caller looking for a different library.
    const reason = bundle.docsError
      ? [
          "The godoc fetch failed, so this says nothing about the package's documentation.",
          `Fetch failed: ${bundle.docsError}`,
          `Retry, or call get(library="${bundle.module.path}") to read the raw page.`,
        ]
      : ["This package has no godoc text (it may be a command or an empty root)."];
    return text(
      fitToBudget(
        "",
        [
          `library: ${bundle.module.path}`,
          `version: ${bundle.module.version}`,
          `package: ${pkg}`,
          "",
          ...reason,
          "",
          "Here is the module overview instead:",
          "",
          overview(bundle),
        ].join("\n"),
        maxChars,
        `Call get(library="${bundle.module.path}", symbol="Name") to read one declaration.`,
      ),
    );
  }

  const docText = doc.markdown;
  const all = sections(docText);
  const ranked = rank(all, terms);
  // `topic` is a hint, not a filter. It lifts the sections that mention it
  // above the rest, but every section the query matched is still returned:
  // a hard filter drops the answer too whenever the topic word is not in the
  // prose, and a natural-language topic ("authentication", "sizing") is
  // exactly the case where that happens.
  const ordered = topicTerms.length
    ? ranked
        .map((entry) => ({
          ...entry,
          score: entry.score + score(entry.section, topicTerms),
        }))
        .sort((a, b) => b.score - a.score)
    : ranked;
  const headerText = header(bundle);

  if (ordered.length === 0) {
    return text(
      fitToBudget(
        headerText,
        noMatchBody(query, documentMap(all), bundle.module.path),
        maxChars,
        `Pass a query to search the docs, or call get(library="${bundle.module.path}", symbol="Name").`,
      ),
    );
  }

  // The footer only prints when sections had to be left out, so the next step
  // is offered unconditionally and stays out of a response that fits. The
  // advice must not name the query as the topic: every section already matched
  // the query, so that hint would change nothing.
  const nextCall = `call get(library="${bundle.module.path}", symbol="Name")`;
  const nextStep = topic
    ? `topic="${topic}" ranked the sections that mention it first, or ${nextCall}.`
    : `Narrow with topic set to one name from these results (a symbol or area), or ${nextCall}.`;

  return text(
    sectionsResponse(
      headerText,
      ordered.map((entry) => entry.section),
      maxChars,
      nextStep,
      terms,
    ),
  );
}
