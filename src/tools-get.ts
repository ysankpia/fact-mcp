/**
 * The get tool body, driven by an already-built bundle.
 *
 * Like search, it never fetches: the entry point resolves the library and
 * passes the bundle in, so a fixture drives every branch offline.
 *
 * A `symbol` is a declaration name the caller already knows: "WindowOptions"
 * for a package-level one, "Window.Title" for a method. The lookup matches on
 * `Section.name` and `Section.receiver` — never on the display heading, and
 * never by taking the first section that happens to share a name.
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
  /**
   * The library the caller named. The bundle is already resolved from it, so
   * this is here to keep the call shape the tool received, not to be read.
   */
  library: string;
  /** The declaration to extract, e.g. "WindowOptions" or "Window.Title". */
  symbol?: string;
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

  const want = wanted(args.symbol);
  const all = sections(docText);
  const found = findDeclarations(all, want);

  if (found.matches.length === 1) {
    return text(
      fitToBudget(
        headerText,
        found.matches[0].body,
        maxChars,
        "Raise max_tokens to read the rest.",
      ),
    );
  }

  if (found.matches.length > 1) {
    return text(
      fitToBudget(
        headerText,
        ambiguous(want, found.matches, bundle),
        maxChars,
        "Raise max_tokens to list more, or name one of them with a receiver.",
      ),
    );
  }

  // A field is not a declaration of its own: it lives inside its type's code
  // block. `get(Type.Field)` reads it from there, which is the only way to
  // answer "what is this field's default" without sending the whole struct.
  // A name that is not a field falls through to the declaration miss below,
  // which points at the same-named methods the caller may have meant.
  if (want.receiver) {
    const typeSection = all.find(
      (section) =>
        section.kind === "type" &&
        section.name.toLowerCase() === want.receiver!.toLowerCase(),
    );
    if (typeSection) {
      const field = fieldBlock(typeSection, want.name);
      if (field) {
        return text(
          fitToBudget(
            headerText,
            field,
            maxChars,
            "Raise max_tokens to read the rest.",
          ),
        );
      }
    }
  }

  if (found.suggestions.length > 0) {
    return text(
      fitToBudget(
        headerText,
        missed(want, found, bundle),
        maxChars,
        "Raise max_tokens to list more, or pass a full module path.",
      ),
    );
  }

  const names = all
    .filter((s) => s.kind !== "heading" && s.kind !== "block")
    .slice(0, 50)
    .map((s) => `- ${s.heading}`)
    .join("\n");
  return text(
    `${headerText}No declaration named "${want.written}". Declarations in this package:\n\n${names}`,
  );
}

/** A `symbol` argument taken apart: the name, and the receiver if one is named. */
interface Wanted {
  /** The declaration name, as the caller wrote it. */
  name: string;
  /** The receiver, as the caller wrote it, with type parameters removed. */
  receiver?: string;
  /** The argument as the caller wrote it, trimmed, for echoing back. */
  written: string;
}

/** What the lookup found for one `symbol` argument. */
interface Found {
  /** Declarations that satisfy the argument exactly: one is an answer. */
  matches: Section[];
  /** Declarations sharing the name, when nothing satisfied it exactly. */
  suggestions: Section[];
  /** Whether the package declares a type with the receiver's name. */
  receiverKnown: boolean;
}

/**
 * Take a `symbol` argument apart.
 *
 * "Document.Window" names a method: the last dotted segment is the name and
 * everything before it is the receiver. A bare name has no receiver. Type
 * parameters are dropped from the receiver, because `Section.receiver` stores
 * the base type: "Document[T].Window" and "Document.Window" are the same
 * request.
 */
