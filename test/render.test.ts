/**
 * Render: response assembly and truncation.
 *
 * Every expected string below is written out from reading today's code, so a
 * change in wording or in the arithmetic fails here rather than silently
 * changing what an agent reads.
 */

import { describe, expect, test } from "bun:test";

import {
  CHARS_PER_TOKEN,
  documentMap,
  failure,
  fitToBudget,
  header,
  moreSectionsNote,
  noMatch,
  overview,
  sectionChunks,
  sectionsResponse,
  text,
  truncate,
  truncationNote,
} from "../src/render.ts";
import { sections } from "../src/sections.ts";
import {
  FIXTURE_MARKDOWN,
  bundleWithoutDocs,
  mygoBundle,
  stdlibBundle,
} from "./support/bundle.ts";

const bundle = mygoBundle();

/** Count of ``` markers, the unit an agent parses a response by. */
const fences = (text: string) => text.split("```").length - 1;

describe("text and failure", () => {
  test("text wraps the body as a single content block", () => {
    expect(text("hello")).toEqual({
      content: [{ type: "text", text: "hello" }],
    });
  });

  test("failure marks the result as an error and keeps the body", () => {
    expect(failure("boom")).toEqual({
      content: [{ type: "text", text: "boom" }],
      isError: true,
    });
  });
});

describe("truncate", () => {
  test("a body within budget is returned whole with no cut", () => {
    expect(truncate("abcde", 5)).toEqual({ body: "abcde", cut: 0 });
    expect(truncate("abc", 5)).toEqual({ body: "abc", cut: 0 });
  });

  test("with no line boundary in reach the cut falls at the budget", () => {
    // Ten characters on one line: there is no boundary to prefer, so the cut
    // is at the offset rather than losing the whole budget.
    expect(truncate("abcdefghij", 4)).toEqual({ body: "abcd", cut: 6 });
  });

  test("the cut lands on a line boundary when one is close to the budget", () => {
    // "aaaa\nbbbb\ncccc" is 14 characters. Cutting at 11 would split "bbbb";
    // the boundary just before it keeps 10 of the 11, which is close enough.
    expect(truncate("aaaa\nbbbb\ncccc", 11)).toEqual({
      body: "aaaa\nbbbb\n",
      cut: 4,
    });
  });

  test("a boundary too far from the budget is rejected for the raw cut", () => {
    // The only newline is at offset 1, which keeps 2 of 9 characters: too
    // little to be worth the loss, so the cut stays at the budget.
    expect(truncate("a\nbbbbbbbb", 9)).toEqual({ body: "a\nbbbbbbb", cut: 1 });
  });

  test("a cut inside a fenced block closes the fence", () => {
    const body = "```go\nfunc A()\nfunc B()\nfunc C()\n```\n";
    const { body: kept, cut } = truncate(body, 22);
    expect(fences(kept)).toBe(2);
    expect(kept.endsWith("```")).toBe(true);
    expect(kept.length).toBeLessThanOrEqual(22);
    expect(kept.length + cut).toBe(body.length);
  });

  test("a cut outside a fenced block adds no fence", () => {
    const body = "prose line one\nprose line two\nprose line three\n";
    const { body: kept } = truncate(body, 18);
    expect(fences(kept)).toBe(0);
    expect(kept).toBe("prose line one\n");
  });

  test("cut plus returned length always equals the original length", () => {
    for (const max of [0, 1, 7, 100]) {
      const { body, cut } = truncate("0123456789", max);
      expect(body.length + cut).toBe(10);
    }
  });

  test("the ceiling and fence parity hold on the fixture at every budget", () => {
    for (const max of [1, 40, 200, 800, 1700, 4000, 12_000]) {
      const { body, cut } = truncate(FIXTURE_MARKDOWN, max);
      expect(body.length).toBeLessThanOrEqual(max);
      expect(body.length + cut).toBe(FIXTURE_MARKDOWN.length);
      expect(fences(body) % 2).toBe(0);
    }
  });

  test("the invariants hold at every offset, not just the round budgets", () => {
    // Sweeping every budget catches the boundaries a hand-picked list misses:
    // a cut that lands one character into a fence line, or a closer that does
    // not fit at all.
    const sources = [
      FIXTURE_MARKDOWN,
      sections(FIXTURE_MARKDOWN)
        .map((s) => s.body)
        .join("\n\n"),
      "```go\nfunc A()\n```\n",
      "no fences here at all\nand a second line\n",
    ];
    for (const source of sources) {
      // Every source here is well-formed, so every prefix must be too.
      expect(fences(source) % 2).toBe(0);
      for (let max = 0; max <= 400; max++) {
        const { body, cut } = truncate(source, max);
        expect(body.length).toBeLessThanOrEqual(max);
        expect(body.length + cut).toBe(source.length);
        expect(fences(body) % 2).toBe(0);
      }
    }
  });

  test("a body shorter than a fence closer is cut before the open fence", () => {
    // "```\n" is 4 characters and a closer is 4 more, so the fence cannot be
    // closed inside a 3-character budget. Dropping it keeps parity even
    // rather than leaving half a fence.
    expect(truncate("```\n", 3)).toEqual({ body: "", cut: 4 });
  });
});

