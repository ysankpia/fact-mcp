/**
 * Ranking: score a section against the terms of a query.
 *
 * The fixture is the same real pkg.go.dev Markdown the sectioning suite uses,
 * so every expectation below is a number worked out by hand from the fixture
 * text, not a value the implementation recomputed.
 */

import { describe, expect, test } from "bun:test";

import { rank, score, tokens } from "../src/rank.ts";
import { sections } from "../src/sections.ts";

const fixture = await Bun.file(
  new URL("./fixtures/mygo.md", import.meta.url),
).text();

const fixtureSections = sections(fixture);

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
});

describe("score", () => {
  test("a heading hit is worth far more than a body hit", () => {
    // "window" is in the heading of WindowOptions (type) and eight times in
    // its body: 40 + 8*2 = 56, plus the flat 8 for a type, so 64. Without the
    // type bonus it is 56 — the assertion below separates the two.
    const windowOptions = only("WindowOptions");
    expect(score(windowOptions, ["window"])).toBe(64);
  });

  test("body hits count twice each, capped at eight", () => {
    // "create" appears six times in the WindowOptions body and not in its
    // heading: 6*2 = 12, plus the flat 8 for a type.
    const windowOptions = only("WindowOptions");
    expect(score(windowOptions, ["create"])).toBe(20);
  });

  test("the cap holds: a term repeated more than eight times scores as eight", () => {
    const windowOptions = only("WindowOptions");
    const body = windowOptions.body.toLowerCase();
    const hits = body.split("window").length - 1;
    expect(hits).toBeGreaterThan(8);
    // Still 8*2, not hits*2.
    expect(score(windowOptions, ["window"])).toBe(64);
  });

  test("a term the section never mentions scores nothing", () => {
    const empty = only("Empty");
    expect(score(empty, ["kubernetes"])).toBe(0);
  });

  test("no terms scores nothing", () => {
    expect(score(only("Empty"), [])).toBe(0);
  });

  test("the flat type and func bonuses are added as they are today", () => {
    // Document (type): "document" in the heading (40) and three times in its
    // body (6), plus the flat 8 for a type.
    expect(score(only("Document"), ["document"])).toBe(54);
    // Bind (func): "bind" in the heading (40) and three times in its body
    // (6), plus the flat 4 for a func.
    expect(score(only("Bind"), ["bind"])).toBe(50);
  });

  test("a method gets no flat bonus", () => {
    // Hide (method): "hide" in the heading (40) and three times in its body
    // (6), and nothing flat.
    expect(score(only("Hide"), ["hide"])).toBe(46);
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
    expect(ranked[0].score).toBe(84);
  });

  test("CURRENT BEHAVIOUR, NOT INTENDED: a query nothing matches still returns every type and func", () => {
    // The flat type/func bonus is added whether or not a term matched, so a
    // section that shares nothing with the query still scores 8 (type) or 4
    // (func) and survives the `score > 0` filter. "kubernetes" appears
    // nowhere in the fixture, yet every type and func comes back: nineteen of
    // them, fifteen types and four funcs.
    //
    // This is a known defect a sibling ticket fixes. It is pinned here so the
    // fix has to change this test on purpose, rather than by accident.
    const ranked = rank(fixtureSections, tokens("kubernetes"));
    expect(ranked).toHaveLength(19);
    expect(ranked.every((entry) => entry.score === 4 || entry.score === 8)).toBe(
      true,
    );
    expect(
      ranked.every((entry) =>
        ["type", "func"].includes(entry.section.kind),
      ),
    ).toBe(true);
  });

  test("every section is a candidate, headings included", () => {
    // Today a group heading such as "Types" scores on its body text like any
    // other section. Preserved here so a sibling ticket can change it.
    const ranked = rank(fixtureSections, tokens("types"));
    expect(ranked.some((entry) => entry.section.kind === "heading")).toBe(true);
  });
});
