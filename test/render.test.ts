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
  header,
  noMatch,
  sectionChunks,
  text,
  truncate,
  truncationNote,
} from "../src/render.ts";
import { sections } from "../src/sections.ts";
import { bundleWithoutDocs, mygoBundle } from "./support/bundle.ts";

const bundle = mygoBundle();

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

  test("a body over budget is cut at the budget, not at a boundary", () => {
    // CURRENT BEHAVIOUR, NOT INTENDED: the cut lands mid-word. A sibling
    // ticket fixes the cut; pinned here so the fix is deliberate.
    expect(truncate("abcdefghij", 4)).toEqual({ body: "abcd", cut: 6 });
  });

  test("cut plus returned length always equals the original length", () => {
    for (const max of [0, 1, 7, 100]) {
      const { body, cut } = truncate("0123456789", max);
      expect(body.length + cut).toBe(10);
    }
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
    expect(used).toBe(chunks.join("").length);
  });

  test("CURRENT BEHAVIOUR, NOT INTENDED: the cut is at an arbitrary offset", () => {
    // The last chunk is sliced at `room`, mid-word, rather than at a section
    // boundary. A sibling ticket fixes it; pinned here so it changes on
    // purpose.
    const { chunks } = sectionChunks(all, 2000, 0);
    const last = chunks[chunks.length - 1];
    expect(last.endsWith("```")).toBe(false);
    expect(last.length).toBeGreaterThan(0);
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
    // Room of 401: the fragment is cut at the room.
    const partial = sectionChunks([windowOptions], 601, 200);
    expect(partial.chunks).toHaveLength(1);
    expect(partial.chunks[0].length).toBe(401);
    expect(partial.used).toBe(601);
  });

  test("the budget counts the header as already spent", () => {
    const hide = all.find((s) => s.name === "Hide")!;
    const withoutHeader = sectionChunks([hide], 100_000, 0);
    const withHeader = sectionChunks([hide], 100_000, 500);
    expect(withHeader.used).toBe(withoutHeader.used + 500);
  });
});

describe("noMatch", () => {
  test("names the query and offers the document map and a next step", () => {
    const out = noMatch("header\n", "create a window", "- Types", "mygo");
    expect(out).toBe(
      'header\nNo section matched "create a window". Document map:\n\n- Types\n\nNarrow with topic, or call get(library="mygo", symbol="Name").',
    );
  });
});

describe("CHARS_PER_TOKEN", () => {
  test("is the four-character estimate the token budgets use", () => {
    expect(CHARS_PER_TOKEN).toBe(4);
  });
});
