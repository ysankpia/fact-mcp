#!/usr/bin/env node
/**
 * fact — current official library documentation for agents.
 *
 * Two tools, no local database:
 *   search  resolve a library name and return the passages that answer a query
 *   get     fetch one page or one symbol at full fidelity
 *
 * Every call reads the official source through a stateless proxy. A process
 * local cache with a short TTL avoids re-downloading within a session; nothing
 * is written to disk and nothing survives a restart.
 */

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

import { cacheStats } from "./cache.ts";
import {
  candidateLines,
  goBundle,
  mode,
  type GoBundle,
  type GoModule,
} from "./go.ts";

const CHARS_PER_TOKEN = 4;

function text(body: string) {
  return { content: [{ type: "text" as const, text: body }] };
}

function failure(body: string) {
  return { content: [{ type: "text" as const, text: body }], isError: true };
}

/** Split a Markdown document into heading-delimited sections. */
interface Section {
  heading: string;
  level: number;
  body: string;
}

/**
 * Split pkg.go.dev Markdown into searchable sections.
 *
 * The API emits `##` groups (Constants, Functions, Types) and then one fenced
 * ```go block per declaration followed by its prose. There are no per-symbol
 * headings, so a declaration block starts a new section whose heading is the
 * declaration itself, e.g. "func (a *Application) Hide()".
 */
function sections(markdown: string): Section[] {
  const lines = markdown.split("\n");
  const out: Section[] = [];

  let group: { heading: string; level: number } | null = null;
  let current: Section | null = null;
  let buffer: string[] = [];
  let inFence = false;
  let fenceStart = -1;

  const flush = () => {
    if (current) out.push({ ...current, body: buffer.join("\n").trim() });
    buffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Track fenced code so a `#` inside a Go comment is not a heading.
    if (trimmed.startsWith("```")) {
      if (!inFence) {
        inFence = true;
        fenceStart = i;
        const fenceLang = trimmed.slice(3).trim();
        const first = lines[i + 1]?.trim() ?? "";
        // A Go declaration fence opens a new section for that declaration.
        if (fenceLang === "go" && /^(type|func|const|var)\b/.test(first)) {
          flush();
          current = {
            heading: declarationName(lines, i + 1),
            level: 3,
            body: "",
          };
          buffer = [line];
        } else if (current) {
          buffer.push(line);
        }
      } else {
        inFence = false;
        if (current) buffer.push(line);
      }
      continue;
    }

    if (!inFence) {
      const m = /^(#{1,4})\s+(.*)$/.exec(line);
      if (m) {
        flush();
        group = { heading: m[2].trim(), level: m[1].length };
        current = { heading: group.heading, level: group.level, body: "" };
        continue;
      }
    }

    if (current) buffer.push(line);
  }
  flush();

  if (out.length === 0 && markdown.trim()) {
    out.push({ heading: "document", level: 1, body: markdown.trim() });
  }
  return out;
}

/** Derive a short display name from a Go declaration line. */
function declarationName(lines: string[], index: number): string {
  for (let i = index; i < Math.min(index + 4, lines.length); i++) {
    const line = lines[i].trim();
    const funcMatch = /^func\s+(\([^)]*\)\s*)?([A-Za-z0-9_]+)/.exec(line);
    if (funcMatch) {
      return funcMatch[1]
        ? `${funcMatch[2]} (method)`
        : `${funcMatch[2]} (func)`;
    }
    const typeMatch = /^type\s+([A-Za-z0-9_]+)/.exec(line);
    if (typeMatch) return `${typeMatch[1]} (type)`;
    const constMatch = /^(const|var)\s+([A-Za-z0-9_]+)/.exec(line);
    if (constMatch) return `${constMatch[2]} (${constMatch[1]})`;
    if (/^(const|var)\s*\(/.test(line)) return `${line.split(/\s/)[0]} block`;
  }
  return lines[index]?.trim().slice(0, 60) ?? "declaration";
}

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9_.]+/)
    .filter((t) => t.length > 1);
}

function scoreSection(section: Section, terms: string[]): number {
  const heading = section.heading.toLowerCase();
  const body = section.body.toLowerCase();
  let score = 0;

  for (const term of terms) {
    // A heading hit means this section is about the term; body hits alone are
    // usually incidental mentions (a "window" mentioned in an unrelated method).
    if (heading.includes(term)) score += 40;
    let idx = 0;
    let hits = 0;
    while ((idx = body.indexOf(term, idx)) !== -1 && hits < 8) {
      hits++;
      idx += term.length;
    }
    score += hits * 2;
  }

  // Whole types rank above individual methods, which are numerous and rarely
  // the answer on their own.
  if (heading.endsWith("(type)")) score += 8;
  else if (heading.endsWith("(func)")) score += 4;

  return score;
}

function truncate(
  body: string,
  maxChars: number,
): { body: string; cut: number } {
  if (body.length <= maxChars) return { body, cut: 0 };
  return { body: body.slice(0, maxChars), cut: body.length - maxChars };
}

