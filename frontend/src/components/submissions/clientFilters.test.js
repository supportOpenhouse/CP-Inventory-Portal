import test from 'node:test';
import assert from 'node:assert/strict';

import { matchesClientFilters } from './clientFilters.js';

const NONE = {
  statusFilter: [], matchTypes: [], missingInfo: [],
  priceMin: '', priceMax: '', ohPriceFilter: '', rejectReasons: [],
};
const row = (over = {}) => ({ status: 'Submitted', asking_price: 100, seller_name: 'S', ...over });

test('no filters: everything matches', () => {
  assert.equal(matchesClientFilters(row(), NONE), true);
});

test('stage filter is a union, not a single stage', () => {
  const f = { ...NONE, statusFilter: ['Offer', 'Closure'] };
  assert.equal(matchesClientFilters(row({ status: 'Offer' }), f), true);
  assert.equal(matchesClientFilters(row({ status: 'Closure' }), f), true);
  assert.equal(matchesClientFilters(row({ status: 'Rejected' }), f), false);
});

test('matchTypes ORs the flags', () => {
  const f = { ...NONE, matchTypes: ['perfect', 'weak'] };
  assert.equal(matchesClientFilters(row({ perfect_match_at_submit: true }), f), true);
  assert.equal(matchesClientFilters(row({ weak_match: true }), f), true);
  assert.equal(matchesClientFilters(row({ collated_match: true }), f), false);
});

test('missingInfo matches absent fields', () => {
  const f = { ...NONE, missingInfo: ['no_asking_price'] };
  assert.equal(matchesClientFilters(row({ asking_price: null }), f), true);
  assert.equal(matchesClientFilters(row({ asking_price: 100 }), f), false);
});

test('price bounds are inclusive', () => {
  assert.equal(matchesClientFilters(row({ asking_price: 100 }), { ...NONE, priceMin: '100' }), true);
  assert.equal(matchesClientFilters(row({ asking_price: 99 }), { ...NONE, priceMin: '100' }), false);
  assert.equal(matchesClientFilters(row({ asking_price: 100 }), { ...NONE, priceMax: '100' }), true);
  assert.equal(matchesClientFilters(row({ asking_price: 101 }), { ...NONE, priceMax: '100' }), false);
});

test('ohPriceFilter has/check', () => {
  assert.equal(matchesClientFilters(row({ oh_state: 'match' }), { ...NONE, ohPriceFilter: 'has' }), true);
  assert.equal(matchesClientFilters(row({ oh_state: 'diff' }), { ...NONE, ohPriceFilter: 'has' }), false);
  assert.equal(matchesClientFilters(row({ oh_state: 'diff' }), { ...NONE, ohPriceFilter: 'check' }), true);
  assert.equal(matchesClientFilters(row({ oh_state: 'match' }), { ...NONE, ohPriceFilter: 'check' }), false);
});

test('rejectReasons matches status_reason', () => {
  const f = { ...NONE, rejectReasons: ['Hold'] };
  assert.equal(matchesClientFilters(row({ status_reason: 'Hold' }), f), true);
  assert.equal(matchesClientFilters(row({ status_reason: 'Duplicacy' }), f), false);
});

test('filters AND together', () => {
  const f = { ...NONE, statusFilter: ['Offer'], priceMin: '50' };
  assert.equal(matchesClientFilters(row({ status: 'Offer', asking_price: 60 }), f), true);
  assert.equal(matchesClientFilters(row({ status: 'Offer', asking_price: 10 }), f), false);
  assert.equal(matchesClientFilters(row({ status: 'Rejected', asking_price: 60 }), f), false);
});