describe("truncationNote", () => {
  test("no cut means no note", () => {
    expect(truncationNote(0, 100, "next")).toBe("");
    expect(truncationNote(-1, 100, "next")).toBe("");
  });

  test("a cut reports how much was dropped, of what, and the next step", () => {
    expect(truncationNote(6, 10, "Raise max_tokens.")).toBe(
      "\n\n---\nTruncated 6 of 10 characters. Raise max_tokens.",
    );
  });
});

describe("fitToBudget", () => {
  const next = "Raise max_tokens to read the rest.";

  test("a response that fits is returned exactly as assembled", () => {
    expect(fitToBudget("head\n", "body\n", 100, next)).toBe("head\nbody\n");
  });

  test("a response that fits carries no footer", () => {
    expect(fitToBudget("head\n", "body\n", 100, next)).not.toContain("Truncated");
  });

  test("the ceiling covers the header and the footer, not just the body", () => {
    // The body alone fits the budget; header plus footer would not.
    const out = fitToBudget("header\n", "x".repeat(200), 100, next);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out).toContain("Truncated");
    expect(out).toContain(next);
  });

  test("the ceiling holds at every budget, fence parity included", () => {
    for (const maxChars of [500, 800, 2000, 4000, 8000]) {
      const out = fitToBudget(header(bundle), FIXTURE_MARKDOWN, maxChars, next);
      expect(out.length).toBeLessThanOrEqual(maxChars);
      expect(fences(out) % 2).toBe(0);
    }
  });

  test("the footer reports the cut against the untruncated body", () => {
    const body = "y".repeat(500);
    const out = fitToBudget("", body, 200, next);
    const note = out.slice(out.indexOf("\n\n---\nTruncated"));
    expect(note).toContain(" of 500 characters.");
    // The number it reports plus what it kept accounts for the whole body.
    const kept = out.slice(0, out.indexOf("\n\n---\nTruncated"));
    const cut = Number(/Truncated (\d+) of/.exec(note)![1]);
    expect(kept.length + cut).toBe(body.length);
  });

  test("a budget too small for header and footer drops the footer, not the ceiling", () => {
    // The schema's floor is 500 tokens, so this is unreachable through the
    // tool; the assembly must still not print a footer it cannot afford.
    const out = fitToBudget("header\n", "z".repeat(400), 60, next);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out).not.toContain("Truncated");
  });

  test("the ceiling holds at the smallest budget the tool schema allows", () => {
    // 500 tokens is the `max_tokens` minimum, and 2000 characters with it.
    const out = fitToBudget(header(bundle), FIXTURE_MARKDOWN, 500 * CHARS_PER_TOKEN, next);
    expect(out.length).toBeLessThanOrEqual(500 * CHARS_PER_TOKEN);
    expect(out).toContain("Truncated");
    expect(fences(out) % 2).toBe(0);
  });
});

