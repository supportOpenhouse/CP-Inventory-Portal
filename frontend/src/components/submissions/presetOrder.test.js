// node --test src/**/*.test.js   (node:test, not vitest — see CLAUDE.md)
//
// Covers the two bits of PresetBar that are easy to get subtly wrong:
// the pack-and-derive-priority invariant, and the insert-before index math
// that a rightward drag depends on.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalise, reorder } from './presetOrder.js';

const P = (name) => ({ name, filters: {} });

test('priority is the leftmost occupied slot', () => {
  const { sequence, priority } = normalise([P('a'), P('b'), null], [2, 1, 3]);
  assert.deepEqual(sequence, [2, 1, 3]);
  assert.equal(priority, 2); // slot 2 renders first, so slot 2 is priority
});

test('occupied slots pack to the front, empties trail', () => {
  // Slot 1 empty but leading — the old code left priority null here even
  // though two presets existed.
  const { sequence, priority } = normalise([null, P('b'), P('c')], [1, 2, 3]);
  assert.deepEqual(sequence, [2, 3, 1]);
  assert.equal(priority, 2);
});

test('deleting the priority preset hands priority to the next one', () => {
  const before = normalise([P('a'), P('b'), null], [1, 2, 3]);
  assert.equal(before.priority, 1);
  const after = normalise([null, P('b'), null], before.sequence);
  assert.equal(after.priority, 2);
  assert.equal(after.sequence[0], 2, 'priority slot must be sequence[0] — the DB CHECK requires it');
});

test('no presets at all means no priority', () => {
  assert.equal(normalise([null, null, null], [1, 2, 3]).priority, null);
});

test('normalise always satisfies the DB constraint priority === sequence[0]', () => {
  const combos = [];
  for (let m = 0; m < 8; m += 1) {
    combos.push([0, 1, 2].map((i) => ((m >> i) & 1 ? P(`p${i}`) : null)));
  }
  for (const presets of combos) {
    for (const seq of [[1, 2, 3], [3, 1, 2], [2, 3, 1], [3, 2, 1]]) {
      const d = normalise(presets, seq);
      if (d.priority === null) assert.ok(presets.every((p) => !p));
      else assert.equal(d.priority, d.sequence[0]);
    }
  }
});

test('reorder: drag leftward inserts before the target', () => {
  assert.deepEqual(reorder([1, 2, 3], 2, 0), [3, 1, 2]);
  assert.deepEqual(reorder([1, 2, 3], 1, 0), [2, 1, 3]);
});

test('reorder: drag rightward compensates for the removal shift', () => {
  // Dropping slot 1 past slot 3's midpoint = append. Without the -1 this
  // returned [2,1,3] — one short of the indicator.
  assert.deepEqual(reorder([1, 2, 3], 0, 3), [2, 3, 1]);
  assert.deepEqual(reorder([1, 2, 3], 0, 2), [2, 1, 3]);
});

test('reorder: dropping back on itself is a no-op', () => {
  assert.deepEqual(reorder([1, 2, 3], 1, 1), [1, 2, 3]);
  assert.deepEqual(reorder([1, 2, 3], 1, 2), [1, 2, 3]);
});

test('dragging any preset to the far left makes it priority', () => {
  // The end-to-end promise: one gesture, and the DB constraint still holds.
  const presets = [P('a'), P('b'), P('c')];
  const start = normalise(presets, [1, 2, 3]);
  assert.equal(start.priority, 1);
  const dropped = normalise(presets, reorder(start.sequence, 2, 0)); // drag 3rd chip to front
  assert.deepEqual(dropped.sequence, [3, 1, 2]);
  assert.equal(dropped.priority, 3);
  assert.equal(dropped.priority, dropped.sequence[0]);
});
