/**
 * Snippets: the part of a declaration that answers a query.
 *
 * pkg.go.dev gives a declaration's whole body. For a struct that is thousands
 * of characters, while the answer is often one field; `WindowOptions` is 8,619
 * characters and the `Transparent` field is 72 of them. Sending the whole body
 * fills the caller's token budget with text that does not answer anything.
 *
 * A snippet keeps the declaration line, the lines around the match (with their
 * comments), and the paragraph that mentions the query. Small declarations are
 * returned unchanged so a normal answer keeps its context.
 */

import type { Section } from "./sections.ts";

/** Above this many characters, a section is sliced instead of sent whole. */
export const SNIPPET_THRESHOLD = 900;

/** Characters of prose kept around a match. */
const PROSE_BUDGET = 320;

/** How many code lines on each side of a match inside a block. */
const CONTEXT_LINES = 3;

/**
 * The first line matching the most specific term.
 *
 * A question carries throwaway words ("window" in "make a window
 * transparent") and specific ones ("transparent"). Matching the first term in
 * the list would anchor on the throwaway one and slice around an unrelated
 * line. Longer terms are the more specific ones here: an API name or a field
 * name is longer than the noun it sits next to.
 */
function firstMatch(lines: string[], terms: string[]): number {
  const ordered = [...terms].sort((a, b) => b.length - a.length);
  for (const term of ordered) {
    const at = lines.findIndex((line) => line.toLowerCase().includes(term));
    if (at !== -1) return at;
  }
  return -1;
}

/** The paragraph that mentions the most specific term, else the first, capped. */
function paragraph(prose: string, terms: string[]): string {
  const parts = prose.split(/\n{2,}/).filter((part) => part.trim());
  const ordered = [...terms].sort((a, b) => b.length - a.length);
  let chosen = "";
  for (const term of ordered) {
    const found = parts.find((part) => part.toLowerCase().includes(term));
    if (found) {
      chosen = found;
      break;
    }
  }
  if (!chosen) chosen = parts[0] ?? "";
  const text = chosen.trim();
  return text.length > PROSE_BUDGET
    ? `${text.slice(0, PROSE_BUDGET - 1)}…`
    : text;
}

/**
 * The body of a section, cut to what answers the query.
 *
 * The opening fence, the declaration line and the closing fence are always
 * present, so the result stays valid Markdown even when the match is deep
 * inside a block.
 */
export function snippetBody(section: Section, terms: string[]): string {
  const body = section.body;
  // No query terms means no match context to slice around; send the section as
  // it is. A search always has terms, so this only guards direct callers.
  if (terms.length === 0 || body.length <= SNIPPET_THRESHOLD) return body;

  const lines = body.split("\n");
  const open = lines.findIndex((line) => line.trim().startsWith("```go"));
  if (open === -1) return body.slice(0, SNIPPET_THRESHOLD);

  const close = lines.findIndex(
    (line, index) => index > open && line.trim() === "```",
  );
  const code = lines.slice(open + 1, close === -1 ? lines.length : close);
  const prose = close === -1 ? "" : lines.slice(close + 1).join("\n").trim();
  if (code.length === 0) return body.slice(0, SNIPPET_THRESHOLD);

  const signature = code[0].trimEnd();
  const isBlock = /^(type\s+\w+.*\{|const\s*\(|var\s*\()/.test(
    signature.trim(),
  );
  const match = firstMatch(code, terms);

  let kept: string[];
  if (isBlock && match > CONTEXT_LINES) {
    // A field inside a long block: the header, a window around the field
    // (comments included), and the closing delimiter.
    const start = Math.max(1, match - CONTEXT_LINES - 1);
    const end = Math.min(code.length - 1, match + CONTEXT_LINES);
    kept = [
      signature,
      "\t// …",
      ...code.slice(start, end).map((line) => line.trimEnd()),
      code[code.length - 1].trimEnd(),
    ];
  } else if (match >= 0) {
    const start = Math.max(0, match - CONTEXT_LINES);
    const end = Math.min(code.length, match + CONTEXT_LINES + 1);
    kept = code.slice(start, end).map((line) => line.trimEnd());
    if (start > 0) kept.unshift(signature);
  } else {
    kept = code.slice(0, 12).map((line) => line.trimEnd());
    if (code.length > 12) kept.push("\t// …");
  }

  const codePart = ["```go", ...kept, "```"].join("\n");
  const prosePart = paragraph(prose, terms);
  return prosePart ? `${codePart}\n\n${prosePart}` : codePart;
}
