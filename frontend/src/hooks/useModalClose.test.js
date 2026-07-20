import test from 'node:test';
import assert from 'node:assert/strict';

import {
  dispatchEscape, _pushLayer, _removeLayer, _layerCount,
} from './useModalClose.js';

// The stack, not the React wrapper. Escape dismissing exactly one layer — the
// top one — is the invariant every nested popup depends on: a modal with a
// dropdown inside it, or the bulk-schedule modal's nested warning.
const layer = (log, name) => ({ current: () => log.push(name) });

test('escape dismisses only the topmost layer', () => {
  const log = [];
  const modal = layer(log, 'modal');
  const dropdown = layer(log, 'dropdown');
  _pushLayer(modal);
  _pushLayer(dropdown);        // opened later => on top

  dispatchEscape();
  assert.deepEqual(log, ['dropdown'], 'must not also close the modal beneath');

  _removeLayer(dropdown);
  dispatchEscape();
  assert.deepEqual(log, ['dropdown', 'modal'], 'second press closes the modal');

  _removeLayer(modal);
  assert.equal(_layerCount(), 0);
});

test('escape with nothing open is a no-op', () => {
  assert.equal(_layerCount(), 0);
  assert.equal(dispatchEscape(), false);
});

test('unmounting out of order leaves the right layer on top', () => {
  const log = [];
  const a = layer(log, 'a');
  const b = layer(log, 'b');
  const c = layer(log, 'c');
  _pushLayer(a); _pushLayer(b); _pushLayer(c);

  // b closes first (e.g. a nested popup dismissed by its own button).
  _removeLayer(b);
  dispatchEscape();
  assert.deepEqual(log, ['c']);

  _removeLayer(c);
  dispatchEscape();
  assert.deepEqual(log, ['c', 'a']);

  _removeLayer(a);
  assert.equal(_layerCount(), 0);
});

test('removing a layer twice does not corrupt the stack', () => {
  const log = [];
  const a = layer(log, 'a');
  _pushLayer(a);
  _removeLayer(a);
  _removeLayer(a);
  assert.equal(_layerCount(), 0);
  assert.equal(dispatchEscape(), false);
});
