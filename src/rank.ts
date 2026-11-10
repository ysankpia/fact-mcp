/**
 * Ranking: how well a section answers a query.
 *
 * A heading hit means the section is about the term; body hits alone are
 * usually incidental mentions (a "window" mentioned in an unrelated method),
 * so they count for much less. Whole types and funcs get a flat bonus because
 * individual methods are numerous and rarely the answer on their own.
 *
 * The weights are today's, kept as they are so the split changes no behaviour.
 */

import type { Section } from "./sections.ts";

const HEADING_HIT = 40;
const BODY_HIT = 2;
/** Body hits past this are ignored: a term in a long struct is not more telling. */
const BODY_HIT_CAP = 8;
const TYPE_BONUS = 8;
const FUNC_BONUS = 4;

/** A section with the score it earned for one query. */
export interface Ranked {
  section: Section;
  score: number;
}

/**
 * Split a query into search terms.
 *
 * Lowercased, split on anything that is not a word character, dot or
 * underscore, and with single characters dropped: "a" and "I" are noise, while
 * "Limiter.Wait" stays one term so a qualified name matches as written.
 */
export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9_.]+/)
    .filter((t) => t.length > 1);
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

  if (heading.endsWith("(type)")) total += TYPE_BONUS;
  else if (heading.endsWith("(func)")) total += FUNC_BONUS;

  return total;
}

/**
 * Score every section and return the ones that matched, best first.
 *
 * Ties keep the document order sections() produced, which is what the caller
 * sees in a response.
 */
export function rank(sections: Section[], terms: string[]): Ranked[] {
  return sections
    .map((section) => ({ section, score: score(section, terms) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
}
