/**
 * The get tool, driven by a hand-built bundle.
 *
 * The receiver-stripping and first-match behaviour here is today's, defects
 * included: the tests marked CURRENT BEHAVIOUR pin it so a sibling ticket
 * changes it on purpose.
 */

import { describe, expect, test } from "bun:test";

import { getDocs } from "../src/tools-get.ts";
import { FIXTURE_MARKDOWN, bundleWithoutDocs, mygoBundle } from "./support/bundle.ts";

const bundle = mygoBundle();
const body = (result: ReturnType<typeof getDocs>) =>
  (result.content[0] as { type: "text"; text: string }).text;

/** The number of ``` markers, the unit an agent parses a response by. */
const fences = (text: string) => text.split("```").length - 1;

/** The whole response for a call, as a caller receives it. */
const out = (args: Parameters<typeof getDocs>[0]) => body(getDocs(args, bundle));

describe("get: whole page", () => {
  test("no symbol returns the document under the provenance header", () => {
    const text = out({ library: "mygo", max_tokens: 20000 });
    expect(text.startsWith("library: github.com/egoist/mygo\n")).toBe(true);
    expect(text).toContain("source: https://pkg.go.dev/github.com/egoist/mygo@v0.8.3");
    expect(text).toContain("# package mygo");
    // The whole fixture fits, so nothing is truncated.
    expect(text).not.toContain("Truncated");
  });

  test("a small budget cuts the page and says how to read the rest", () => {
    const text = out({ library: "mygo", max_tokens: 500 });
    expect(text).toContain("Truncated");
    expect(text).toContain(
      'Pass symbol="Name" or page="<package path>" to fetch a narrower slice.',
    );
  });

  test("the cut lands on a line boundary, not mid-word", () => {
    const text = out({ library: "mygo", max_tokens: 500 });
    const truncated = text.slice(0, text.indexOf("\n\n---\nTruncated"));
    expect(truncated.endsWith("\n")).toBe(true);
    // A mid-word cut is what this used to do: the fixture's prose continues
    // with "thread", and the cut stopped inside it.
    expect(FIXTURE_MARKDOWN).toContain("thr");
    expect(truncated.endsWith("thr")).toBe(false);
  });

  test("the whole response stays under the ceiling at every budget", () => {
    for (const max_tokens of [500, 2000, 6000, 8000]) {
      const text = out({ library: "mygo", max_tokens });
      expect(text.length).toBeLessThanOrEqual(max_tokens * 4);
    }
  });

  test("a truncated page carries an even number of fence markers", () => {
    for (const max_tokens of [500, 2000, 6000]) {
      const text = out({ library: "mygo", max_tokens });
      expect(fences(text) % 2).toBe(0);
    }
  });
});

describe("get: one declaration", () => {
  test("a type returns its fenced declaration and prose", () => {
    const out = body(
      getDocs({ library: "mygo", symbol: "WindowOptions", max_tokens: 20000 }, bundle),
    );
    expect(out).toContain("```go\ntype WindowOptions struct {");
    expect(out).toContain("WindowOptions configures NewWindow.");
  });

  test("a func returns its declaration", () => {
    const out = body(
      getDocs({ library: "mygo", symbol: "NewWindow", max_tokens: 20000 }, bundle),
    );
    expect(out).toContain("```go\nfunc NewWindow(opts WindowOptions) *Window\n```");
  });

  test("a method returns its declaration", () => {
    const out = body(
      getDocs({ library: "mygo", symbol: "Hide", max_tokens: 20000 }, bundle),
    );
    expect(out).toContain("```go\nfunc (w *Window) Hide()\n```");
    expect(out).toContain("Hide hides the window.");
  });

  test("a qualified Type.Method keeps only the method name", () => {
    const out = body(
      getDocs(
        { library: "mygo", symbol: "Window.Hide", max_tokens: 20000 },
        bundle,
      ),
    );
    expect(out).toContain("```go\nfunc (w *Window) Hide()\n```");
  });

  test("matching is case-insensitive", () => {
    const out = body(
      getDocs({ library: "mygo", symbol: "windowoptions", max_tokens: 20000 }, bundle),
    );
    expect(out).toContain("type WindowOptions struct");
  });

  test("CURRENT BEHAVIOUR, NOT INTENDED: the receiver is stripped and the first match wins", () => {
    // Three declarations are named Window, on Document, Page and WebView. The
    // caller's receiver is thrown away, so every spelling returns the first
    // one in document order: Document.Window. A sibling ticket fixes this.
    const plain = body(
      getDocs({ library: "mygo", symbol: "Window", max_tokens: 20000 }, bundle),
    );
    const forPage = body(
      getDocs({ library: "mygo", symbol: "Page.Window", max_tokens: 20000 }, bundle),
    );
    const forWebView = body(
      getDocs({ library: "mygo", symbol: "WebView.Window", max_tokens: 20000 }, bundle),
    );

    expect(plain).toContain("func (d *Document[T]) Window() *Window");
    expect(forPage).toBe(plain);
    expect(forWebView).toBe(plain);
    // And the receiver the caller asked for is not what came back.
    expect(forPage).not.toContain("func (p *Page) Window() *Window");
  });

  test("a missing symbol lists the declarations in the package", () => {
    const out = body(
      getDocs({ library: "mygo", symbol: "NoSuchSymbolXyz", max_tokens: 20000 }, bundle),
    );
    expect(out).toContain('No declaration named "NoSuchSymbolXyz"');
    expect(out).toContain("- WindowOptions (type)");
    expect(out).toContain("- Hide (method)");
    // Group headings are not declarations.
    expect(out).not.toContain("- Types");
  });

  test("a truncated declaration says how to read the rest", () => {
    const text = out({ library: "mygo", symbol: "WindowOptions", max_tokens: 500 });
    expect(text).toContain("Truncated");
    expect(text).toContain("Raise max_tokens to read the rest.");
  });

  test("a truncated declaration respects the ceiling and closes its fence", () => {
    // The declared defect: 2212 characters against a 2000 budget, ending with
    // one unclosed ``` marker.
    for (const max_tokens of [500, 2000, 6000]) {
      const text = out({ library: "mygo", symbol: "WindowOptions", max_tokens });
      expect(text.length).toBeLessThanOrEqual(max_tokens * 4);
      expect(fences(text) % 2).toBe(0);
    }
  });
});

describe("get: a package with no godoc text", () => {
  test("says so and lists the packages that have a synopsis", () => {
    const out = body(
      getDocs({ library: "mygo", max_tokens: 20000 }, bundleWithoutDocs()),
    );
    expect(out).toContain("No godoc text for github.com/egoist/mygo.");
    expect(out).toContain("Available packages:");
    expect(out).toContain("- github.com/egoist/mygo — Desktop application framework.");
  });

  test("reports the fetch failure when the bundle carries one", () => {
    const out = body(
      getDocs(
        { library: "mygo", max_tokens: 20000 },
        bundleWithoutDocs({ docsError: "HTTP 500" }),
      ),
    );
    expect(out).toContain("Fetch failed: HTTP 500");
  });
});
