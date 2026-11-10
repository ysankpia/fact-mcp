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
  moreSectionsNote,
  noMatch,
  overview,
  sectionChunks,
  text,
} from "./render.ts";
import { rank, tokens } from "./rank.ts";
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
 * that query. Only a bare library name, with no query, is an overview.
 *
 * `undefined` means there is no name to look up at all.
 */
export function searchPlan(
  query: string,
  library: string,
): { name: string; want: "overview" | "docs" } | undefined {
  const name = (library || query).trim();
  if (!name) return undefined;
  return { name, want: query.trim() ? "docs" : "overview" };
}

export function searchDocs(args: SearchArgs, bundle: ResolvedBundle) {
  const maxChars = args.max_tokens * CHARS_PER_TOKEN;
  const query = (args.query ?? "").trim();
  const libraryName = (args.library ?? "").trim();

  if (!query && !libraryName) return missingInput();

  // A bare library name with no query is an overview request.
  if (!query) return text(overview(bundle));

  const terms = tokens(`${query} ${args.topic ?? ""}`);
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
  const headerText = header(bundle);

  if (ranked.length === 0) {
    return text(
      noMatch(headerText, query, documentMap(all), bundle.module.path),
    );
  }

  const { chunks } = sectionChunks(
    ranked.map((entry) => entry.section),
    maxChars,
    headerText.length,
  );

  const remaining = ranked.length - chunks.length;
  const nextStep =
    remaining > 0
      ? `Narrow with topic="${args.topic ?? query}", or call get(library="${bundle.module.path}", symbol="Name").`
      : "";

  return text(
    `${headerText}${chunks.join("\n\n")}${moreSectionsNote(remaining, nextStep)}`,
  );
}
