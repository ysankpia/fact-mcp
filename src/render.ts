/**
 * Render: turn a bundle and a set of sections into the text a caller reads.
 *
 * Everything here is pure. It decides wording, ordering and where a response
 * is cut, and it never fetches: the tools hand it a bundle they already have.
 *
 * The budget is enforced here, on the whole response, header and footer
 * included, so a caller that asked for `max_tokens` gets at most that many
 * tokens of text. A cut inside a fenced block is closed before returning, so
 * the Markdown stays parseable.
 */

import type { CallToolResult } from "@modelcontextprotocol/server";

import type { GoBundle, GoModule } from "./orchestrator.ts";
import type { Section } from "./sections.ts";

/**
 * A bundle that resolved to a module.
 *
 * Resolution failure is the entry point's business: it answers with candidates
 * or an explanation before any of these modules run. Everything downstream can
 * therefore rely on `module` being there, and the presentation code stays free
 * of optional chaining on the one field it always needs.
 */
export type ResolvedBundle = GoBundle & { module: GoModule };

/** The four-characters-per-token estimate the `max_tokens` budgets use. */
export const CHARS_PER_TOKEN = 4;

/** A tool result: text content, optionally flagged as a tool failure. */
export type TextResult = CallToolResult;

/** A tool result carrying text. */
export function text(body: string): TextResult {
  return { content: [{ type: "text" as const, text: body }] };
}

/** A tool result carrying text, flagged as a tool failure. */
export function failure(body: string): TextResult {
  return { content: [{ type: "text" as const, text: body }], isError: true };
}

/** How much of the room a line boundary must keep to be preferred. */
const MIN_BOUNDARY_FILL = 0.6;

/** The characters that close a fence the cut landed inside. */
const FENCE_CLOSER = "\n```";

/** The number of ``` markers in a text. */
function fences(text: string): number {
  return text.split("```").length - 1;
}

/**
 * The length of the longest prefix of `body` that fits `limit` characters.
 *
 * A line boundary is preferred only when it keeps most of the room: giving up
 * two fifths of the budget to land on a newline shows the caller less for no
 * gain in legibility.
 */
function cutPoint(body: string, limit: number): number {
  if (limit <= 0) return 0;
  if (limit >= body.length) return body.length;
  const boundary = body.lastIndexOf("\n", limit - 1);
  if (boundary >= 0) {
    const candidate = boundary + 1; // keep the newline that ends the line
    if (candidate >= limit * MIN_BOUNDARY_FILL) return candidate;
  }
  return limit;
}

/**
 * Cut a body to a character budget, leaving it valid Markdown.
 *
 * The cut prefers a line boundary so a caller does not lose a word, and when
 * it lands inside a fenced block it closes the fence: an agent that parses by
 * ``` would otherwise read the rest of the response as code.
 *
 * `cut` is how much of `body` the result does not carry, so `result.length +
 * cut` is always `body.length` and a footer built from it accounts for the
 * whole original. Both the ceiling and the fence parity hold at every budget:
 * the closer's four characters come out of the body's room, and only a budget
 * too small to close a fence at all falls back to dropping the open one.
 */
export function truncate(
  body: string,
  maxChars: number,
): { body: string; cut: number } {
  if (body.length <= maxChars) return { body, cut: 0 };

  const take = (limit: number) => body.slice(0, cutPoint(body, limit));

  // The second attempt reserves the closer's room. It cannot itself need a
  // third: a prefix cut inside the reserved room always leaves space to close.
  for (const limit of [maxChars, maxChars - FENCE_CLOSER.length]) {
    if (limit <= 0) break;
    const kept = take(limit);
    if (fences(kept) % 2 === 0) {
      return { body: kept, cut: body.length - kept.length };
    }
    if (kept.length + FENCE_CLOSER.length <= maxChars) {
      const closed = kept + FENCE_CLOSER;
      return { body: closed, cut: body.length - closed.length };
    }
  }

  // No prefix fits with a closer. Dropping back to before the fence opened is
  // the only remaining prefix with even parity.
  const open = take(maxChars).lastIndexOf("```");
  const dropped = open < 0 ? "" : body.slice(0, open);
  return { body: dropped, cut: body.length - dropped.length };
}

/** The line that tells a caller a response was cut, and what to do about it. */
export function truncationNote(
  cut: number,
  total: number,
  nextStep: string,
): string {
  if (cut <= 0) return "";
  return `\n\n---\nTruncated ${cut} of ${total} characters. ${nextStep}`;
}

/**
 * Assemble a whole response under a character ceiling.
 *
 * `max_tokens` is a contract the caller budgets against, so the ceiling covers
 * everything that is sent: the provenance header, the body and the truncation
 * footer. The footer is measured first, against the widest cut it could ever
 * report, and its room is taken out of the body's budget before the body is
 * cut. The footer therefore never pushes the total over, and the number it
 * prints is the truth about the body rather than about the room left over.
 *
 * A response that already fits is returned exactly as assembled, byte for
 * byte: nothing is reformatted to make the arithmetic easier.
 *
 * A budget too small to hold the header and a footer gives up the footer
 * rather than the ceiling: the caller is better served by more body and no
 * explanation than by an overrun the contract forbids.
 */
