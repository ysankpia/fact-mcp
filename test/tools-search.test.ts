/**
 * The search tool, driven by a hand-built bundle.
 *
 * No request is made: the tool takes the bundle as an argument, so every
 * branch below runs offline against the committed fixture.
 */

import { describe, expect, test } from "bun:test";

import { searchDocs, searchPlan } from "../src/tools-search.ts";
import {
  ZH_FIXTURE_MARKDOWN,
  bundleWithoutDocs,
  mygoBundle,
} from "./support/bundle.ts";

const bundle = mygoBundle();
const body = (result: ReturnType<typeof searchDocs>) =>
  (result.content[0] as { type: "text"; text: string }).text;

/** The number of ``` markers, the unit an agent parses a response by. */
const fences = (text: string) => text.split("```").length - 1;

/** The declaration headings of a response, in the order the response has them. */
const headings = (text: string) =>
  text
    .split("\n")
    .filter((line) => line.startsWith("### "))
    .map((line) => line.slice(4));

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

  test("a topic keeps only the sections that mention it", () => {
    // "TitleBarStyle" appears in one section of the fixture. A topic is a
    // filter, so the answer is that section alone — not the 23 sections the
    // bare query ranks, reordered.
    const wide = headings(
      body(
        searchDocs(
          { query: "window", library: "mygo", max_tokens: 20000 },
          bundle,
        ),
      ),
    );
    const narrow = headings(
      body(
        searchDocs(
          {
            query: "window",
            topic: "TitleBarStyle",
            library: "mygo",
            max_tokens: 20000,
          },
          bundle,
        ),
      ),
    );

    expect(narrow).toEqual(["WindowOptions (type)"]);
    // The section the unnarrowed answer leads with shares no "TitleBarStyle"
    // mention with the topic, so it must be gone rather than demoted.
    expect(wide).toContain("WindowStateStore (type)");
    expect(narrow).not.toContain("WindowStateStore (type)");
    // Strict subset: every narrowed section is one the unnarrowed answer had.
    expect(narrow.length).toBeGreaterThan(0);
    expect(narrow.every((heading) => wide.includes(heading))).toBe(true);
    expect(narrow.length).toBeLessThan(wide.length);
  });

  test("a topic keeps the unnarrowed order of the sections it keeps", () => {
    const narrow = headings(
      body(
        searchDocs(
          {
            query: "window",
            topic: "Close",
            library: "mygo",
            max_tokens: 20000,
          },
          bundle,
        ),
      ),
    );
    const wide = headings(
      body(
        searchDocs(
          { query: "window", library: "mygo", max_tokens: 20000 },
          bundle,
        ),
      ),
    );

    // "Close" is mentioned by seven ranked sections: a filter keeps them in
    // the order the query ranked them, and drops the rest.
    expect(narrow.length).toBe(7);
    const kept = wide.filter((heading) => narrow.includes(heading));
    expect(narrow).toEqual(kept);
    expect(narrow.length).toBeLessThan(wide.length);
  });

  test("a topic that no section mentions says so, naming the query and the topic", () => {
    const out = body(
      searchDocs(
        {
          query: "window",
          topic: "zzzqqq",
          library: "mygo",
          max_tokens: 20000,
        },
        bundle,
      ),
    );
    expect(out).toContain('No section matched "window" with topic "zzzqqq"');
    expect(out).toContain("Document map:");
    expect(out).not.toContain("### WindowOptions (type)");
  });

  test("a small budget still returns the header and a truncation note", () => {
    const out = body(
      searchDocs({ query: "window", library: "mygo", max_tokens: 500 }, bundle),
    );
    expect(out.startsWith("library: github.com/egoist/mygo")).toBe(true);
    expect(out).toContain("more matching section(s) not shown");
    // 500 tokens is 2000 characters, and the note says how to get the rest.
    expect(out.length).toBeLessThanOrEqual(2000);
  });

  test("the truncation footer says what a topic does", () => {
    // The footer is one of the three places that describe `topic`; it must
    // promise the same filter the schema and the README promise.
    const out = body(
      searchDocs({ query: "window", library: "mygo", max_tokens: 500 }, bundle),
    );
    expect(out).toContain('topic="window"');
    expect(out).toContain("only the sections that mention it");
  });

  test("the footer of a narrowed response offers to widen it", () => {
    // Telling a caller who already passed a topic to narrow with a topic is a
    // dead end: what widens a narrowed search is dropping the topic.
    const out = body(
      searchDocs(
        { query: "window", topic: "Close", library: "mygo", max_tokens: 500 },
        bundle,
      ),
    );
    expect(out).toContain("more matching section(s) not shown");
    expect(out).toContain('topic="Close"');
    expect(out).toContain("drop the topic");
  });

  test("the whole response stays under the ceiling at every budget", () => {
    for (const max_tokens of [500, 2000, 6000]) {
      const out = body(
        searchDocs({ query: "window", library: "mygo", max_tokens }, bundle),
      );
      expect(out.length).toBeLessThanOrEqual(max_tokens * 4);
    }
  });

  test("a truncated response carries an even number of fence markers", () => {
    for (const max_tokens of [500, 2000, 6000]) {
      const out = body(
        searchDocs({ query: "window", library: "mygo", max_tokens }, bundle),
      );
      expect(fences(out) % 2).toBe(0);
    }
  });

  test("a response that fits carries no truncation footer", () => {
    // A budget large enough for every ranked section: nothing is left out, so
    // nothing is reformatted or footed.
    const out = body(
      searchDocs({ query: "window", library: "mygo", max_tokens: 20000 }, bundle),
    );
    expect(out).not.toContain("more matching section(s) not shown");
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

describe("search: a topic without a query", () => {
  test("selects the sections that mention it instead of an overview", () => {
    // A caller naming a topic asked for documentation about it. Answering with
    // a version list would silently ignore half the request.
    const out = body(
      searchDocs(
        { library: "mygo", topic: "TitleBarStyle", max_tokens: 20000 },
        bundle,
      ),
    );
    expect(out).not.toContain("## Versions");
    expect(out).toContain("### WindowOptions (type)");
    expect(out).toContain("source: https://pkg.go.dev/github.com/egoist/mygo");
  });

  test("a topic with no query still needs a library to look up", () => {
    const result = searchDocs({ topic: "TitleBarStyle", max_tokens: 20000 }, bundle);
    expect(result.isError).toBe(true);
    expect(body(result)).toContain("Provide a query, a library name, or both");
  });

  test("a topic fetches the docs body, not the overview", () => {
    expect(searchPlan("", "mygo", "TitleBarStyle")).toEqual({
      name: "mygo",
      want: "docs",
    });
  });
});

describe("search: a query without a library", () => {
  test("resolves the query as the name and fetches the docs body", () => {
    // This is the whole bug: the query was resolved as the name but fetched as
    // an overview, so the query was then answered from a bundle with no
    // Markdown and the package was blamed for having no docs.
    expect(searchPlan("cobra", "")).toEqual({ name: "cobra", want: "docs" });
  });

  test("a named library with a query still fetches the docs body", () => {
    expect(searchPlan("create a native window", "mygo")).toEqual({
      name: "mygo",
      want: "docs",
    });
  });

  test("a library with no query stays an overview", () => {
    expect(searchPlan("", "mygo")).toEqual({ name: "mygo", want: "overview" });
  });

  test("no query and no library has no name to resolve", () => {
    expect(searchPlan("", "")).toBeUndefined();
    expect(searchPlan("  ", "  ")).toBeUndefined();
  });

  test("a query-only call is answered from docs, never as an overview", () => {
    // The fix is two halves: ask for the docs body (above), then assemble from
    // it. This pins the second half — with no `library` the body must not take
    // the overview branch that a bare library name takes.
    const out = body(
      searchDocs({ query: "create a native window", max_tokens: 20000 }, bundle),
    );
    expect(out).not.toContain("no godoc text");
    expect(out).not.toContain("## Versions");
    expect(out).toContain("### WindowOptions (type)");
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

  test("a failed fetch is reported as a failure, not as missing upstream docs", () => {
    // `docsError` means the fetch failed. Claiming the package has no godoc
    // text would blame upstream for a transient error.
    const out = body(
      searchDocs(
        { query: "window", library: "mygo", max_tokens: 6000 },
        bundleWithoutDocs({ docsError: "HTTP 500" }),
      ),
    );
    expect(out).toContain("Fetch failed: HTTP 500");
    expect(out).not.toContain("This package has no godoc text");
    // The overview is still the fallback, so the caller has something to act on.
    expect(out).toContain("## Versions");
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
