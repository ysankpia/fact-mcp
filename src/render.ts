/**
 * Render: turn a bundle and a set of sections into the text a caller reads.
 *
 * Everything here is pure. It decides wording, ordering and where a response
 * is cut, and it never fetches: the tools hand it a bundle they already have.
 *
 * The assembly and the arithmetic are today's, moved rather than rewritten, so
 * the split changes no behaviour. Where that behaviour is wrong, the comment
 * says so and names the sibling ticket that changes it.
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

/**
 * Cut a body to a character budget.
 *
 * CURRENT BEHAVIOUR, NOT INTENDED: the cut lands at an arbitrary offset, so it
 * can split a word or a fenced block. A sibling ticket fixes it.
 */
export function truncate(
  body: string,
  maxChars: number,
): { body: string; cut: number } {
  if (body.length <= maxChars) return { body, cut: 0 };
  return { body: body.slice(0, maxChars), cut: body.length - maxChars };
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
 * The provenance lines every response starts with: library, doc version,
 * package and the pkg.go.dev URL the answer came from.
 */
export function header(bundle: ResolvedBundle): string {
  const module = bundle.module;
  const pkg = bundle.primaryPackage ?? module.path;
  const version = bundle.docs?.version ?? module.version;
  return [
    `library: ${module.path}`,
    `version: ${version}`,
    `package: ${pkg}`,
    `source: https://pkg.go.dev/${pkg}@${version}`,
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

/** The response for a query that matched no section. */
export function noMatch(
  headerText: string,
  query: string,
  map: string,
  library: string,
): string {
  return `${headerText}No section matched "${query}". Document map:\n\n${map}\n\nNarrow with topic, or call get(library="${library}", symbol="Name").`;
}

/** A section as it appears in a search response. */
function piece(section: Section): string {
  return `${"#".repeat(Math.min(section.level, 4))} ${section.heading}\n\n${section.body}`;
}

/**
 * Pack sections into a character budget, best-ranked first.
 *
 * `used` starts at the header's length because the header is always sent. The
 * first section that does not fit is cut at the remaining room when that room
 * is more than 400 characters, and packing stops there.
 */
export function sectionChunks(
  ranked: Section[],
  maxChars: number,
  used: number,
): { chunks: string[]; used: number } {
  const chunks: string[] = [];
  for (const section of ranked) {
    const rendered = piece(section);
    if (used + rendered.length > maxChars) {
      const room = maxChars - used;
      if (room > 400) {
        const { body } = truncate(rendered, room);
        chunks.push(body);
        used += body.length;
      }
      break;
    }
    chunks.push(rendered);
    used += rendered.length;
  }
  return { chunks, used };
}

/** The note that follows a truncated search response. */
export function moreSectionsNote(
  remaining: number,
  nextStep: string,
): string {
  if (remaining <= 0) return "";
  return `\n\n---\n${remaining} more matching section(s) not shown. ${nextStep}`;
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
    module.repoUrl ? `repo: ${module.repoUrl}` : "",
    "",
    "## Versions",
    ...bundle.versions.map(
      (v) =>
        `- ${v.version}${v.isLatest ? " (latest)" : ""}${v.deprecated ? " (deprecated)" : ""}${v.retracted ? " (retracted)" : ""} — ${v.commitTime.slice(0, 10)}`,
    ),
  ];

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

  return lines.filter((l) => l !== "").join("\n");
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
