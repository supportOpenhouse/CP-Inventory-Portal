/**
 * useState that survives navigation — filter selections come back when the
 * user returns to the page.
 *
 * Backed by localStorage, NOT the DB: a filter is a per-device UI preference,
 * not user data. It costs nothing to lose and shouldn't cost a round-trip to
 * restore. Navigating away unmounts the page component (react-router), so
 * plain useState loses everything; this keeps it.
 *
 * All keys share the STICKY_PREFIX namespace so `clearSticky()` can drop the
 * whole set on logout — otherwise the next person to sign in on a shared
 * browser inherits the previous user's RM / city / stage filters.
 */
import { useEffect, useState } from 'react';

export const STICKY_PREFIX = 'ohf:';

// `undefined` means "nothing usable stored" — distinct from a stored `null`,
// which is a legitimate value a caller may have saved.
export function readSticky(key, storage = safeStorage()) {
  if (!storage) return undefined;
  try {
    const raw = storage.getItem(STICKY_PREFIX + key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    // Corrupt JSON from an older shape — treat as absent rather than throwing
    // the whole page into an error boundary over a remembered filter.
    return undefined;
  }
}

export function writeSticky(key, value, storage = safeStorage()) {
  if (!storage) return;
  try {
    storage.setItem(STICKY_PREFIX + key, JSON.stringify(value));
  } catch {
    // Quota exceeded / Safari private mode. A forgotten filter is not an error.
  }
}

// `ns` narrows the purge to one namespace ('submissions'); omit it to drop
// everything sticky (logout).
export function clearSticky(storage = safeStorage(), ns = '') {
  if (!storage) return;
  const scope = ns ? `${STICKY_PREFIX}${ns}.` : STICKY_PREFIX;
  try {
    // Collect first: removing during the index walk shifts the remaining keys.
    const doomed = [];
    for (let i = 0; i < storage.length; i += 1) {
      const k = storage.key(i);
      if (k && k.startsWith(scope)) doomed.push(k);
    }
    doomed.forEach((k) => storage.removeItem(k));
  } catch {
    // noop
  }
}

/**
 * Age out a whole namespace at once and report whether it's now empty.
 *
 * Filters go stale as a SET — a stage picked 13h ago shouldn't survive just
 * because the city tab was touched an hour later — so one stamp covers the
 * group instead of a TTL per key.
 *
 * Returns true when the caller should treat the store as empty: either it
 * expired just now, or nothing was ever saved. That's the signal to fall back
 * to a default (on Submissions, the user's priority preset).
 */
export function expireSticky(ns, ttlMs, now = Date.now(), storage = safeStorage()) {
  const stamp = readSticky(stampKey(ns), storage);
  if (typeof stamp === 'number' && now - stamp < ttlMs) return false;
  clearSticky(storage, ns);
  return true;
}

// Restart the TTL window. Called whenever a filter in the namespace changes,
// so "expired" means 12h of not touching the filters, not 12h since first use.
export function touchSticky(ns, now = Date.now(), storage = safeStorage()) {
  writeSticky(stampKey(ns), now, storage);
}

// Lives under the namespace so clearSticky(ns) takes the stamp with it.
const stampKey = (ns) => `${ns}.__stamp`;

function safeStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // blocked by browser settings
  }
}

/**
 * @param key      namespace-relative storage key, e.g. 'submissions.city'
 * @param initial  value (or lazy fn) used when nothing is stored
 * @param override when not undefined, wins over the stored value on mount —
 *                 for deep links like ?status=Unapproved, where the URL is a
 *                 deliberate instruction and must beat "what I used last time".
 */
export function useStickyState(key, initial, override) {
  const [value, setValue] = useState(() => {
    if (override !== undefined) return override;
    const stored = readSticky(key);
    if (stored !== undefined) return stored;
    return typeof initial === 'function' ? initial() : initial;
  });

  useEffect(() => { writeSticky(key, value); }, [key, value]);

  return [value, setValue];
}
