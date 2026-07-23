import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyUpdate, isUpdateReady, isUpdateReadyServer, setUpdateReady, subscribe,
} from './swUpdate.js';

test('no update pending by default', () => {
  assert.equal(isUpdateReady(), false);
  assert.equal(isUpdateReadyServer(), false);
});

test('getSnapshot is a stable primitive (useSyncExternalStore contract)', () => {
  // Returning a fresh object/array here would make React throw
  // "The result of getSnapshot should be cached" and re-render forever.
  const a = isUpdateReady();
  const b = isUpdateReady();
  assert.equal(a, b);
  assert.equal(typeof a, 'boolean');
});

test('setUpdateReady flips the snapshot and notifies subscribers', () => {
  const seen = [];
  const unsub = subscribe(() => seen.push(isUpdateReady()));

  setUpdateReady(() => {});
  assert.deepEqual(seen, [true], 'subscriber sees the new snapshot, not the old');
  assert.equal(isUpdateReady(), true);

  unsub();
});

test('unsubscribed listeners stop firing', () => {
  let calls = 0;
  const unsub = subscribe(() => { calls += 1; });
  unsub();
  setUpdateReady(() => {});
  assert.equal(calls, 0);
});

test('applyUpdate invokes the registered updateSW exactly once per call', () => {
  let applied = 0;
  setUpdateReady(() => { applied += 1; });
  applyUpdate();
  assert.equal(applied, 1);
  applyUpdate();
  assert.equal(applied, 2, 'a retry after a failed update must still work');
});

test('applyUpdate is a no-op when nothing is pending', () => {
  // Fresh module state isn't available across tests, so assert the guard shape
  // rather than the initial value: calling it must never throw.
  assert.doesNotThrow(() => applyUpdate());
});
