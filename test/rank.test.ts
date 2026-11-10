/**
 * Ranking: score a section against the terms of a query.
 *
 * The fixture is the same real pkg.go.dev Markdown the sectioning suite uses,
 * so every expectation below is a number worked out by hand from the fixture
 * text, not a value the implementation recomputed. The second fixture is a
 * real excerpt of a package whose godoc is written in Chinese, which is what
 * the unspaced-script matching is measured against.
 */

import { describe, expect, test } from "bun:test";

import { rank, score, tokens } from "../src/rank.ts";
import { sections } from "../src/sections.ts";

const fixture = await Bun.file(
  new URL("./fixtures/mygo.md", import.meta.url),
).text();

const fixtureSections = sections(fixture);

/**
 * A trimmed excerpt of a real
 * `pkg.go.dev/v1/package/github.com/twgh/xcgui/window?doc=markdown` response.
 * The prose is Chinese and the identifiers are English, which is the shape a
 * query in a script without word breaks has to match.
 */
const zhFixture = await Bun.file(
  new URL("./fixtures/xcgui-window-zh.md", import.meta.url),
).text();

const zhSections = sections(zhFixture);

function named(name: string) {
  const found = fixtureSections.filter((s) => s.name === name);
  expect(found.length).toBeGreaterThan(0);
  return found;
}

function only(name: string) {
  const found = named(name);
  expect(found).toHaveLength(1);
  return found[0];
}

describe("tokens", () => {
  test("lowercases and splits on anything that is not a word character", () => {
    expect(tokens("Create a Native Window")).toEqual([
      "create",
      "native",
      "window",
    ]);
  });

  test("keeps dots and underscores so a qualified name stays one term", () => {
    expect(tokens("Limiter.Wait_Timeout")).toEqual(["limiter.wait_timeout"]);
  });

  test("drops single-character noise", () => {
    expect(tokens("a b c window")).toEqual(["window"]);
  });

  test("a query of punctuation alone yields no terms", () => {
    expect(tokens("?! - /")).toEqual([]);
  });

  test("a query in a script without word breaks yields the character n-grams it can match on", () => {
    // "创建窗口" has no spaces to split on, so ASCII word breaks would delete
    // it entirely. It is indexed as overlapping bigrams instead.
    expect(tokens("创建窗口")).toEqual(["创建", "建窗", "窗口"]);
  });

  test("a single unspaced-script character is a term of its own", () => {
    expect(tokens("窗")).toEqual(["窗"]);
  });

  test("Japanese and Korean are handled the same way as Chinese", () => {
    expect(tokens("ウィンドウ")).toEqual([
      "ウィ",
      "ィン",
      "ンド",
      "ドウ",
    ]);
    expect(tokens("창문")).toEqual(["창문"]);
  });

  test("a mixed query keeps its ASCII words and adds the unspaced-script n-grams", () => {
    expect(tokens("window 创建")).toEqual(["window", "创建"]);
  });

  test("a term repeated in the query counts once", () => {
    // Scoring the same term twice would count the same body hits twice and
    // let a repetition in the query outweigh a better match. Repeating a run
    // also produces each bigram more than once.
    expect(tokens("window window")).toEqual(["window"]);
    expect(tokens("创建创建")).toEqual(["创建", "建创"]);
  });

  test("an accented Latin word is not mistaken for an unspaced script", () => {
    // "café" is Latin, so the ASCII rule applies and "é" is a separator: the
    // term is "caf", as it was before bigrams existed. It must not become the
    // character bigram "cé".
    expect(tokens("café")).toEqual(["caf"]);
  });
});

