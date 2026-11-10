/**
 * Sectioning of pkg.go.dev Markdown.
 *
 * The fixture is a trimmed excerpt of a real
 * `pkg.go.dev/v1/package/github.com/egoist/mygo?doc=markdown` response, so the
 * suite runs offline and still exercises the shapes the API really emits: a
 * declaration fence per symbol, `##` groups, and a `#` inside a Go comment.
 */

import { describe, expect, test } from "bun:test";

import { sections } from "../src/sections.ts";

const fixture = await Bun.file(
  new URL("./fixtures/mygo.md", import.meta.url),
).text();

const fixtureSections = sections(fixture);

/**
 * The section whose fenced block declares `declaration`, e.g.
 * `func (p *Page) Window()`. The body starts with the fence, so the
 * declaration is its second line.
 */
function sectionFor(declaration: string) {
  const found = fixtureSections.filter(
    (s) => s.body.split("\n")[1]?.trim() === declaration,
  );
  expect(found.length).toBeGreaterThan(0);
  return found[0];
}

describe("sections: headings", () => {
  test("a heading-only group becomes its own section at its own level", () => {
    const types = fixtureSections.find((s) => s.heading === "Types");
    expect(types?.level).toBe(2);
    expect(types?.kind).toBe("heading");
  });

  test("the package doc heading is level 1", () => {
    expect(fixtureSections[0].heading).toBe("package mygo");
    expect(fixtureSections[0].level).toBe(1);
  });

  test("every declaration section is level 3", () => {
    const declarations = fixtureSections.filter((s) => s.kind !== "heading");
    expect(declarations.length).toBeGreaterThan(10);
    for (const section of declarations) expect(section.level).toBe(3);
  });
});

describe("sections: declarations carry name, kind and receiver", () => {
  test("a type exposes its name and kind", () => {
    const section = sectionFor("type Window struct {");
    expect(section.name).toBe("Window");
    expect(section.kind).toBe("type");
    expect(section.receiver).toBeUndefined();
  });

  test("a package-level func has no receiver", () => {
    const section = sectionFor("func NewWindow(opts WindowOptions) *Window");
    expect(section.name).toBe("NewWindow");
    expect(section.kind).toBe("func");
    expect(section.receiver).toBeUndefined();
  });

  test("a pointer-receiver method exposes its receiver", () => {
    const section = sectionFor("func (p *Page) Window() *Window");
    expect(section.name).toBe("Window");
    expect(section.kind).toBe("method");
    expect(section.receiver).toBe("Page");
  });

  test("a value-receiver method exposes its receiver", () => {
    const section = sectionFor("func (b WindowButtons) Empty() bool");
    expect(section.name).toBe("Empty");
    expect(section.kind).toBe("method");
    expect(section.receiver).toBe("WindowButtons");
  });

  test("a generic receiver reports its base type, not its type parameters", () => {
    const section = sectionFor("func (d *Document[T]) Window() *Window");
    expect(section.name).toBe("Window");
    expect(section.kind).toBe("method");
    expect(section.receiver).toBe("Document");
  });

  test("three declarations named Window stay distinguishable by receiver", () => {
    // This is the point of the structured fields: today's display heading is
    // "Window (method)" for all three, so `get` cannot tell them apart.
    const windows = fixtureSections.filter(
      (s) => s.name === "Window" && s.kind === "method",
    );
    expect(windows.map((s) => s.receiver).sort()).toEqual([
      "Document",
      "Page",
      "WebView",
    ]);
  });

  test("a grouped const block is a block named after its keyword", () => {
    const section = sectionFor("const (");
    expect(section.kind).toBe("block");
    expect(section.name).toBe("const");
  });

  test("a grouped var block is a block", () => {
    const section = sectionFor("var (");
    expect(section.kind).toBe("block");
    expect(section.name).toBe("var");
  });

  test("a single var is a var, not a block", () => {
    const section = sectionFor(
      "var App = &Application{readyCh: make(chan struct{}), Dock: &Dock{}, JumpList: &JumpList{}}",
    );
    expect(section.name).toBe("App");
    expect(section.kind).toBe("var");
  });

  test("an interface type is a type", () => {
    const section = sectionFor("type WindowStateStore interface {");
    expect(section.name).toBe("WindowStateStore");
    expect(section.kind).toBe("type");
  });
});

describe("sections: fences", () => {
  test("a declaration section keeps its fence and the prose that follows it", () => {
    const section = sectionFor("func (w *Window) Hide()");
    expect(section.body.startsWith("```go\n")).toBe(true);
    expect(section.body).toContain("\n```\n\n");
    // The prose comes after the closing fence, so the section is the whole
    // declaration entry: signature, body and description.
    expect(section.body).toContain("\n```\n\nHide hides the window.");
  });

  test("a # inside a Go comment does not start a section", () => {
    const section = sectionFor("type WindowOptions struct {");
    expect(section.body).toContain('"#1e1e1e"');
    expect(fixtureSections.some((s) => s.heading.startsWith("#"))).toBe(false);
  });
});

describe("sections: edge cases", () => {
  test("empty markdown yields no sections", () => {
    expect(sections("")).toEqual([]);
    expect(sections("   \n\n")).toEqual([]);
  });

  test("markdown with no heading or fence is one document section", () => {
    const out = sections("Just prose, no structure.\n");
    expect(out).toHaveLength(1);
    expect(out[0].heading).toBe("document");
    expect(out[0].level).toBe(1);
    expect(out[0].body).toBe("Just prose, no structure.");
  });
});