describe("header", () => {
  test("names the library, the doc version, the package and the source", () => {
    expect(header(bundle)).toBe(
      [
        "library: github.com/egoist/mygo",
        "version: v0.8.3",
        "package: github.com/egoist/mygo",
        "source: https://pkg.go.dev/github.com/egoist/mygo@v0.8.3",
        "",
      ].join("\n"),
    );
  });

  test("falls back to the module version when the doc has none", () => {
    const bare = bundleWithoutDocs({ primaryPackage: undefined });
    expect(header(bare)).toBe(
      [
        "library: github.com/egoist/mygo",
        "version: v0.8.3",
        "package: github.com/egoist/mygo",
        "source: https://pkg.go.dev/github.com/egoist/mygo@v0.8.3",
        "",
      ].join("\n"),
    );
  });

  test("uses the primary package path when the bundle names one", () => {
    expect(header(mygoBundle({ primaryPackage: "github.com/egoist/mygo/ui" })))
      .toContain("package: github.com/egoist/mygo/ui\n");
  });

  test("a standard-library package links without a version", () => {
    // pkg.go.dev answers 400 for encoding/json@v1.27.4 and for
    // std@v1.27.4/encoding/json, so the link must carry no version at all.
    expect(header(stdlibBundle())).toBe(
      [
        "library: std",
        "version: v1.27.4",
        "package: encoding/json",
        "source: https://pkg.go.dev/encoding/json",
        "",
      ].join("\n"),
    );
  });
});

describe("overview", () => {
  test("a blank line precedes every heading so Markdown renders it", () => {
    const lines = overview(bundle).split("\n");
    const headings = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => line.startsWith("## "));
    expect(headings.map(({ line }) => line)).toEqual([
      "## Versions",
      "## Packages",
      "## Next",
    ]);
    for (const { index } of headings) expect(lines[index - 1]).toBe("");
  });

  test("a missing repository URL leaves no doubled blank line", () => {
    const noRepo = mygoBundle({
      module: {
        path: "github.com/egoist/mygo",
        version: "v0.8.3",
        commitTime: "2025-03-04T10:00:00Z",
        isLatest: true,
      },
    });
    expect(overview(noRepo)).not.toContain("\n\n\n");
  });
});

describe("documentMap", () => {
  test("lists only the group headings, not every declaration", () => {
    const map = documentMap(sections(bundle.docs!.markdown));
    const lines = map.split("\n");
    expect(lines).toEqual([
      "- package mygo",
      "- Constants",
      "- Variables",
      "- Functions",
      "- Types",
    ]);
  });
});

describe("sectionChunks", () => {
  const all = sections(bundle.docs!.markdown);

  test("each chunk is a heading at its own level followed by the body", () => {
    const types = all.find((s) => s.heading === "Types")!;
    const { chunks } = sectionChunks([types], 100_000, 0);
    expect(chunks).toEqual(["## Types\n\n"]);
  });

  test("a declaration chunk renders as a level 3 heading", () => {
    const hide = all.find((s) => s.name === "Hide")!;
    const { chunks } = sectionChunks([hide], 100_000, 0);
    expect(chunks[0].startsWith("### Hide (method)\n\n```go\n")).toBe(true);
  });

  test("all chunks fit when the budget is large", () => {
    const { chunks, used } = sectionChunks(all, 100_000, 0);
    expect(chunks).toHaveLength(all.length);
    expect(used).toBe(chunks.join("\n\n").length);
  });

  test("a partial chunk is cut at a boundary and closes its fence", () => {
    // WindowOptions is far larger than the room, so its chunk is a fragment.
    // It must end on a line boundary and carry an even number of fence
    // markers: an agent parsing by fence would otherwise swallow the rest.
    const windowOptions = all.find((s) => s.name === "WindowOptions")!;
    const { chunks, used } = sectionChunks([windowOptions], 2000, 0);
    const last = chunks[chunks.length - 1];
    expect(last.endsWith("```")).toBe(true);
    expect(fences(last) % 2).toBe(0);
    expect(used).toBeLessThanOrEqual(2000);
  });

  test("a leftover room of 400 characters or less adds no partial chunk", () => {
    // WindowOptions is far larger than any budget here, so it never fits and
    // the room decides: 200 characters are already spent.
    const windowOptions = all.find((s) => s.name === "WindowOptions")!;
    // Room of 100: too small to be worth a fragment.
    expect(sectionChunks([windowOptions], 300, 200)).toEqual({
      chunks: [],
      used: 200,
    });
    // Room of exactly 400: still not enough.
    expect(sectionChunks([windowOptions], 600, 200)).toEqual({
      chunks: [],
      used: 200,
    });
    // Room of 401: a fragment is cut inside the room.
    const partial = sectionChunks([windowOptions], 601, 200);
    expect(partial.chunks).toHaveLength(1);
    expect(partial.chunks[0].length).toBeLessThanOrEqual(401);
    expect(partial.used).toBeLessThanOrEqual(601);
  });

  test("the budget counts the header as already spent", () => {
    const hide = all.find((s) => s.name === "Hide")!;
    const withoutHeader = sectionChunks([hide], 100_000, 0);
    const withHeader = sectionChunks([hide], 100_000, 500);
    expect(withHeader.used).toBe(withoutHeader.used + 500);
  });
});