describe("score", () => {
  test("a heading hit is worth far more than a body hit", () => {
    // "window" is in the heading of WindowOptions (type) and more than eight
    // times in its body, so 40 + 8*2 = 56. Nothing is added for the kind.
    const windowOptions = only("WindowOptions");
    expect(score(windowOptions, ["window"])).toBe(56);
  });

  test("body hits count twice each, capped at eight", () => {
    // "create" appears six times in the WindowOptions body and not in its
    // heading: 6*2 = 12.
    const windowOptions = only("WindowOptions");
    expect(score(windowOptions, ["create"])).toBe(12);
  });

  test("the cap holds: a term repeated more than eight times scores as eight", () => {
    const windowOptions = only("WindowOptions");
    const body = windowOptions.body.toLowerCase();
    const hits = body.split("window").length - 1;
    expect(hits).toBeGreaterThan(8);
    // Still 8*2, not hits*2.
    expect(score(windowOptions, ["window"])).toBe(56);
  });

  test("a term the section never mentions scores nothing", () => {
    const empty = only("Empty");
    expect(score(empty, ["kubernetes"])).toBe(0);
  });

  test("no terms scores nothing", () => {
    expect(score(only("Empty"), [])).toBe(0);
  });

  test("a type and a func that match score on relevance alone", () => {
    // Document (type): "document" in the heading (40) and three times in its
    // body (6). Being a type adds nothing.
    expect(score(only("Document"), ["document"])).toBe(46);
    // Bind (func): "bind" in the heading (40) and three times in its body (6).
    expect(score(only("Bind"), ["bind"])).toBe(46);
  });

  test("a method is scored the same way as a type", () => {
    // Hide (method): "hide" in the heading (40) and three times in its body
    // (6). Its kind neither adds nor subtracts.
    expect(score(only("Hide"), ["hide"])).toBe(46);
  });

  test("a type that matches no term scores zero, not a flat bonus", () => {
    // "kubernetes" appears nowhere in the fixture. A type used to score 8 for
    // existing; the kind is not a match.
    expect(score(only("Document"), ["kubernetes"])).toBe(0);
    expect(score(only("Bind"), ["kubernetes"])).toBe(0);
  });
});

describe("rank", () => {
  test("drops sections that scored nothing and sorts the rest by score", () => {
    const ranked = rank(fixtureSections, tokens("create a native window"));
    expect(ranked.length).toBeGreaterThan(0);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
    }
    expect(ranked.every((entry) => entry.score > 0)).toBe(true);
  });

  test("the best answer for a native-window query is the WindowOptions type", () => {
    const ranked = rank(fixtureSections, tokens("create a native window"));
    expect(ranked[0].section.name).toBe("WindowOptions");
    // "window" in the heading (40) plus eight body hits (16), "native" four
    // body hits (8) and "create" six body hits (12).
    expect(ranked[0].score).toBe(76);
  });

  test("a query nothing matches returns no sections at all", () => {
    // "kubernetes" appears nowhere in the fixture, and no section earns a
    // score for merely being a type or a func, so nothing survives the filter
    // and the caller reaches the no-match response.
    expect(rank(fixtureSections, tokens("kubernetes"))).toHaveLength(0);
    expect(rank(fixtureSections, tokens("zzzz"))).toHaveLength(0);
  });

  test("a query with no terms at all returns no sections", () => {
    // Punctuation tokenises to nothing, which matches nothing.
    expect(rank(fixtureSections, tokens("?! - /"))).toHaveLength(0);
  });

  test("among sections that match equally, a whole type outranks one of its methods", () => {
    // "window" is in the heading of both Window (type) and Window (method) on
    // Page, and both bodies mention it five times: 40 + 5*2 = 50 each. Only
    // the kind separates them, and the type must come first.
    const ranked = rank(fixtureSections, tokens("window"));
    const type = ranked.findIndex(
      (entry) => entry.section.name === "Window" && entry.section.kind === "type",
    );
    const method = ranked.findIndex(
      (entry) =>
        entry.section.name === "Window" &&
        entry.section.kind === "method" &&
        entry.section.receiver === "Page",
    );
    expect(ranked[type].score).toBe(ranked[method].score);
    expect(type).toBeLessThan(method);
  });

  test("the kind preference never lifts a section above one that matches better", () => {
    // Neither heading contains the term, so the scores are body hits alone: a
    // type that mentions it twice (4) must still rank below a method that
    // mentions it eight times (16). The kind is a tie-break, not a score — and
    // the old flat type bonus of 8 was exactly what let an unrelated type
    // outrank a relevant method.
    const base = { level: 3 } as const;
    const ranked = rank(
      [
        {
          ...base,
          heading: "Alpha (type)",
          name: "Alpha",
          kind: "type" as const,
          body: "zzz here, zzz again",
        },
        {
          ...base,
          heading: "Beta (method)",
          name: "Beta",
          kind: "method" as const,
          body: "zzz 1 zzz 2 zzz 3 zzz 4 zzz 5 zzz 6 zzz 7 zzz 8",
        },
      ],
      ["zzz"],
    );
    expect(ranked.map((entry) => entry.section.name)).toEqual(["Beta", "Alpha"]);
    expect(ranked[0].score).toBe(16);
    expect(ranked[1].score).toBe(4);
  });

  test("every section is a candidate, headings included", () => {
    // A group heading such as "Types" is scored on its text like any other
    // section, so a query naming it still finds it.
    const ranked = rank(fixtureSections, tokens("types"));
    expect(ranked.some((entry) => entry.section.kind === "heading")).toBe(true);
  });
});

