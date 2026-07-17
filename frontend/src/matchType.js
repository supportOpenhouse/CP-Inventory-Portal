/**
 * Naming for a submission's duplicate-match type, shared by CP + admin views.
 *
 * Three categories, each with a fixed colour: perfect=red, submissions=purple,
 * collated=yellow. When the backend could only reach the match through a
 * tower/unit near-miss (a typo — see backend/duplicate_check.py), the category
 * is shown as "Fuzzy {X} Match" and KEEPS X's colour: fuzzy describes how the
 * match was found, not a category of its own.
 *
 * Fuzziness is read off match_details rather than its own column — the backend
 * already tags each matched record `match: 'exact' | 'fuzzy' | 'partial'`, and
 * match_details is already in every list payload, so no extra column or
 * backfill is needed.
 *
 * Category is an explicit argument on the label helpers because a row can carry
 * several flags at once (a fuzzy submissions hit that ALSO saw a 99acres
 * listing). Collapsing to one category would label the collated chip with the
 * submissions chip's fuzziness.
 *
 * Plain .js, no JSX, so `node --test` can import it directly.
 */

const CATEGORY_NAMES = {
  perfect: 'Perfect',
  submissions: 'Submissions',
  collated: 'Collated',
};

// Which match_details sources back each category. Note `inventory` rows are
// never tagged fuzzy — that table has no tower/unit columns to typo — so
// "Fuzzy Collated Match" can't currently arise. Mapped anyway so the naming
// holds if inventory ever gains those columns.
const CATEGORY_SOURCES = {
  perfect: ['properties', 'submissions'],
  submissions: ['submissions'],
  collated: ['inventory'],
};

/** 'perfect' | 'submissions' | 'collated' | null — highest signal wins, the
 *  same precedence the row tints and card overlays use. */
export function matchCategory(s) {
  if (s?.perfect_match_at_submit === true) return 'perfect';
  if (s?.submissions_match === true) return 'submissions';
  if (s?.collated_match === true) return 'collated';
  return null;
}

/** True when this category's match was reached via a near-miss, not a literal hit. */
export function isFuzzyMatch(s, category = matchCategory(s)) {
  const sources = CATEGORY_SOURCES[category];
  if (!sources || !Array.isArray(s?.match_details)) return false;
  return s.match_details.some((m) => m?.match === 'fuzzy' && sources.includes(m?.source));
}

/** "Perfect match" / "Fuzzy Perfect Match" / null when nothing matched. */
export function matchTypeLabel(s, category = matchCategory(s)) {
  if (!CATEGORY_NAMES[category]) return null;
  return isFuzzyMatch(s, category)
    ? `Fuzzy ${CATEGORY_NAMES[category]} Match`
    : `${CATEGORY_NAMES[category]} match`;
}

/** Short all-caps form for the tight ID-column badge: "PERFECT" / "FUZZY PERFECT". */
export function matchBadgeText(s, category = matchCategory(s)) {
  if (!CATEGORY_NAMES[category]) return null;
  return `${isFuzzyMatch(s, category) ? 'FUZZY ' : ''}${CATEGORY_NAMES[category].toUpperCase()}`;
}
