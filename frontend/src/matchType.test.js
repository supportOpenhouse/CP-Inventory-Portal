import test from 'node:test';
import assert from 'node:assert/strict';

import { isFuzzyMatch, matchBadgeText, matchCategory, matchTypeLabel } from './matchType.js';

const detail = (over = {}) => ({ source: 'submissions', match: 'exact', ...over });

test('category precedence: highest signal wins', () => {
  assert.equal(matchCategory({ perfect_match_at_submit: true, collated_match: true }), 'perfect');
  assert.equal(matchCategory({ submissions_match: true, collated_match: true }), 'submissions');
  assert.equal(matchCategory({ collated_match: true }), 'collated');
  assert.equal(matchCategory({}), null);
  assert.equal(matchCategory(null), null);
});

test('literal match keeps the existing labels', () => {
  const s = { perfect_match_at_submit: true, match_details: [detail()] };
  assert.equal(matchTypeLabel(s), 'Perfect match');
  assert.equal(matchBadgeText(s), 'PERFECT');
  assert.equal(isFuzzyMatch(s), false);
});

test('fuzzy match renames without changing category', () => {
  const s = { perfect_match_at_submit: true, match_details: [detail({ match: 'fuzzy' })] };
  assert.equal(matchTypeLabel(s), 'Fuzzy Perfect Match');
  assert.equal(matchBadgeText(s), 'FUZZY PERFECT');
  assert.equal(isFuzzyMatch(s), true);
  // Category is unchanged => caller keeps using the same red colour class.
  assert.equal(matchCategory(s), 'perfect');
});

test('fuzziness is per-category, not per-row', () => {
  // A fuzzy submissions hit that ALSO saw a 99acres listing. The collated chip
  // must not inherit the submissions chip's fuzziness.
  const s = {
    submissions_match: true,
    collated_match: true,
    match_details: [
      detail({ source: 'submissions', match: 'fuzzy' }),
      detail({ source: 'inventory', match: 'partial' }),
    ],
  };
  assert.equal(matchTypeLabel(s, 'submissions'), 'Fuzzy Submissions Match');
  assert.equal(matchTypeLabel(s, 'collated'), 'Collated match');
});

test('missing / empty match_details is never fuzzy', () => {
  assert.equal(isFuzzyMatch({ perfect_match_at_submit: true }), false);
  assert.equal(isFuzzyMatch({ perfect_match_at_submit: true, match_details: [] }), false);
  // Older un-backfilled rows still get their plain label, not a crash.
  assert.equal(matchTypeLabel({ perfect_match_at_submit: true }), 'Perfect match');
});

test('no match => no label', () => {
  assert.equal(matchTypeLabel({}), null);
  assert.equal(matchBadgeText({}), null);
});
