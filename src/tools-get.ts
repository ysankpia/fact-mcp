/**
 * The get tool body, driven by an already-built bundle.
 *
 * Like search, it never fetches: the entry point resolves the library and
 * passes the bundle in, so a fixture drives every branch offline.
 */

import {
  CHARS_PER_TOKEN,
  type ResolvedBundle,
  fitToBudget,
  header,
  text,
} from "./render.ts";
import { sections, type Section } from "./sections.ts";

export interface GetArgs {
  library: string;
  symbol?: string;
  page?: string;
  version?: string;
  max_tokens: number;
}

export function getDocs(args: GetArgs, bundle: ResolvedBundle) {
  const maxChars = args.max_tokens * CHARS_PER_TOKEN;
  const module = bundle.module;
  const pkg = bundle.primaryPackage ?? module.path;
  const doc = bundle.docs;
  const docText = doc?.markdown ?? "";
  const headerText = header(bundle);

  if (!docText.trim()) {
    const available = bundle.packages
      .filter((p) => p.synopsis)
      .slice(0, 20)
      .map((p) => `- ${p.path} — ${p.synopsis}`)
      .join("\n");
    return text(
      `${headerText}No godoc text for ${pkg}.${bundle.docsError ? `\n\nFetch failed: ${bundle.docsError}` : ""}\n\nAvailable packages:\n\n${available}`,
    );
  }

  if (!args.symbol) {
    return text(
      fitToBudget(
        headerText,
        docText,
        maxChars,
        `Pass symbol="Name" or page="<package path>" to fetch a narrower slice.`,
      ),
    );
  }

  const symbol = args.symbol;
  const wanted = wantedName(symbol);
  const all = sections(docText);

  // CURRENT BEHAVIOUR, NOT INTENDED: matching ignores the receiver and keeps
  // the first hit, so `get(symbol="Window")` on a document with several
  // declarations named Window returns whichever comes first rather than the
  // one the caller named. A sibling ticket fixes the lookup; Section already
  // carries `name`, `kind` and `receiver` so it can match on fields instead of
  // on a display string.
  const matches = all.filter((s) => {
    const name = matchName(s);
    return name === wanted || name === symbol.toLowerCase().trim();
  });

  if (matches.length === 0) {
    const names = all
      .filter((s) => s.kind !== "heading" && s.kind !== "block")
      .slice(0, 50)
      .map((s) => `- ${s.heading}`)
      .join("\n");
    return text(
      `${headerText}No declaration named "${args.symbol}". Declarations in this package:\n\n${names}`,
    );
  }

  const section = matches[0];
  return text(
    fitToBudget(
      headerText,
      section.body,
      maxChars,
      "Raise max_tokens to read the rest.",
    ),
  );
}

/**
 * The bare name a `symbol` argument asks for.
 *
 * "Limiter.Wait" and "Application.OnWindowCreated" name a method, so the last
 * dotted segment is the name to look for. The receiver is dropped here today;
 * see the note above on why that loses information.
 */
function wantedName(symbol: string): string {
  const needle = symbol.toLowerCase().trim();
  return needle.includes(".") ? needle.split(".").pop()! : needle;
}

/**
 * The name a section matches on.
 *
 * For a named declaration that is `name`. A grouped `const (...)` or `var (...)`
 * block is matched on its display heading instead ("const block"), which is
 * what today's `get` did before Section carried structured fields: a block has
 * no symbol name of its own, so the caller spells it the way the heading
 * shows. Kept as-is so the split changes no behaviour.
 */
function matchName(section: Section): string {
  if (section.kind === "block") return section.heading.toLowerCase();
  return section.name.toLowerCase();
}
