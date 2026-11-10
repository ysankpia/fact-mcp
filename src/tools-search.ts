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
  header,
  noMatch,
  overview,
  sectionsResponse,
  text,
} from "./render.ts";
import { rank, score, tokens } from "./rank.ts";
import { sections } from "./sections.ts";

export interface SearchArgs {
  query?: string;
  library?: string;
  version?: string;
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
  if (!query && !topic) return text(overview(bundle));

  // The query decides relevance; the topic then narrows the result. Ranking
  // with the query alone is what keeps a narrowed answer a subset of the
  // unnarrowed one — folding the topic into the same term list would only
  // reweight it. With no query the topic is the whole request, so it ranks.
  const terms = tokens(query || topic);
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
    );
  }

  const docText = doc.markdown;
  const all = sections(docText);
  const ranked = rank(all, terms);
  // A topic selects: every section that does not mention it is dropped, and
  // the ones that do stay in the order the query ranked them.
  const narrowed = topicTerms.length
    ? ranked.filter((entry) => score(entry.section, topicTerms) > 0)
    : ranked;
  const headerText = header(bundle);

  if (narrowed.length === 0) {
    return text(
      noMatch(
        headerText,
        query,
        documentMap(all),
        bundle.module.path,
        topic || undefined,
      ),
    );
  }

  // The footer only prints when sections had to be left out, so the next step
  // is offered unconditionally and stays out of a response that fits. A caller
  // who already passed a topic is told what widens the search, not to narrow a
  // search that is already narrowed.
  const nextCall = `call get(library="${bundle.module.path}", symbol="Name")`;
  const nextStep = topic
    ? `topic="${topic}" kept only the sections that mention it; drop the topic to widen, or ${nextCall}.`
    : `Narrow with topic="${query}": it keeps only the sections that mention it, or ${nextCall}.`;

  return text(
    sectionsResponse(
      headerText,
      narrowed.map((entry) => entry.section),
      maxChars,
      nextStep,
    ),
  );
}
