// node --test src/**/*.test.js   (node:test, not vitest — see CLAUDE.md)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  readSticky, writeSticky, clearSticky, expireSticky, touchSticky, STICKY_PREFIX,
} from './useStickyState.js';

// Minimal localStorage stand-in — the pure helpers take `storage` explicitly so
// the branch logic is testable without a DOM or a React renderer.
function fakeStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _raw: m,
  };
}

test('round-trips a value through the prefixed key', () => {
  const s = fakeStorage();
  writeSticky('submissions.city', 'Noida', s);
  assert.equal(s.getItem(`${STICKY_PREFIX}submissions.city`), '"Noida"');
  assert.equal(readSticky('submissions.city', s), 'Noida');
});

test('missing key reads as undefined, not null', () => {
  // The hook distinguishes these: undefined = fall back to `initial`,
  // null = a value the caller deliberately stored.
  const s = fakeStorage();
  assert.equal(readSticky('nope', s), undefined);
  writeSticky('nulled', null, s);
  assert.equal(readSticky('nulled', s), null);
});

test('corrupt JSON reads as absent instead of throwing', () => {
  const s = fakeStorage({ [`${STICKY_PREFIX}bad`]: '{not json' });
  assert.equal(readSticky('bad', s), undefined);
});

test('arrays survive the round trip', () => {
  const s = fakeStorage();
  writeSticky('submissions.status', ['Unapproved', 'Submitted'], s);
  assert.deepEqual(readSticky('submissions.status', s), ['Unapproved', 'Submitted']);
});

test('clearSticky drops every prefixed key and nothing else', () => {
  const s = fakeStorage({
    [`${STICKY_PREFIX}a`]: '1',
    [`${STICKY_PREFIX}b`]: '2',
    [`${STICKY_PREFIX}c`]: '3',
    oh_user: '{"name":"x"}',
    oh_theme: 'dark',
  });
  clearSticky(s);
  assert.deepEqual([...s._raw.keys()].sort(), ['oh_theme', 'oh_user']);
});

test('unavailable storage degrades to a no-op', () => {
  assert.equal(readSticky('x', null), undefined);
  assert.doesNotThrow(() => writeSticky('x', 1, null));
  assert.doesNotThrow(() => clearSticky(null));
});

test('expireSticky: fresh stamp keeps the namespace', () => {
  const s = fakeStorage();
  touchSticky('submissions', 1_000_000, s);
  writeSticky('submissions.city', 'Noida', s);
  assert.equal(expireSticky('submissions', 12 * 3600e3, 1_000_000 + 3600e3, s), false);
  assert.equal(readSticky('submissions.city', s), 'Noida');
});

test('expireSticky: stale stamp wipes the namespace and reports empty', () => {
  const s = fakeStorage();
  touchSticky('submissions', 1_000_000, s);
  writeSticky('submissions.city', 'Noida', s);
  writeSticky('logs.action', 'status_change', s);
  // 13h later — past the 12h TTL.
  assert.equal(expireSticky('submissions', 12 * 3600e3, 1_000_000 + 13 * 3600e3, s), true);
  assert.equal(readSticky('submissions.city', s), undefined);
  // Other namespaces are untouched by a scoped purge.
  assert.equal(readSticky('logs.action', s), 'status_change');
});

test('expireSticky: never-stamped namespace reports empty', () => {
  // First ever visit — the caller should fall back to the priority preset.
  assert.equal(expireSticky('submissions', 12 * 3600e3, 1_000_000, fakeStorage()), true);
});