describe("rank: the kind preference is a tie-break, not a score", () => {
  test("a type, a func and a method that match equally rank in that order", () => {
    // A section built by hand so the three kinds match identically: the same
    // term once in the heading and once in the body, worth 42 each. Only the
    // kind can separate them.
    const base = { level: 3, body: "mentions zzz once here" } as const;
    const same = [
      { ...base, heading: "Zzz (method)", name: "Zzz", kind: "method" as const },
      { ...base, heading: "Zzz (func)", name: "Zzz", kind: "func" as const },
      { ...base, heading: "Zzz (type)", name: "Zzz", kind: "type" as const },
    ];
    const ranked = rank([...same], ["zzz"]);
    expect(ranked.map((entry) => entry.section.kind)).toEqual([
      "type",
      "func",
      "method",
    ]);
    // All three scored the same: the order came from the kind, not the score.
    expect(new Set(ranked.map((entry) => entry.score)).size).toBe(1);
  });

  test("a group heading ranks below a declaration that matches equally", () => {
    const base = { level: 3, body: "mentions zzz once here" } as const;
    const ranked = rank(
      [
        { ...base, heading: "Zzz", name: "Zzz", kind: "heading" as const },
        { ...base, heading: "Zzz (method)", name: "Zzz", kind: "method" as const },
      ],
      ["zzz"],
    );
    expect(ranked.map((entry) => entry.section.kind)).toEqual([
      "method",
      "heading",
    ]);
  });
});

describe("rank: a query in a script without word breaks", () => {
  test("the sections about creating a window come first", () => {
    // New and NewEx are the two that say 窗口\_创建. Each uses 创建 once (2) and
    // 窗口 more than eight times, which the cap counts as eight (16), so both
    // score 18 and the document order between them decides. The point of the
    // test is that anything comes back at all: before bigrams, "创建窗口"
    // tokenised to nothing and every type and func came back in document
    // order instead.
    const ranked = rank(zhSections, tokens("创建窗口"));
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.slice(0, 2).map((entry) => entry.section.name).sort()).toEqual(
      ["New", "NewEx"],
    );
    expect(ranked[0].score).toBe(18);
    // NewByLayout (10) and NewByHandle (8) follow: they use both terms but
    // fewer times.
    expect(ranked[2].section.name).toBe("NewByLayout");
  });

  test("a section that shares no character with the query is dropped", () => {
    // EnableAutoWrap and AddEvent_Menu_DrawItem are in the same document but
    // their prose never uses 创建 or 窗口, so they are not answers.
    const names = rank(zhSections, tokens("创建窗口")).map(
      (entry) => entry.section.name,
    );
    expect(names).not.toContain("EnableAutoWrap");
    expect(names).not.toContain("AddEvent_Menu_DrawItem");
  });

  test("a single-character query still matches", () => {
    // One character is a word in these scripts, so it is a term, unlike the
    // single ASCII letter that is dropped as noise.
    const ranked = rank(zhSections, tokens("窗"));
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.some((entry) => entry.section.name === "NewEx")).toBe(true);
  });

  test("a query in these scripts that matches nothing returns no sections", () => {
    // None of these characters appear in the fixture.
    expect(rank(zhSections, tokens("数据库连接"))).toHaveLength(0);
  });
});
