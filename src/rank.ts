/**
 * Ranking: how well a section answers a query.
 *
 * A heading hit means the section is about the term; body hits alone are
 * usually incidental mentions (a "window" mentioned in an unrelated method),
 * so they count for much less.
 *
 * A section that shares no term with the query scores zero. The kind of a
 * declaration is a preference, not a match: a whole type or func outranks one
 * of its methods when both match equally, but it never makes an unrelated
 * section look relevant.
 *
 * Queries in a script that has no word breaks (Chinese, Japanese, Korean,
 * Thai, Lao, Khmer, Myanmar) cannot be split on whitespace, so they are
 * indexed as overlapping character bigrams instead. English matching is
 * untouched: those scripts never appear in an ASCII word.
 */

import type { Section, SectionKind } from "./sections.ts";

const HEADING_HIT = 40;
const BODY_HIT = 2;
/** Body hits past this are ignored: a term in a long struct is not more telling. */
const BODY_HIT_CAP = 8;

/**
 * What a verb in a question means in an API name.
 *
 * A developer asks "how do I create a window"; the declaration is called
 * `NewWindow`, and "create" appears nowhere in it. Without this map the query
 * scores the one section that is *about* windows (`WindowOptions`, a long struct
 * that repeats the word) above the one that *does* it.
 *
 * Only verbs whose API name is not the verb itself belong here. "Add", "set",
 * "get" and "delete" are usually the literal method name, so expanding them
 * would only add noise — `AddParam` would start competing with `AddCommand`.
 *
 * This is a fixed, reviewable table, not a model: it cannot invent a synonym,
 * and a wrong entry shows up as a ranking regression in the tests.
 */
const VERB_INTENT: Record<string, string[]> = {
  create: ["new"],
  make: ["new"],
  build: ["new"],
  open: ["new", "open"],
  start: ["run", "listen", "serve"],
  serve: ["listen", "serve"],
  read: ["read", "load", "decode", "parse"],
  write: ["write", "put", "encode"],
  upload: ["create", "put", "copy"],
  download: ["open", "copy"],
  print: ["print", "format", "indent", "marshal"],
  format: ["format", "indent"],
  route: ["get", "post", "handle", "group"],
  define: ["type", "struct", "var", "const"],
};

/** Question words that carry no API meaning and must not score anything. */
const QUESTION_WORDS = new Set([
  "how",
  "what",
  "why",
  "when",
  "where",
  "which",
  "do",
  "does",
  "did",
  "can",
  "could",
  "should",
  "would",
  "the",
  "a",
  "an",
  "in",
  "to",
  "of",
  "for",
  "and",
  "or",
  "my",
  "it",
  "is",
  "are",
  "be",
  "with",
  "on",
  "from",
  "that",
  "this",
  "i",
]);

/**
 * How much a declaration's kind is preferred when two sections match equally.
 *
 * A type is the answer more often than a func, and both are named units that
 * outrank a method on one receiver. A group heading is a place in the document,
 * not an answer, so it is last among equals.
 */
const KIND_PREFERENCE: Partial<Record<SectionKind, number>> = {
  type: 3,
  func: 2,
  method: 1,
  const: 1,
  var: 1,
  block: 1,
};

/** The kind preference a section earns, zero when it is a group heading. */
function kindPreference(section: Section): number {
  return KIND_PREFERENCE[section.kind] ?? 0;
}

/**
 * Scripts written without spaces between words. A run of these characters is
 * one word, so it is indexed by character n-grams instead of being dropped.
 */
const UNSPACED_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]+/gu;

/** A section with the score it earned for one query. */
export interface Ranked {
  section: Section;
  score: number;
}

/**
 * Overlapping character bigrams of a run, e.g. "创建窗口" → 创建, 建窗, 窗口.
 *
 * A single character has no bigram, so it stands as its own term: a one-letter
 * query is noise in English, but a one-character word is a word in these
 * scripts.
 */
function bigrams(run: string): string[] {
  const chars = Array.from(run);
  if (chars.length === 1) return chars;
  const out: string[] = [];
  for (let i = 0; i < chars.length - 1; i++) {
    out.push(chars[i] + chars[i + 1]);
  }
  return out;
}

/**
 * Split a query into search terms.
 *
 * Lowercased, split on anything that is not a word character, dot or
 * underscore, and with single characters dropped: "a" and "I" are noise, while
 * "Limiter.Wait" stays one term so a qualified name matches as written.
 *
 * A run of characters from a script without word breaks is additionally
 * indexed as overlapping bigrams, because nothing else in the text would ever
 * match it.
 */
export function tokens(s: string): string[] {
  const words = s
    .toLowerCase()
    .split(/[^a-z0-9_.]+/)
    .filter((t) => t.length > 1);

  const unspaced = (s.toLowerCase().match(UNSPACED_SCRIPT) ?? []).flatMap(
    bigrams,
  );

  // A term repeated in the query is one term: scoring it twice would count the
  // same body hits twice. "创建创建" and "window window" both collapse.
  return [...new Set([...words, ...unspaced])];
}

/**
 * The terms to score a section against for a question.
 *
 * The query's own terms, minus question words that match nothing useful
 * ("how", "do", "I"), plus the API stems its verbs imply. Kept separate from
 * `tokens()` so the literal words stay available for the no-match message and
 * the topic filter.
 */
export function queryTerms(s: string): string[] {
  const base = tokens(s).filter((term) => !QUESTION_WORDS.has(term));
  const implied = base.flatMap((term) => VERB_INTENT[term] ?? []);
  return [...new Set([...base, ...implied])];
}

/** How well one section answers a query, given its already-tokenised terms. */
export function score(section: Section, terms: string[]): number {
  const heading = section.heading.toLowerCase();
  const body = section.body.toLowerCase();
  let total = 0;

  for (const term of terms) {
    if (heading.includes(term)) total += HEADING_HIT;

    let index = 0;
    let hits = 0;
    while ((index = body.indexOf(term, index)) !== -1 && hits < BODY_HIT_CAP) {
      hits++;
      index += term.length;
    }
    total += hits * BODY_HIT;
  }

  return total;
}

/**
 * Score every section and return the ones that matched, best first.
 *
 * A section that scored nothing did not match the query and is dropped. Ties
 * are broken by the kind preference, then keep the document order sections()
 * produced, which is what the caller sees in a response.
 */
export function rank(sections: Section[], terms: string[]): Ranked[] {
  return sections
    .map((section) => ({ section, score: score(section, terms) }))
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        kindPreference(b.section) - kindPreference(a.section),
    );
}
