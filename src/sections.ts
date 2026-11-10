/**
 * Sectioning: split pkg.go.dev Markdown into searchable sections.
 *
 * The API emits `##` groups (Constants, Variables, Functions, Types) and then
 * one fenced ```go block per declaration followed by its prose. There are no
 * per-symbol headings, so a declaration block starts a section of its own.
 *
 * A declaration's display heading is a rendering ("Window (method)") of three
 * separate facts: its name, its kind and, for a method, its receiver. They are
 * kept apart here so callers match on the fields instead of parsing the
 * heading back out.
 */

/** What a fenced declaration is. */
export type DeclarationKind =
  | "type"
  | "func"
  | "method"
  | "const"
  | "var"
  | "block";

/** What a section is: a declaration, or a group heading with no declaration. */
export type SectionKind = DeclarationKind | "heading";

/** One searchable unit of pkg.go.dev Markdown. */
export interface Section {
  /** Display heading, e.g. "Window (method)", "Types" or "package mygo". */
  heading: string;
  /** Heading depth: 1 for the package doc, 2 for a group, 3 for a declaration. */
  level: number;
  /** The fenced block and the prose that follows it. */
  body: string;
  /** Bare symbol name, e.g. "Window". For a group heading, the heading text. */
  name: string;
  kind: SectionKind;
  /** Receiver's base type for a method: "Page" for `func (p *Page) Window()`. */
  receiver?: string;
}

/** The declaration a fenced block starts, as fields rather than a string. */
interface Declaration {
  name: string;
  kind: DeclarationKind;
  receiver?: string;
  /** How the heading renders, e.g. "Window (method)". */
  display: string;
}

/**
 * Read the declaration starting at `index`, which is the fence's first line.
 *
 * pkg.go.dev always puts the declaration on that line, but a wrapped signature
 * can push the name a line or two down, so a few lines are scanned.
 */
function declaration(lines: string[], index: number): Declaration {
  for (let i = index; i < Math.min(index + 4, lines.length); i++) {
    const line = lines[i].trim();

    const funcMatch = /^func\s+(\([^)]*\)\s*)?([A-Za-z0-9_]+)/.exec(line);
    if (funcMatch) {
      if (!funcMatch[1]) {
        return {
          name: funcMatch[2],
          kind: "func",
          display: `${funcMatch[2]} (func)`,
        };
      }
      const receiver = receiverType(funcMatch[1]);
      return {
        name: funcMatch[2],
        kind: "method",
        receiver,
        display: `${funcMatch[2]} (method)`,
      };
    }

    const typeMatch = /^type\s+([A-Za-z0-9_]+)/.exec(line);
    if (typeMatch) {
      return {
        name: typeMatch[1],
        kind: "type",
        display: `${typeMatch[1]} (type)`,
      };
    }

    const constMatch = /^(const|var)\s+([A-Za-z0-9_]+)/.exec(line);
    if (constMatch) {
      const kind = constMatch[1] as "const" | "var";
      return {
        name: constMatch[2],
        kind,
        display: `${constMatch[2]} (${kind})`,
      };
    }

    // A grouped `const (` or `var (` block has no name of its own.
    const blockMatch = /^(const|var)\s*\(/.exec(line);
    if (blockMatch) {
      const keyword = blockMatch[1];
      return { name: keyword, kind: "block", display: `${keyword} block` };
    }
  }

  // A shape none of the above describe: keep the old fallback text so the
  // heading stays readable, and label it by its keyword when it has one.
  const first = lines[index]?.trim() ?? "";
  const keyword = /^(type|func|const|var)\b/.exec(first)?.[1];
  const display = first.slice(0, 60) || "declaration";
  return {
    name: display,
    kind: (keyword as DeclarationKind | undefined) ?? "block",
    display,
  };
}

/**
 * The base type of a Go receiver: `(p *Page)` is "Page", `(b WindowButtons)`
 * is "WindowButtons", `(d *Document[T])` is "Document" without its parameters.
 */
function receiverType(group: string): string {
  const inside = group.slice(1, group.lastIndexOf(")")).trim();
  const parts = inside.split(/\s+/);
  const type = parts[parts.length - 1];
  return type.replace(/^\*/, "").replace(/\[.*$/, "");
}

/**
 * Split pkg.go.dev Markdown into sections.
 *
 * A `##` group heading starts a section holding its prose; each declaration
 * fence starts a new section holding that declaration and its prose.
 */
export function sections(markdown: string): Section[] {
  const lines = markdown.split("\n");
  const out: Section[] = [];

  let current: Section | null = null;
  let buffer: string[] = [];
  let inFence = false;

  const flush = () => {
    if (current) out.push({ ...current, body: buffer.join("\n").trim() });
    buffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Track fenced code so a `#` inside a Go comment is not read as a heading.
    if (trimmed.startsWith("```")) {
      if (!inFence) {
        inFence = true;
        const fenceLang = trimmed.slice(3).trim();
        const first = lines[i + 1]?.trim() ?? "";
        // A Go declaration fence opens a section for that declaration.
        if (fenceLang === "go" && /^(type|func|const|var)\b/.test(first)) {
          flush();
          const decl = declaration(lines, i + 1);
          current = {
            heading: decl.display,
            level: 3,
            body: "",
            name: decl.name,
            kind: decl.kind,
            receiver: decl.receiver,
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
        const heading = m[2].trim();
        current = {
          heading,
          level: m[1].length,
          body: "",
          name: heading,
          kind: "heading",
        };
        continue;
      }
    }

    if (current) buffer.push(line);
  }
  flush();

  if (out.length === 0 && markdown.trim()) {
    out.push({
      heading: "document",
      level: 1,
      body: markdown.trim(),
      name: "document",
      kind: "heading",
    });
  }
  return out;
}
