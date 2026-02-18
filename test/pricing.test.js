/**
 * pricing.test.js — Unit tests for src/pricing.js
 * 
 * Uses Node's built-in test runner (node:test + node:assert).
 * Run: node --test test/pricing.test.js
 * 
 * 🔬 Quill — QA Lead
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PRICING,
  getPricing,
  estimateCost,
  formatCost,
} from '../src/pricing.js';

// ─── estimateCost() — known models ──────────────────────────────────────────

test('estimateCost() for claude-opus-4-6 — input cost', () => {
  // 1M input tokens at $15.00/M = $15.00
  const cost = estimateCost('claude-opus-4-6', 1_000_000, 0);
  assert.ok(Math.abs(cost - 15.00) < 0.0001, `Expected ~$15, got ${cost}`);
});

test('estimateCost() for claude-opus-4-6 — output cost', () => {
  // 1M output tokens at $75.00/M = $75.00
  const cost = estimateCost('claude-opus-4-6', 0, 1_000_000);
  assert.ok(Math.abs(cost - 75.00) < 0.0001, `Expected ~$75, got ${cost}`);
});

test('estimateCost() for claude-sonnet-4-6 — input + output', () => {
  // 500k input at $3/M = $1.50 + 200k output at $15/M = $3.00 → total $4.50
  const cost = estimateCost('claude-sonnet-4-6', 500_000, 200_000);
  const expected = (500_000 / 1_000_000) * 3.00 + (200_000 / 1_000_000) * 15.00;
  assert.ok(Math.abs(cost - expected) < 0.0001);
});

test('estimateCost() for claude-haiku-4-6 — cheaper than sonnet', () => {
  const haikuCost  = estimateCost('claude-haiku-4-6',  100_000, 100_000);
  const sonnetCost = estimateCost('claude-sonnet-4-6', 100_000, 100_000);
  assert.ok(haikuCost < sonnetCost, 'haiku should cost less than sonnet');
});

test('estimateCost() for claude-haiku-4-6 — correct per-token rate', () => {
  // 1M input at $0.80 + 1M output at $4.00 = $4.80
  const cost = estimateCost('claude-haiku-4-6', 1_000_000, 1_000_000);
  assert.ok(Math.abs(cost - 4.80) < 0.0001);
});

test('estimateCost() for claude-3-haiku-20240307 — legacy model', () => {
  // $0.25/M input, $1.25/M output
  const cost = estimateCost('claude-3-haiku-20240307', 1_000_000, 1_000_000);
  assert.ok(Math.abs(cost - 1.50) < 0.0001);
});

test('estimateCost() for claude-3-opus-20240229 — legacy opus', () => {
  const cost = estimateCost('claude-3-opus-20240229', 1_000_000, 0);
  assert.ok(Math.abs(cost - 15.00) < 0.0001);
});

test('estimateCost() for claude-3-5-sonnet-20241022 — legacy sonnet', () => {
  const cost = estimateCost('claude-3-5-sonnet-20241022', 0, 1_000_000);
  assert.ok(Math.abs(cost - 15.00) < 0.0001);
});

test('estimateCost() with all token types — cache read is cheap', () => {
  // Cache read = 10% of input price
  const opusPricing = PRICING['claude-opus-4-6'];
  const cacheReadCost = (1_000_000 / 1_000_000) * (opusPricing.input * 0.1);

  const cost = estimateCost('claude-opus-4-6', 0, 0, 1_000_000, 0);
  assert.ok(Math.abs(cost - cacheReadCost) < 0.0001, 'cache read should be 10% of input price');
});

test('estimateCost() with cache creation tokens — 125% of input price', () => {
  const opusPricing = PRICING['claude-opus-4-6'];
  const cacheCreationCost = (1_000_000 / 1_000_000) * (opusPricing.input * 1.25);

  const cost = estimateCost('claude-opus-4-6', 0, 0, 0, 1_000_000);
  assert.ok(Math.abs(cost - cacheCreationCost) < 0.0001, 'cache creation should be 125% of input price');
});

test('estimateCost() with zero tokens — returns 0', () => {
  const cost = estimateCost('claude-opus-4-6', 0, 0);
  assert.equal(cost, 0);
});

// ─── estimateCost() — unknown model ──────────────────────────────────────────

test('estimateCost() with unknown model — returns a number (graceful fallback)', () => {
  const cost = estimateCost('totally-unknown-model-xyz', 100_000, 50_000);
  assert.ok(typeof cost === 'number', 'should return a number, not throw');
  assert.ok(cost >= 0, 'cost should not be negative');
});

test('estimateCost() with null model — falls back without throwing', () => {
  const cost = estimateCost(null, 100_000, 50_000);
  assert.ok(typeof cost === 'number');
  assert.ok(cost >= 0);
});

test('estimateCost() with empty string model — falls back without throwing', () => {
  const cost = estimateCost('', 100_000, 50_000);
  assert.ok(typeof cost === 'number');
  assert.ok(cost >= 0);
});

// ─── getPricing() — prefix matching ──────────────────────────────────────────

test('getPricing() prefix match — dated model ID falls back to base', () => {
  // claude-opus-4-6-20250215 should match claude-opus-4-6
  const pricing = getPricing('claude-opus-4-6-20250215');
  assert.equal(pricing.input,  15.00);
  assert.equal(pricing.output, 75.00);
});

test('getPricing() name fragment match — "opus" in name gets opus pricing', () => {
  const pricing = getPricing('some-future-opus-model');
  assert.equal(pricing.input, 15.00);
});

test('getPricing() name fragment match — "haiku" in name gets haiku pricing', () => {
  const pricing = getPricing('some-future-haiku-model');
  assert.equal(pricing.input, 0.80);
});

// ─── formatCost() ─────────────────────────────────────────────────────────────

test('formatCost() for $0 — returns "$0.000"', () => {
  assert.equal(formatCost(0), '$0.000');
});

test('formatCost() for tiny amount (< $0.001) — uses 6 decimal places', () => {
  const result = formatCost(0.000045);
  assert.ok(result.startsWith('$'), 'should start with $');
  assert.ok(result.includes('0.000045'), `expected 6 decimal places, got: ${result}`);
});

test('formatCost() for small amount ($0.001–$0.009) — uses 4 decimal places', () => {
  const result = formatCost(0.0045);
  assert.equal(result, '$0.0045');
});

test('formatCost() for cent-range amount — uses 3 decimal places', () => {
  assert.equal(formatCost(0.015), '$0.015');
  assert.equal(formatCost(1.234), '$1.234');
  assert.equal(formatCost(75.0), '$75.000');
});

test('formatCost() for a typical small API call cost', () => {
  // 10k input + 2k output with sonnet: (10000/1M)*3 + (2000/1M)*15 = 0.03 + 0.03 = 0.06
  const cost = estimateCost('claude-sonnet-4-6', 10_000, 2_000);
  const formatted = formatCost(cost);
  assert.ok(formatted.startsWith('$'), 'should format with dollar sign');
  assert.ok(!isNaN(parseFloat(formatted.slice(1))), 'numeric portion should parse');
});
