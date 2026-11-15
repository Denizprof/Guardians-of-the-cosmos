// World-view reduction of the crop-type layer (pipeline/src/build-crop-overview.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CLASSES, MIN_SHARE, downsample } from '../src/build-crop-overview.mjs';

const grid = (rows) => Uint8Array.from(rows.flat());

test('a block with too little cropland stays empty: scattered fields are not blown up into farmland', () => {
  // 4x4 block, 3 of 16 samples are crops (19 %), below the 25 % share
  const g = grid([[1, 0, 0, 0], [0, 4, 0, 0], [0, 0, 0, 0], [0, 0, 0, 2]]);
  assert.deepEqual([...downsample(g, 4, 4)], [0]);
  assert.equal(MIN_SHARE, 0.25);
});

test('a block with enough cropland takes the most common crop class, not the most specific one', () => {
  const g = grid([[1, 1, 1, 0], [1, 4, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  assert.deepEqual([...downsample(g, 4, 4)], [1]);
});

test('a tie goes to the more specific class', () => {
  const g = grid([[1, 1, 4, 4], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  assert.deepEqual([...downsample(g, 4, 4)], [4]);
});

test('each output pixel only sees its own block', () => {
  const g = grid([[3, 3, 0, 0], [3, 3, 0, 0], [0, 0, 2, 0], [0, 0, 0, 0]]);
  assert.deepEqual([...downsample(g, 4, 2)], [3, 0, 0, 2]);
});

test('never outputs a class that is not in the input, and empty stays empty', () => {
  assert.deepEqual([...downsample(new Uint8Array(64), 8, 4)], [0, 0, 0, 0]);
  const g = new Uint8Array(64).fill(2);
  assert.deepEqual([...downsample(g, 8, 8)], [2]);
});

test('four classes, from the most general to the most specific', () => {
  assert.deepEqual(CLASSES.map((c) => c.product), ['temporarycrops', 'springcereals', 'wintercereals', 'maize']);
});