export function fitToBudget(
  headerText: string,
  body: string,
  maxChars: number,
  nextStep: string,
): string {
  const assembled = `${headerText}${body}`;
  if (assembled.length <= maxChars) return assembled;

  // The cut can never exceed the body, so a footer written for that cut is the
  // widest this response will print.
  const widest = truncationNote(body.length, body.length, nextStep).length;
  const room = maxChars - headerText.length - widest;
  if (room < 0) {
    const { body: kept } = truncate(body, Math.max(0, maxChars - headerText.length));
    return `${headerText}${kept}`;
  }

  const { body: kept, cut } = truncate(body, room);
  return `${headerText}${kept}${truncationNote(cut, body.length, nextStep)}`;
}

/**
 * The provenance lines every response starts with: library, doc version,
 * package and the pkg.go.dev URL the answer came from.
 */
export function header(bundle: ResolvedBundle): string {
  const module = bundle.module;
  const pkg = bundle.primaryPackage ?? module.path;
  const version = bundle.docs?.version ?? module.version;
  // A standard-library package has no version in its pkg.go.dev address:
  // encoding/json@v1.27.4 and std@v1.27.4/encoding/json both answer 400, while
  // encoding/json answers 200. A module's address needs the version to pin it.
  const source =
    bundle.via === "stdlib"
      ? `https://pkg.go.dev/${pkg}`
      : `https://pkg.go.dev/${pkg}@${version}`;
  return [
    `library: ${module.path}`,
    `version: ${version}`,
    `package: ${pkg}`,
    `source: ${source}`,
    "",
  ].join("\n");
}

/**
 * The map of a document's group headings, offered when a query matched
 * nothing: it is what a caller reads to pick a better query.
 */
export function documentMap(sections: Section[]): string {
  return sections
    .filter((s) => s.level <= 2)
    .map((s) => `- ${s.heading}`)
    .join("\n");
}

/**
 * The response for a query that matched no section.
 *
 * `topic`, when given, is part of what came back empty: naming only the query
 * would send a caller to change the one argument that did match something.
 * The advice follows the same split — with no topic there is something left to
 * narrow with, with one the caller must change or drop it.
 */
export function noMatch(
  headerText: string,
  query: string,
  map: string,
  library: string,
  topic?: string,
): string {
  return `${headerText}${noMatchBody(query, map, library, topic)}`;
}

/**
 * The no-match response without its provenance header.
 *
 * Separated so a caller can budget the whole response: the header is measured
 * with it, and the footer it would print is known before anything is cut.
 */
export function noMatchBody(
  query: string,
  map: string,
  library: string,
  topic?: string,
): string {
  const scope =
    topic && query
      ? `"${query}" with topic "${topic}"`
      : `"${query || topic || ""}"`;
  const next = topic
    ? `Try another topic, or call get(library="${library}", symbol="Name").`
    : `Narrow with topic, or call get(library="${library}", symbol="Name").`;
  return `No section matched ${scope}. Document map:\n\n${map}\n\n${next}`;
}

/** A section as it appears in a search response. */
function piece(section: Section): string {
  return `${"#".repeat(Math.min(section.level, 4))} ${section.heading}\n\n${section.body}`;
}

/**
 * Pack sections into a character budget, best-ranked first.
 *
 * `used` starts at the header's length because the header is always sent, and
 * it counts the blank line between chunks, so `used` is exactly the length of
 * what the chunks add to the response once joined.
 *
 * The first section that does not fit is cut at the remaining room when that
 * room is more than 400 characters, and packing stops there.
 */
export function sectionChunks(
  ranked: Section[],
  maxChars: number,
  used: number,
): { chunks: string[]; used: number } {
  const chunks: string[] = [];
  for (const section of ranked) {
    const rendered = piece(section);
    const separator = chunks.length > 0 ? SECTION_SEPARATOR.length : 0;
    if (used + separator + rendered.length > maxChars) {
      const room = maxChars - used - separator;
      if (room > MIN_PARTIAL_CHUNK) {
        const { body } = truncate(rendered, room);
        chunks.push(body);
        used += separator + body.length;
      }
      break;
    }
    chunks.push(rendered);
    used += separator + rendered.length;
  }
  return { chunks, used };
}

/** What separates one rendered section from the next. */
const SECTION_SEPARATOR = "\n\n";

/**
 * Room left for a partial section below which cutting is not worth it.
 *
 * A slice shorter than this reads as a fragment with no context, so the packer
 * stops instead and the footer says how to narrow.
 */
const MIN_PARTIAL_CHUNK = 400;

