/**
 * The row-matching predicate for the Submissions client-only filters.
 *
 * Lives outside the component so BOTH the `clientFilteredSubmissions` memo (what
 * the Board/Table render) and the "Select all" handler (which must filter rows
 * it just fetched, before the memo has recomputed) run the SAME logic. Two
 * copies would let the selection and the table drift apart — that is exactly the
 * bug that showed "363 selected" under a 252-row filter.
 *
 * Plain .js, no JSX: `node --test` imports it directly (see clientFilters.test.js).
 */
export function matchesClientFilters(s, f) {
  const {
    statusFilter = [], matchTypes = [], missingInfo = [],
    priceMin = '', priceMax = '', ohPriceFilter = '', rejectReasons = [],
  } = f;

  // Stage filter is client-side (multi-select union) — the backend `status`
  // param only takes a single stage, so we post-filter instead.
  if (statusFilter.length > 0 && !statusFilter.includes(s.status)) return false;

  if (matchTypes.length > 0) {
    const flags = {
      perfect: s.perfect_match_at_submit === true,
      collated: s.collated_match === true,
      submissions: s.submissions_match === true,
      weak: s.weak_match === true,
    };
    if (!matchTypes.some((t) => flags[t])) return false;
  }

  if (missingInfo.length > 0) {
    const flags = {
      no_asking_price: !s.asking_price,
      no_seller: !s.seller_name,
    };
    if (!missingInfo.some((t) => flags[t])) return false;
  }

  if (priceMin !== '' && (Number(s.asking_price) || 0) < Number(priceMin)) return false;
  if (priceMax !== '' && (Number(s.asking_price) || 0) > Number(priceMax)) return false;

  if (ohPriceFilter) {
    const state = s.oh_state;
    if (ohPriceFilter === 'has' && state !== 'match') return false;
    if (ohPriceFilter === 'check' && !(state && state !== 'match')) return false;
  }

  if (rejectReasons.length > 0 && !rejectReasons.includes(s.status_reason)) return false;

  return true;
}
