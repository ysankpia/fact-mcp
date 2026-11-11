/**
 * Snippets: the part of a declaration that answers a query.
 *
 * The fixture is the committed pkg.go.dev Markdown, so these are real bodies:
 * `WindowOptions` is 8,619 characters and one of its fields is the answer to
 * "make a window transparent".
 */

import { describe, expect, test } from "bun:test";

import { sections } from "../src/sections.ts";
import { SNIPPET_THRESHOLD, snippetBody } from "../src/snippet.ts";

const markdown = await Bun.file(
  new URL("./fixtures/mygo.md", import.meta.url),
).text();
const all = sections(markdown);
const windowOptions = all.find((s) => s.name === "WindowOptions")!;
const newWindow = all.find((s) => s.name === "NewWindow")!;

describe("snippetBody", () => {
  test("a small declaration is returned unchanged", () => {
    expect(newWindow.body.length).toBeLessThan(SNIPPET_THRESHOLD);
    expect(snippetBody(newWindow, ["window"])).toBe(newWindow.body);
  });

  test("a large struct is sliced to the field that answers the query", () => {
    const body = snippetBody(windowOptions, ["transparent"]);
    expect(body.length).toBeLessThan(SNIPPET_THRESHOLD);
    expect(body).toContain("type WindowOptions struct {");
    expect(body).toContain("Transparent bool");
    // A field far from the match is not in the snippet.
    expect(body).not.toContain("StateKey");
  });

  test("the fence stays balanced and the snippet is valid Markdown", () => {
    const body = snippetBody(windowOptions, ["transparent"]);
    // Exactly one fence opens and one closes; prose may follow the block.
    expect((body.match(/```/g) ?? []).length).toBe(2);
    expect(body.startsWith("```go")).toBe(true);
  });

  test("a match on the declaration name keeps the head of the block", () => {
    const body = snippetBody(windowOptions, ["windowoptions"]);
    expect(body).toContain("type WindowOptions struct {");
    expect(body).toContain("```go");
    expect(body.length).toBeLessThan(SNIPPET_THRESHOLD);
  });

  test("a query with no terms leaves the section untouched", () => {
    expect(snippetBody(windowOptions, [])).toBe(windowOptions.body);
  });
});