/**
 * A search response: the header, the ranked sections that fit, and a footer
 * when sections had to be left out.
 *
 * The ceiling covers the whole response, so the widest footer this call could
 * print is measured before any section is packed and its room is taken out of
 * the sections' budget. A response that already fits is returned untouched.
 *
 * A budget too small for the header and a footer gives up the footer rather
 * than the ceiling, the same way `fitToBudget` does.
 */
export function sectionsResponse(
  headerText: string,
  ranked: Section[],
  maxChars: number,
  nextStep: string,
): string {
  const full = `${headerText}${ranked.map(piece).join(SECTION_SEPARATOR)}`;
  if (full.length <= maxChars) return full;

  // `remaining` can never exceed the number of ranked sections, so a note
  // written for all of them is the widest this response will print.
  const widest = moreSectionsNote(ranked.length, nextStep).length;
  if (maxChars - headerText.length - widest < 0) {
    const { chunks } = sectionChunks(ranked, maxChars, headerText.length);
    return `${headerText}${chunks.join(SECTION_SEPARATOR)}`;
  }

  const { chunks } = sectionChunks(ranked, maxChars - widest, headerText.length);
  const remaining = ranked.length - chunks.length;
  return `${headerText}${chunks.join(SECTION_SEPARATOR)}${moreSectionsNote(remaining, nextStep)}`;
}

/** The note that follows a truncated search response. */
export function moreSectionsNote(
  remaining: number,
  nextStep: string,
): string {
  if (remaining <= 0) return "";
  return `${SECTION_SEPARATOR}---\n${remaining} more matching section(s) not shown. ${nextStep}`;
}

/**
 * A compact overview of a bundle: versions, packages and what to call next.
 *
 * This is what a caller gets when they name a library and ask nothing: the
 * bundle was fetched with `want: "overview"`, so it carries no Markdown.
 */
export function overview(bundle: ResolvedBundle): string {
  const module = bundle.module;
  const lines: string[] = [
    `library: ${module.path}`,
    `version: ${module.version}`,
    `latest: ${module.isLatest ? "yes" : "no"}`,
    `released: ${module.commitTime}`,
  ];
  if (module.repoUrl) lines.push(`repo: ${module.repoUrl}`);

  // The blank line in front of a heading is what makes Markdown render it;
  // without one a client reads "## Versions" as prose. Only the optional repo
  // line is omitted when absent, so no heading is left with two blank lines or
  // none.
  lines.push(
    "",
    "## Versions",
    ...bundle.versions.map(
      (v) =>
        `- ${v.version}${v.isLatest ? " (latest)" : ""}${v.deprecated ? " (deprecated)" : ""}${v.retracted ? " (retracted)" : ""} — ${v.commitTime.slice(0, 10)}`,
    ),
  );

  const publicPackages = bundle.packages.filter((p) => p.synopsis).slice(0, 12);
  if (publicPackages.length > 0) {
    lines.push("", "## Packages");
    for (const p of publicPackages) {
      lines.push(`- ${p.path} — ${p.synopsis}`);
    }
  }

  lines.push(
    "",
    "## Next",
    `- search(query="...", library="${module.path}") to search the docs`,
    `- get(library="${module.path}", symbol="Type.Method") for one symbol`,
  );

  return lines.join("\n");
}

/**
 * Explain why a name did not resolve, with a next step.
 *
 * `candidates` are the lines a caller chooses from, already formatted.
 */
export function unresolved(
  name: string,
  via: string,
  candidates: string[],
  error?: string,
) {
  // An upstream rejection: a version that does not exist is the common one.
  if (via === "error") {
    const notFound = error?.includes("404");
    const detail = notFound
      ? `"${name}" has no such module or version.`
      : `The lookup failed: ${error}`;
    return failure(
      `${detail}\n\n` +
        `Check the version, or leave it out to get the latest. ` +
        `A full module path such as library="github.com/egoist/mygo" skips name lookup entirely.`,
    );
  }

  // Rate limiting is a transient failure of the tool itself.
  if (via === "github-rate-limited") {
    const known =
      candidates.length > 0
        ? `\n\nCandidates from the Go index:\n\n${candidates.join("\n")}`
        : "";
    return failure(
      `Name lookup is rate-limited right now (GitHub search allows 10 requests a minute without a token). ` +
        `Retry in a minute, or pass a full module path such as library="github.com/egoist/mygo" to skip the lookup.${known}`,
    );
  }

  // A miss or an ambiguous name is a normal answer, not a tool failure: the
  // caller is meant to read it and try again with a more specific name.
  if (candidates.length === 0) {
    return text(
      `No Go module found for "${name}". Pass a full module path, for example library="github.com/egoist/mygo", ` +
        `or an owner/repo pair such as library="gorilla/websocket".`,
    );
  }
  const reason =
    via === "ambiguous"
      ? `Library "${name}" is ambiguous. Choose one and call again with library set to its module path:`
      : `Library "${name}" matched several modules. Choose one:`;
  return text([reason, "", ...candidates].join("\n"));
}
