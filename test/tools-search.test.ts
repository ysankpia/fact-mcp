/**
 * The search tool, driven by a hand-built bundle.
 *
 * No request is made: the tool takes the bundle as an argument, so every
 * branch below runs offline against the committed fixture.
 */

import { describe, expect, test } from "bun:test";

import { searchDocs } from "../src/tools-search.ts";
import {
  ZH_FIXTURE_MARKDOWN,
  bundleWithoutDocs,
  mygoBundle,
} from "./support/bundle.ts";

const bundle = mygoBundle();
const body = (result: ReturnType<typeof searchDocs>) =>
  (result.content[0] as { type: "text"; text: string }).text;

describe("search: no input", () => {
  test("neither query nor library is a tool error naming both", () => {
    const result = searchDocs({ max_tokens: 6000 }, bundle);
    expect(result.isError).toBe(true);
    expect(body(result)).toContain("Provide a query, a library name, or both");
    expect(body(result)).toContain('search(query="create a window"');
  });

  test("whitespace counts as no input", () => {
    const result = searchDocs({ query: "  ", library: " ", max_tokens: 6000 }, bundle);
    expect(result.isError).toBe(true);
  });
});

describe("search: library only is an overview", () => {
  test("returns the overview, not a ranked section list", () => {
    const result = searchDocs({ library: "mygo", max_tokens: 6000 }, bundle);
    expect(result.isError).toBeUndefined();
    expect(body(result)).toContain("library: github.com/egoist/mygo");
    expect(body(result)).toContain("## Versions");
    expect(body(result)).toContain("## Packages");
    expect(body(result)).toContain("## Next");
  });

  test("marks the latest version and flags deprecated and retracted ones", () => {
    const out = body(searchDocs({ library: "mygo", max_tokens: 6000 }, bundle));
    expect(out).toContain("- v0.8.3 (latest) — 2025-03-04");
    expect(out).toContain("- v0.8.0 (deprecated) (retracted) — 2025-01-02");
  });

  test("lists only packages with a synopsis", () => {
    const out = body(searchDocs({ library: "mygo", max_tokens: 6000 }, bundle));
    expect(out).toContain("- github.com/egoist/mygo — Desktop application framework.");
    // The ui package has no synopsis, so it is not advertised.
    expect(out).not.toContain("github.com/egoist/mygo/ui —");
  });

  test("omits the repo line when the module has no repository URL", () => {
    const noRepo = mygoBundle({
      module: {
        path: "github.com/egoist/mygo",
        version: "v0.8.3",
        commitTime: "2025-03-04T10:00:00Z",
        isLatest: true,
      },
    });
    expect(body(searchDocs({ library: "mygo", max_tokens: 6000 }, noRepo)))
      .not.toContain("repo:");
  });
});

describe("search: query", () => {
  test("starts with the provenance header", () => {
    const out = body(
      searchDocs(
        { query: "create a native window", library: "mygo", max_tokens: 20000 },
        bundle,
      ),
    );
    expect(out.startsWith("library: github.com/egoist/mygo\n")).toBe(true);
    expect(out).toContain("version: v0.8.3\n");
    expect(out).toContain(
      "source: https://pkg.go.dev/github.com/egoist/mygo@v0.8.3\n",
    );
  });

  test("the best-ranked section leads the response", () => {
    const out = body(
      searchDocs(
        { query: "create a native window", library: "mygo", max_tokens: 20000 },
        bundle,
      ),
    );
    // WindowOptions is the top-ranked section for this query.
    expect(out).toContain("### WindowOptions (type)");
    const windowOptionsAt = out.indexOf("### WindowOptions (type)");
    const firstHeadingAt = out.indexOf("\n### ");
    expect(windowOptionsAt).toBe(firstHeadingAt + 1);
  });

  test("a symbol query surfaces the declaration that names it", () => {
    const out = body(
      searchDocs({ query: "Hide", library: "mygo", max_tokens: 20000 }, bundle),
    );
    expect(out).toContain("### Hide (method)");
  });

  test("topic narrows the ranking", () => {
    const out = body(
      searchDocs(
        { query: "window", topic: "StateKey", library: "mygo", max_tokens: 20000 },
        bundle,
      ),
    );
    expect(out).toContain("StateKey");
  });

  test("a small budget still returns the header and a truncation note", () => {
    const out = body(
      searchDocs({ query: "window", library: "mygo", max_tokens: 500 }, bundle),
    );
    expect(out.startsWith("library: github.com/egoist/mygo")).toBe(true);
    expect(out).toContain("more matching section(s) not shown");
    // 500 tokens is 2000 characters, and the note says how to get the rest.
    expect(out.length).toBeLessThan(4000);
  });

  test("a large budget returns more than a small one", () => {
    const small = body(
      searchDocs({ query: "window", library: "mygo", max_tokens: 500 }, bundle),
    );
    const large = body(
      searchDocs({ query: "window", library: "mygo", max_tokens: 20000 }, bundle),
    );
    expect(large.length).toBeGreaterThan(small.length);
    expect(large.length).toBeGreaterThan(2000);
  });

  test("a query that matches nothing returns the no-match response, not unrelated types", () => {
    // "kubernetes" appears nowhere in the fixture. A type used to score a flat
    // bonus for being a type, so the response led with WindowOptions and the
    // no-match branch was unreachable.
    const out = body(
      searchDocs(
        { query: "kubernetes", library: "mygo", max_tokens: 20000 },
        bundle,
      ),
    );
    expect(out).toContain('No section matched "kubernetes"');
    expect(out).toContain("Document map:");
    expect(out).not.toContain("### WindowOptions (type)");
  });

  test("a query of nonsense characters also reaches the no-match response", () => {
    const out = body(
      searchDocs(
        { query: "zzzqqqxyw", library: "mygo", max_tokens: 20000 },
        bundle,
      ),
    );
    expect(out).toContain('No section matched "zzzqqqxyw"');
    expect(out).toContain("- Types");
  });

  test("a query in a script without word breaks returns the sections about windows", () => {
    // mygo's own godoc is English, so a Chinese query has nothing to match
    // there: it must say so rather than answer with an unrelated type.
    const out = body(
      searchDocs(
        { query: "创建窗口", library: "mygo", max_tokens: 20000 },
        bundle,
      ),
    );
    expect(out).toContain('No section matched "创建窗口"');
    expect(out).toContain("Document map:");
  });

  test("a matching query still leads with the section that answers it", () => {
    // The no-match fix must not change what a matching query returns.
    for (const query of ["window", "create a native window"]) {
      const out = body(
        searchDocs({ query, library: "mygo", max_tokens: 20000 }, bundle),
      );
      expect(out).toContain("### WindowOptions (type)");
      expect(out.indexOf("### WindowOptions (type)")).toBeLessThan(
        out.indexOf("### WindowStateStore (type)"),
      );
    }
  });
});

