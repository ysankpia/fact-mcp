/**
 * The foreign-library rule: does a bare name denote another ecosystem?
 *
 * The numbers are the real ones measured on 2026-11-11, so the thresholds are
 * tested against the cases that motivated the rule rather than invented data.
 */

import { describe, expect, test } from "bun:test";

import { isForeignLibrary } from "../src/orchestrator.ts";

describe("isForeignLibrary", () => {
  test("a JavaScript leader dwarfs the small Go package of the same name", () => {
    // "react": react/react (JavaScript, 252,537) vs the best Go repo, 235.
    expect(
      isForeignLibrary(235, { language: "JavaScript", stars: 252_537 }),
    ).toBe(true);
  });

  test("a non-Go leader with no same-named Go repository is foreign", () => {
    // "django": django/django (Python, 91,739); no exact-name Go repository.
    expect(isForeignLibrary(undefined, { language: "Python", stars: 91_739 })).toBe(
      true,
    );
  });

  test("a Go leader is never foreign", () => {
    expect(isForeignLibrary(89_620, { language: "Go", stars: 89_620 })).toBe(
      false,
    );
  });

  test("a non-Go leader does not make a serious Go library foreign", () => {
    // "zap": a Batchfile repository leads at 36,004, but uber-go/zap has
    // 24,691 — far inside the ten-times margin.
    expect(
      isForeignLibrary(24_691, { language: "Batchfile", stars: 36_004 }),
    ).toBe(false);
  });

  test("an unknown language is not treated as foreign", () => {
    expect(isForeignLibrary(100, { language: null, stars: 900_000 })).toBe(false);
  });

  test("the ten-times boundary counts as foreign", () => {
    expect(isForeignLibrary(1_000, { language: "Rust", stars: 10_000 })).toBe(
      true,
    );
    expect(isForeignLibrary(1_001, { language: "Rust", stars: 10_000 })).toBe(
      false,
    );
  });
});
