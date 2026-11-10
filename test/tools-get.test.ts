/**
 * The get tool, driven by a hand-built bundle.
 *
 * The fixture carries several declarations that share a name on different
 * receivers (Window on Document, Page and WebView; Close on Channel, Document
 * and Window), so the lookup's receiver handling is exercised offline.
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

  test("matching is case-insensitive", () => {
    const out = body(
      getDocs({ library: "mygo", symbol: "windowoptions", max_tokens: 20000 }, bundle),
    );
    expect(out).toContain("type WindowOptions struct");
  });

  test("a qualified symbol that exists returns exactly that declaration", () => {
    const out = body(
      getDocs(
        { library: "mygo", symbol: "Application.Name", max_tokens: 20000 },
        bundle,
      ),
    );
    expect(out).toContain("func (a *Application) Name() string");
    expect(out).toContain("Name returns the application name.");
    // The Document method of the same name is not what was asked for.
    expect(out).not.toContain("func (b *Document) Name() string");
  });

  test("a qualified symbol selects by receiver, not by first match", () => {
    // Window is declared on Document, Page and WebView. Only the receiver the
    // caller named may come back.
    const forPage = body(
      getDocs({ library: "mygo", symbol: "Page.Window", max_tokens: 20000 }, bundle),
    );
    const forWebView = body(
      getDocs(
        { library: "mygo", symbol: "WebView.Window", max_tokens: 20000 },
        bundle,
      ),
    );
    const forDocument = body(
      getDocs(
        { library: "mygo", symbol: "Document.Window", max_tokens: 20000 },
        bundle,
      ),
    );

    expect(forPage).toContain("func (p *Page) Window() *Window");
    expect(forPage).not.toContain("func (d *Document[T]) Window() *Window");
    expect(forWebView).toContain("func (v *WebView) Window() *Window");
    expect(forWebView).not.toContain("func (p *Page) Window() *Window");
    expect(forDocument).toContain("func (d *Document[T]) Window() *Window");
  });

  test("a generic receiver may be written with or without its type parameters", () => {
    const plain = body(
      getDocs(
        { library: "mygo", symbol: "Document.Window", max_tokens: 20000 },
        bundle,
      ),
    );
    const explicit = body(
      getDocs(
        { library: "mygo", symbol: "Document[T].Window", max_tokens: 20000 },
        bundle,
      ),
    );
    expect(plain).toContain("func (d *Document[T]) Window() *Window");
    expect(explicit).toBe(plain);
  });

  test("a qualified symbol whose receiver has no such name reports the miss", () => {
    // Application has no Title; only Window does. Today the receiver is thrown
    // away and Window.Title comes back, which is the defect this pins shut.
    const out = body(
      getDocs(
        { library: "mygo", symbol: "Application.Title", max_tokens: 20000 },
        bundle,
      ),
    );
    // No declaration body at all: a miss may not smuggle one in.
    expect(out).not.toContain("```go");
    expect(out).toContain('No declaration named "Application.Title"');
    expect(out).toContain('"Application" has no declaration named Title');
    // It says what does exist, so the caller can pick.
    expect(out).toContain("- Window.Title (method)");
    expect(out).toContain('symbol="Window.Title"');
  });

  test("an unknown receiver reports a miss rather than a method of that name", () => {
    const out = body(
      getDocs(
        { library: "mygo", symbol: "NoSuchType.Window", max_tokens: 20000 },
        bundle,
      ),
    );
    expect(out).not.toContain("```go");
    expect(out).toContain('No declaration named "NoSuchType.Window"');
    expect(out).toContain("Document.Window");
    expect(out).toContain("Page.Window");
    expect(out).toContain("WebView.Window");
  });

  test("a receiver that exists without that method reports a miss", () => {
    for (const symbol of ["Tray.Close", "Application.Close"]) {
      const out = body(
        getDocs({ library: "mygo", symbol, max_tokens: 20000 }, bundle),
      );
      // A miss, not a declaration: no fenced body may come back.
      expect(out).not.toContain("```go");
      expect(out).toContain(`No declaration named "${symbol}"`);
      expect(out).toContain("Channel.Close");
      expect(out).toContain("Document.Close");
      expect(out).toContain("Window.Close");
    }
  });

  test("a bare name matching several declarations returns candidates", () => {
    for (const [symbol, receivers] of [
      ["Close", ["Channel", "Document", "Window"]],
      ["Show", ["Application", "Dock", "Window"]],
      ["Set", ["CookiesModule", "Document", "NowPlayingModule", "SecretsModule"]],
      ["Name", ["Application", "Document", "Event"]],
    ] as const) {
      const out = body(
        getDocs({ library: "mygo", symbol, max_tokens: 20000 }, bundle),
      );
      expect(out).not.toContain("```go");
      expect(out).toContain(`"${symbol}" names ${receivers.length} declarations`);
      for (const receiver of receivers) {
        expect(out).toContain(`${receiver}.${symbol}`);
      }
      expect(out).toContain('symbol="');
    }
  });

  test("a bare name matching one declaration is returned unchanged", () => {
    // Title is declared once, on Window: no qualification needed.
    const out = body(
      getDocs({ library: "mygo", symbol: "Title", max_tokens: 20000 }, bundle),
    );
    expect(out).toContain("func (w *Window) Title() string");
    expect(out).not.toContain("names 1 declarations");
  });

  test("a grouped const or var block is still matched by its heading", () => {
    const constants = body(
      getDocs({ library: "mygo", symbol: "const block", max_tokens: 20000 }, bundle),
    );
    expect(constants).toContain("ContextMenuBack");

    const variables = body(
      getDocs({ library: "mygo", symbol: "var block", max_tokens: 20000 }, bundle),
    );
    expect(variables).toContain("PageLetter");
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
