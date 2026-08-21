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

export function clearSticky(storage = safeStorage()) {
  if (!storage) return;
  try {
    // Collect first: removing during the index walk shifts the remaining keys.
    const doomed = [];
    for (let i = 0; i < storage.length; i += 1) {
      const k = storage.key(i);
      if (k && k.startsWith(STICKY_PREFIX)) doomed.push(k);
    }
    doomed.forEach((k) => storage.removeItem(k));
  } catch {
    // noop
  }
}

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