function wanted(symbol: string): Wanted {
  const written = symbol.trim();
  const dot = written.lastIndexOf(".");
  if (dot < 0) return { name: written, written };
  const receiver = written
    .slice(0, dot)
    .replace(/^\*/, "")
    .replace(/\[.*$/, "")
    .trim();
  // ".Window" names no receiver, so it is a bare name with a stray dot.
  if (!receiver) return { name: written.slice(dot + 1), written };
  return { name: written.slice(dot + 1), receiver, written };
}

/**
 * Select the declaration the caller named.
 *
 * A qualified symbol selects on receiver and name together, so `Page.Window`
 * is the Window method of Page and nothing else. A bare name is only an answer
 * when it is unique: with several declarations behind it, the caller gets them
 * as candidates instead of an arbitrary one.
 */
function findDeclarations(all: Section[], want: Wanted): Found {
  const name = want.name.toLowerCase();
  // A group heading ("Types") is not a declaration, so it never satisfies a
  // symbol: only the fenced declarations and the grouped blocks do.
  const named = candidatesOf(all.filter((section) => matchName(section) === name));

  if (want.receiver === undefined) {
    // In Go an unqualified name refers to the package-level declaration. When
    // `ListenAndServe` is both `func ListenAndServe` and `Server.ListenAndServe`,
    // the bare name means the func — the method always needs a receiver. Only
    // several package-level declarations of the same name are truly ambiguous.
    const atPackageLevel = named.filter((section) => !section.receiver);
    const matches = atPackageLevel.length > 0 ? atPackageLevel : named;
    return { matches, suggestions: named, receiverKnown: false };
  }

  const receiver = want.receiver.toLowerCase();
  const receiverKnown = all.some(
    (section) =>
      section.kind === "type" && section.name.toLowerCase() === receiver,
  );
  return {
    matches: named.filter(
      (section) => section.receiver?.toLowerCase() === receiver,
    ),
    suggestions: named,
    receiverKnown,
  };
}

/** The declarations worth offering as candidates: headings are not symbols. */
function candidatesOf(found: Section[]): Section[] {
  return found.filter((section) => section.kind !== "heading");
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

/** How a caller writes a declaration: "Window.Title" for a method, else the name. */
function symbolOf(section: Section): string {
  if (section.kind === "block") return section.heading;
  return section.receiver
    ? `${section.receiver}.${section.name}`
    : section.name;
}

/**
 * A field inside a type's code block, with the comment lines that document it.
 *
 * Returns the field's markdown, or `undefined` when the section has no code
 * block or no such field. A field line alone often says nothing about the
 * default or the units, so its doc comment is taken along.
 */
function fieldBlock(section: Section, field: string): string | undefined {
  const lines = section.body.split("\n");
  const open = lines.findIndex((line) => line.trim().startsWith("```go"));
  if (open === -1) return undefined;
  const close = lines.findIndex(
    (line, index) => index > open && line.trim() === "```",
  );
  const code = lines.slice(open + 1, close === -1 ? lines.length : close);
  if (code.length < 2) return undefined;

  const body = code.slice(1, -1);
  let at = -1;
  for (let index = 0; index < body.length; index++) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\b/.exec(body[index]);
    if (match && match[1].toLowerCase() === field.toLowerCase()) {
      at = index;
      break;
    }
  }
  if (at === -1) return undefined;

  let start = at;
  while (start > 0 && body[start - 1].trim().startsWith("//")) start--;
  const fieldName = body[at].trim().split(/\s+/)[0];
  const kept = [
    code[0].trimEnd(),
    ...body.slice(start, at + 1).map((line) => line.trimEnd()),
    code[code.length - 1].trimEnd(),
  ];
  return `### ${section.name}.${fieldName} (field)\n\n\`\`\`go\n${kept.join("\n")}\n\`\`\``;
}

/**
 * A candidate as one line: the symbol to pass back, its kind, and the first
 * line of its prose, so the caller can tell them apart without being handed a
 * declaration they did not ask for.
 */
function candidate(section: Section): string {
  const symbol = symbolOf(section);
  if (section.kind === "block") return `- ${symbol}`;
  const gist = prose(section);
  return `- ${symbol} (${section.kind})${gist ? ` — ${gist}` : ""}`;
}

/** The first sentence of a declaration's prose, cut to a readable length. */
function prose(section: Section): string {
  const afterFence = section.body.split("\n```\n")[1]?.trim() ?? "";
  const line = afterFence.split("\n\n").find((part) => part.trim())?.trim() ?? "";
  const sentence = line.split(/(?<=\.)\s/)[0] ?? line;
  return sentence.length > 100 ? `${sentence.slice(0, 97)}…` : sentence;
}

/**
 * The answer when a bare name has several declarations behind it.
 *
 * Picking one would hand the caller a declaration they did not name, so the
 * response names the ambiguity and lists what to choose from.
 */
function ambiguous(want: Wanted, matches: Section[], bundle: ResolvedBundle) {
  // The suggestion must name a declaration the caller could not already have
  // named: a package-level declaration's own symbol is the bare name, so
  // suggesting it repeats the ambiguous call that produced this answer. Prefer
  // a receiver-qualified one, which is reachable in one call.
  const suggestion =
    matches.find(
      (m) => symbolOf(m).toLowerCase() !== want.name.toLowerCase(),
    ) ?? undefined;
  return [
    `"${want.name}" names ${matches.length} declarations in this package, so it is ambiguous. Pick one:`,
    "",
    ...matches.map(candidate),
    "",
    suggestion
      ? `Call get(library="${bundle.module.path}", symbol="${symbolOf(suggestion)}"), or name another of them with its receiver.`
      : `Name one with its receiver, e.g. symbol="Type.${want.name}".`,
  ].join("\n");
}

/**
 * The answer when a qualified symbol does not exist.
 *
 * The receiver is the part that failed, so the response says which part and
 * offers the declarations that really carry the name — a caller who asked for
 * `Application.Title` is one edit away from `Window.Title`, not from any
 * declaration named Title.
 */
function missed(want: Wanted, found: Found, bundle: ResolvedBundle): string {
  const reason = found.receiverKnown
    ? `"${want.receiver}" has no declaration named ${want.name}.`
    : `This package has no type named "${want.receiver}".`;
  return [
    `No declaration named "${want.written}". ${reason}`,
    "",
    `The declarations named ${want.name} are:`,
    "",
    ...found.suggestions.map(candidate),
    "",
    `Call get(library="${bundle.module.path}", symbol="${symbolOf(found.suggestions[0])}") to read one of them.`,
  ].join("\n");
}