describe("sectionsResponse", () => {
  const all = sections(bundle.docs!.markdown);
  const head = header(bundle);
  const next = 'Narrow with topic="window".';

  test("a response whose sections all fit has no footer", () => {
    const out = sectionsResponse(head, all, 100_000, next);
    expect(out).toBe(`${head}${all.map((s) => chunkFor(s)).join("\n\n")}`);
    expect(out).not.toContain("more matching section(s)");
  });

  test("the ceiling covers the header and the footer", () => {
    for (const maxChars of [2000, 4000, 8000, 24_000]) {
      const out = sectionsResponse(head, all, maxChars, next);
      expect(out.length).toBeLessThanOrEqual(maxChars);
      expect(fences(out) % 2).toBe(0);
    }
  });

  test("a truncated response says how many sections are missing", () => {
    const out = sectionsResponse(head, all, 2000, next);
    const note = out.slice(out.indexOf("\n\n---\n"));
    expect(note).toContain("more matching section(s) not shown.");
    expect(note).toContain(next);
    expect(note).toMatch(/\d+ more matching/);
  });

  test("reserving the footer leaves the sections room to fill it", () => {
    // The footer is budgeted before packing, so the response must be close to
    // the ceiling rather than far under it: a reserve that is never given back
    // would waste most of the budget.
    const out = sectionsResponse(head, all, 2000, next);
    expect(out.length).toBeGreaterThan(2000 - 200);
  });
});

/** The rendered form of one section, as `sectionChunks` produces it. */
function chunkFor(section: ReturnType<typeof sections>[number]): string {
  return `${"#".repeat(Math.min(section.level, 4))} ${section.heading}\n\n${section.body}`;
}

describe("moreSectionsNote", () => {
  test("nothing left means no note", () => {
    expect(moreSectionsNote(0, "next")).toBe("");
    expect(moreSectionsNote(-2, "next")).toBe("");
  });

  test("names the count and the next step", () => {
    expect(moreSectionsNote(3, "next")).toBe(
      "\n\n---\n3 more matching section(s) not shown. next",
    );
  });
});

describe("noMatch", () => {
  test("names the query and offers the document map and a next step", () => {
    const out = noMatch("header\n", "create a window", "- Types", "mygo");
    expect(out).toBe(
      'header\nNo section matched "create a window". Document map:\n\n- Types\n\nNarrow with topic, or call get(library="mygo", symbol="Name").',
    );
  });

  test("never names the topic: it is a ranking hint, so it cannot be the cause", () => {
    const out = noMatch("header\n", "window", "- Types", "mygo");
    expect(out).toBe(
      'header\nNo section matched "window". Document map:\n\n- Types\n\nNarrow with topic, or call get(library="mygo", symbol="Name").',
    );
  });
});

describe("CHARS_PER_TOKEN", () => {
  test("is the four-character estimate the token budgets use", () => {
    expect(CHARS_PER_TOKEN).toBe(4);
  });
});
