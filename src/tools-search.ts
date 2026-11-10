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
    return text(
      [
        `library: ${bundle.module.path}`,
        `version: ${bundle.module.version}`,
        `package: ${pkg}`,
        "",
        "This package has no godoc text (it may be a command or an empty root). Here is the module overview instead:",
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

  // The footer only prints when sections had to be left out, so the next step
  // is offered unconditionally and stays out of a response that fits.
  const nextStep = `Narrow with topic="${args.topic ?? query}", or call get(library="${bundle.module.path}", symbol="Name").`;

  return text(
    sectionsResponse(
      headerText,
      ranked.map((entry) => entry.section),
      maxChars,
      nextStep,
    ),
  );
}