describe("search: a package with no godoc text", () => {
  test("says so and falls back to the overview", () => {
    const out = body(
      searchDocs(
        { query: "window", library: "mygo", max_tokens: 6000 },
        bundleWithoutDocs(),
      ),
    );
    expect(out).toContain("This package has no godoc text");
    expect(out).toContain("## Versions");
  });

  test("an empty Markdown body is treated as no text", () => {
    const empty = mygoBundle({
      docs: {
        path: "github.com/egoist/mygo",
        version: "v0.8.3",
        synopsis: "",
        markdown: "   \n",
      },
    });
    const out = body(
      searchDocs({ query: "window", library: "mygo", max_tokens: 6000 }, empty),
    );
    expect(out).toContain("This package has no godoc text");
  });
});

describe("search: the document map", () => {
  test("the no-match branch lists the group headings and a next step", () => {
    // A query whose terms are all single characters tokenises to nothing, so
    // nothing matches and the caller gets the map to pick a better query from.
    const headingsOnly = mygoBundle({
      docs: {
        path: "github.com/egoist/mygo",
        version: "v0.8.3",
        synopsis: "",
        markdown: "# package mygo\n\n## Types\n\nProse only, no fences.\n",
      },
    });
    const out = body(
      searchDocs(
        { query: "a b", library: "mygo", max_tokens: 6000 },
        headingsOnly,
      ),
    );
    expect(out).toContain('No section matched "a b"');
    expect(out).toContain("- package mygo");
    expect(out).toContain("- Types");
    expect(out).toContain('get(library="github.com/egoist/mygo", symbol="Name")');
  });
});

describe("search: a package documented in a script without word breaks", () => {
  // A real excerpt of github.com/twgh/xcgui/window, whose godoc is Chinese.
  const zhBundle = mygoBundle({
    docs: {
      path: "github.com/twgh/xcgui/window",
      version: "v1.4.9",
      synopsis: "",
      markdown: ZH_FIXTURE_MARKDOWN,
    },
  });

  test("a Chinese query returns the window functions, not an arbitrary type", () => {
    const out = body(
      searchDocs(
        { query: "创建窗口", library: "mygo", max_tokens: 20000 },
        zhBundle,
      ),
    );
    expect(out).not.toContain("No section matched");
    // New and NewEx are the two declarations that say 窗口\_创建.
    expect(out).toContain("### New (func)");
    expect(out).toContain("### NewEx (func)");
    // A method whose prose never mentions either term is not an answer.
    expect(out).not.toContain("### EnableAutoWrap (method)");
  });

  test("the English identifiers in the same package still match", () => {
    const out = body(
      searchDocs(
        { query: "EnableAutoWrap", library: "mygo", max_tokens: 20000 },
        zhBundle,
      ),
    );
    expect(out).toContain("### EnableAutoWrap (method)");
  });
});