function truncationNote(cut: number, total: number, nextStep: string): string {
  if (cut <= 0) return "";
  return `\n\n---\nTruncated ${cut} of ${total} characters. ${nextStep}`;
}

/** A library reference resolved to one ecosystem and one canonical id. */
/** A library reference resolved to one module. */
interface Resolved {
  ecosystem: "go";
  id: string;
  module: GoModule;
  bundle: GoBundle;
}

/**
 * Resolve a library and fetch its material in one round trip.
 *
 * The proxy owns name resolution (GitHub star order beats pkg.go.dev's own
 * ranking, which buries a popular module under same-named forks) and every
 * upstream fetch. This side only decides what to present.
 */
async function resolveBundle(
  name: string,
  version?: string,
  page?: string,
  want: "overview" | "docs" = "docs",
): Promise<
  | { ok: true; value: Resolved }
  | { ok: false; candidates: string[]; via: string }
> {
  const bundle = await goBundle({ name, version, page, want });

  if (!bundle.module) {
    return {
      ok: false,
      via: bundle.via,
      candidates: candidateLines(bundle),
    };
  }

  return {
    ok: true,
    value: {
      ecosystem: "go",
      id: bundle.module.path,
      module: bundle.module,
      bundle,
    },
  };
}

/** Build a compact overview from an already-fetched bundle. */
function overview(resolved: Resolved): string {
  const { module, bundle } = resolved;
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

/** Explain why a name did not resolve, with a next step. */
function unresolved(name: string, via: string, candidates: string[]) {
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

async function searchDocs(args: {
  query?: string;
  library?: string;
  version?: string;
  topic?: string;
  max_tokens: number;
}): Promise<ReturnType<typeof text> | ReturnType<typeof failure>> {
  const maxChars = args.max_tokens * CHARS_PER_TOKEN;
  const query = (args.query ?? "").trim();
  const libraryName = (args.library ?? "").trim();

  if (!query && !libraryName) {
    return failure(
      'Provide a query, a library name, or both. Example: search(query="create a window", library="mygo").',
    );
  }

  // Without a library name, the query itself is the name to resolve.
  const name = libraryName || query;
  const want =
    query && libraryName ? "docs" : libraryName ? "overview" : "overview";
  const r = await resolveBundle(name, args.version, undefined, want);
  if (!r.ok) return unresolved(name, r.via, r.candidates);
  const resolved = r.value;

  // A bare library name with no query is an overview request.
  if (!query) return text(overview(resolved));

  const terms = tokens(`${query} ${args.topic ?? ""}`);
  const doc = resolved.bundle.docs;
  const pkg = resolved.bundle.primaryPackage ?? resolved.module.path;

  if (!doc || !doc.markdown.trim()) {
    return text(
      [
        `library: ${resolved.module.path}`,
        `version: ${resolved.module.version}`,
        `package: ${pkg}`,
        "",
        "This package has no godoc text (it may be a command or an empty root). Here is the module overview instead:",
        "",
        overview(resolved),
      ].join("\n"),
    );
  }

  const docText = doc.markdown;

  const ranked = sections(docText)
    .map((section) => ({ section, score: scoreSection(section, terms) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  const header = [
    `library: ${resolved.module.path}`,
    `version: ${doc.version}`,
    `package: ${pkg}`,
    `source: https://pkg.go.dev/${pkg}@${doc.version}`,
    "",
  ].join("\n");

  if (ranked.length === 0) {
    const map = sections(docText)
      .filter((s) => s.level <= 2)
      .map((s) => `- ${s.heading}`)
      .join("\n");
    return text(
      `${header}No section matched "${query}". Document map:\n\n${map}\n\nNarrow with topic, or call get(library="${resolved.module.path}", symbol="Name").`,
    );
  }

  const chunks: string[] = [];
  let used = header.length;
  for (const { section } of ranked) {
    const piece = `${"#".repeat(Math.min(section.level, 4))} ${section.heading}\n\n${section.body}`;
    if (used + piece.length > maxChars) {
      const room = maxChars - used;
      if (room > 400) {
        const { body } = truncate(piece, room);
        chunks.push(body);
        used += body.length;
      }
      break;
    }
    chunks.push(piece);
    used += piece.length;
  }

  const remaining = ranked.length - chunks.length;
  const nextStep =
    remaining > 0
      ? `Narrow with topic="${args.topic ?? query}", or call get(library="${resolved.module.path}", symbol="Name").`
      : "";

  return text(
    `${header}${chunks.join("\n\n")}${
      remaining > 0
        ? `\n\n---\n${remaining} more matching section(s) not shown. ${nextStep}`
        : ""
    }`,
  );
}

async function getDocs(args: {
  library: string;
  symbol?: string;
  page?: string;
  version?: string;
  max_tokens: number;
}): Promise<ReturnType<typeof text> | ReturnType<typeof failure>> {
  const maxChars = args.max_tokens * CHARS_PER_TOKEN;
  const r = await resolveBundle(args.library, args.version, args.page, "docs");
  if (!r.ok) return unresolved(args.library, r.via, r.candidates);

  const { module, bundle } = r.value;
  const pkg = bundle.primaryPackage ?? module.path;
  const doc = bundle.docs;
  const docText = doc?.markdown ?? "";

  const header = [
    `library: ${module.path}`,
    `version: ${doc?.version ?? module.version}`,
    `package: ${pkg}`,
    `source: https://pkg.go.dev/${pkg}@${doc?.version ?? module.version}`,
    "",
  ].join("\n");

  if (!docText.trim()) {
    const available = bundle.packages
      .filter((p) => p.synopsis)
      .slice(0, 20)
      .map((p) => `- ${p.path} — ${p.synopsis}`)
      .join("\n");
    return text(
      `${header}No godoc text for ${pkg}.${bundle.docsError ? `\n\nFetch failed: ${bundle.docsError}` : ""}\n\nAvailable packages:\n\n${available}`,
    );
  }

  if (!args.symbol) {
    const { body, cut } = truncate(docText, maxChars);
    return text(
      `${header}${body}${truncationNote(
        cut,
        docText.length,
        `Pass symbol="Name" or page="<package path>" to fetch a narrower slice.`,
      )}`,
    );
  }

  // Section headings are declaration names such as "Hide (method)" or
  // "Application (type)". Accept "Hide", "Application.Hide" and "Type.Method".
  const needle = args.symbol.toLowerCase().trim();
  const wanted = needle.includes(".") ? needle.split(".").pop()! : needle;
  const all = sections(docText);

  const matches = all.filter((s) => {
    const name = s.heading
      .toLowerCase()
      .replace(/\s*\((type|func|method|const|var|block)\)$/, "");
    return name === wanted || name === needle;
  });

  if (matches.length === 0) {
    const names = all
      .filter((s) => /\((type|func|method|const|var|block)\)$/.test(s.heading))
      .slice(0, 50)
      .map((s) => `- ${s.heading}`)
      .join("\n");
    return text(
      `${header}No declaration named "${args.symbol}". Declarations in this package:\n\n${names}`,
    );
  }

  const section = matches[0];
  const { body, cut } = truncate(section.body, maxChars);
  return text(
    `${header}${body}${truncationNote(cut, section.body.length, "Raise max_tokens to read the rest.")}`,
  );
}

function createServer(): McpServer {
  const server = new McpServer({ name: "fact", version: "0.1.0" });

  server.registerTool(
    "search",
    {
      description:
        "Find current official documentation for a library and return the passages that answer a query. " +
        "Resolves the library name automatically; when the name is ambiguous it returns the candidates to choose from. " +
        "Call with only `library` to get a version and package overview. Prefer this over guessing an API from memory.",
      inputSchema: z.object({
        query: z
          .string()
          .optional()
          .describe(
            'What you need, in words or API names, e.g. "create a native window" or "Limiter.Wait".',
          ),
        library: z
          .string()
          .optional()
          .describe(
            'Library name or Go module path, e.g. "mygo" or "github.com/egoist/mygo".',
          ),
        version: z
          .string()
          .optional()
          .describe('Module version such as "v0.8.3". Default: latest.'),
        topic: z
          .string()
          .optional()
          .describe(
            'Narrow the search to one area or symbol, e.g. "ui" or "Column".',
          ),
        max_tokens: z
          .number()
          .int()
          .min(500)
          .max(20000)
          .optional()
          .describe("Response budget. Default 6000."),
      }),
    },
    async ({ query, library, version, topic, max_tokens }) =>
      searchDocs({
        query,
        library,
        version,
        topic,
        max_tokens: max_tokens ?? 6000,
      }),
  );

  server.registerTool(
    "get",
    {
      description:
        "Fetch one documentation page or one symbol from the official source, at full fidelity. " +
        "Use after search when you know the exact symbol or package you need.",
      inputSchema: z.object({
        library: z
          .string()
          .describe('Library name or Go module path, e.g. "mygo".'),
        symbol: z
          .string()
          .optional()
          .describe('Symbol to extract, e.g. "Column" or "Limiter.Wait".'),
        page: z
          .string()
          .optional()
          .describe(
            'Package path to read instead of the module default, e.g. "github.com/egoist/mygo/ui".',
          ),
        version: z
          .string()
          .optional()
          .describe("Module version. Default: latest."),
        max_tokens: z
          .number()
          .int()
          .min(500)
          .max(25000)
          .optional()
          .describe("Response budget. Default 8000."),
      }),
    },
    async ({ library, symbol, page, version, max_tokens }) =>
      getDocs({
        library,
        symbol,
        page,
        version,
        max_tokens: max_tokens ?? 8000,
      }),
  );

  return server;
}

const stats = cacheStats();
console.error(
  `fact ready (mode ${mode()}, ttl ${Math.round(stats.ttlMs / 1000)}s, max ${stats.max} entries)`,
);

void serveStdio(createServer);
