/**
 * Per-submission detail cache ({ ...submission, events }) that persists across
 * open/close of the row-expand and the card popup — so reopening shows the
 * last-known state INSTANTLY instead of re-fetching (and re-shimmering) every
 * time. Section saves write the confirmed row back here via onChanged, so the
 * store stays current and the user sees their own edits naturally.
 *
 * It deliberately survives the api.js GET-cache wipe that a write triggers
 * (that wipe is what forced the reopen reload). It is NOT keyed to identity, so
 * it MUST be cleared on logout (see AuthContext) — a soft logout keeps the JS
 * context alive and the next user must not inherit the previous user's rows.
 */
const store = new Map(); // id -> { ...submission, events }

export const detailStore = {
  get: (id) => store.get(id),
  has: (id) => store.has(id),
  set: (id, data) => { store.set(id, data); },
  clear: () => store.clear(),
};
