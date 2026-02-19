/**
 * router.test.js — Unit tests for src/router.js
 * 
 * Uses Node's built-in test runner (node:test + node:assert).
 * Run: node --test test/router.test.js
 * 
 * 🔬 Quill — QA Lead
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  maybeReroute,
  shouldRoute,
  DEFAULT_LADDER,
  buildRoutingHeaders,
  modelTier,
} from '../src/router.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a minimal latestSnapshot with tokens_remaining set
 * such that the computed usedPercent == targetPercent (±1 due to rounding).
 *
 * usedPercent = round(((knownLimit - remaining) / knownLimit) * 100)
 * remaining   = knownLimit * (1 - targetPercent/100)
 */
function snapshotAt(usedPercent, knownLimit = 400_000) {
  const remaining = Math.floor(knownLimit * (1 - usedPercent / 100));
  return { tokens_remaining: remaining };
}

const BASE_CONFIG = {
  routing: {
    enabled:    true,
    threshold:  80,
    knownLimit: 400_000,
  },
};

// ─── maybeReroute() — routing disabled ──────────────────────────────────────

test('maybeReroute() with routing disabled — returns body unchanged', () => {
  const config = { routing: { enabled: false, threshold: 80 } };
  const body   = { model: 'claude-opus-4-6', max_tokens: 1000 };
  const snap   = snapshotAt(90); // way over threshold, but disabled

  const result = maybeReroute(body, snap, config);

  assert.deepEqual(result.body, body, 'body must be unchanged');
  assert.equal(result.routedFrom, null);
  assert.equal(result.routedTo,   null);
});

test('maybeReroute() with no config.routing key — routing disabled', () => {
  const body = { model: 'claude-opus-4-6' };
  const snap = snapshotAt(90);

  const result = maybeReroute(body, snap, {});

  assert.deepEqual(result.body, body);
  assert.equal(result.routedFrom, null);
});

// ─── maybeReroute() — no snapshot ───────────────────────────────────────────

test('maybeReroute() with null snapshot — returns body unchanged', () => {
  const body = { model: 'claude-opus-4-6' };

  const result = maybeReroute(body, null, BASE_CONFIG);

  assert.deepEqual(result.body, body);
  assert.equal(result.routedFrom, null);
  assert.equal(result.routedTo,   null);
});

test('maybeReroute() with snapshot missing tokens_remaining — returns body unchanged', () => {
  const body = { model: 'claude-opus-4-6' };
  const snap = { tokens_remaining: null };

  const result = maybeReroute(body, snap, BASE_CONFIG);

  assert.deepEqual(result.body, body);
  assert.equal(result.routedFrom, null);
});

// ─── maybeReroute() — below threshold (79%) ─────────────────────────────────

test('maybeReroute() at 79% usage — no downgrade', () => {
  const body = { model: 'claude-opus-4-6', max_tokens: 1000 };
  const snap = snapshotAt(79);

  const result = maybeReroute(body, snap, BASE_CONFIG);

  assert.deepEqual(result.body, body, 'should not rewrite model at 79%');
  assert.equal(result.routedFrom, null);
  assert.equal(result.routedTo,   null);
});

// ─── maybeReroute() — at threshold (81%) ────────────────────────────────────

test('maybeReroute() at 81% — opus→sonnet downgrade', () => {
  const body   = { model: 'claude-opus-4-6', max_tokens: 1024 };
  const snap   = snapshotAt(81);

  const result = maybeReroute(body, snap, BASE_CONFIG);

  assert.equal(result.body.model,  'claude-sonnet-4-6', 'opus should downgrade to sonnet');
  assert.equal(result.routedFrom,  'claude-opus-4-6');
  assert.equal(result.routedTo,    'claude-sonnet-4-6');
  assert.ok(result.usedPercent >= 80, 'usedPercent should be at or above threshold');
});

test('maybeReroute() at 81% — other body fields are preserved', () => {
  const body = {
    model:      'claude-opus-4-6',
    max_tokens: 512,
    system:     'You are a helpful assistant.',
    messages:   [{ role: 'user', content: 'Hello' }],
  };
  const snap = snapshotAt(81);

  const result = maybeReroute(body, snap, BASE_CONFIG);

  assert.equal(result.body.model,       'claude-sonnet-4-6');
  assert.equal(result.body.max_tokens,  512);
  assert.equal(result.body.system,      'You are a helpful assistant.');
  assert.deepEqual(result.body.messages, [{ role: 'user', content: 'Hello' }]);
});

test('maybeReroute() at 81% with sonnet input — sonnet→haiku downgrade', () => {
  const body = { model: 'claude-sonnet-4-6', max_tokens: 200 };
  const snap = snapshotAt(81);

  const result = maybeReroute(body, snap, BASE_CONFIG);

  assert.equal(result.body.model, 'claude-haiku-4-6', 'sonnet should downgrade to haiku');
  assert.equal(result.routedFrom, 'claude-sonnet-4-6');
  assert.equal(result.routedTo,   'claude-haiku-4-6');
});

test('maybeReroute() at 81% with sonnet-4-5 input — sonnet-4-5→haiku downgrade', () => {
  const body = { model: 'claude-sonnet-4-5', max_tokens: 200 };
  const snap = snapshotAt(81);

  const result = maybeReroute(body, snap, BASE_CONFIG);

  assert.equal(result.body.model, 'claude-haiku-4-6', 'sonnet-4-5 should also downgrade to haiku');
});

test('maybeReroute() with haiku input at 81% — no further downgrade (floor)', () => {
  const body = { model: 'claude-haiku-4-6', max_tokens: 100 };
  const snap = snapshotAt(81);

  const result = maybeReroute(body, snap, BASE_CONFIG);

  assert.equal(result.body.model, 'claude-haiku-4-6', 'haiku is the floor — no further downgrade');
  assert.equal(result.routedFrom, null, 'routedFrom should be null when no downgrade happened');
  assert.equal(result.routedTo,   null, 'routedTo should be null when no downgrade happened');
});

// ─── maybeReroute() — custom ladder ─────────────────────────────────────────

test('maybeReroute() respects custom ladder from config', () => {
  const body = { model: 'my-custom-big-model' };
  const snap = snapshotAt(90);
  const config = {
    routing: {
      enabled:    true,
      threshold:  80,
      knownLimit: 400_000,
      ladder: { 'my-custom-big-model': 'my-custom-small-model' },
    },
  };

  const result = maybeReroute(body, snap, config);

  assert.equal(result.body.model, 'my-custom-small-model');
  assert.equal(result.routedFrom, 'my-custom-big-model');
  assert.equal(result.routedTo,   'my-custom-small-model');
});

// ─── maybeReroute() — null/undefined request body ───────────────────────────

test('maybeReroute() with null body — returns safely', () => {
  const snap   = snapshotAt(90);
  const result = maybeReroute(null, snap, BASE_CONFIG);

  assert.equal(result.body,       null);
  assert.equal(result.routedFrom, null);
  assert.equal(result.routedTo,   null);
});

// ─── shouldRoute() ───────────────────────────────────────────────────────────

test('shouldRoute() at exactly threshold — triggers routing', () => {
  const snap = snapshotAt(80);
  const { shouldRoute: doRoute, usedPercent } = shouldRoute(snap, BASE_CONFIG);

  assert.equal(doRoute, true);
  assert.ok(usedPercent >= 80);
});

test('shouldRoute() just below threshold — does not trigger routing', () => {
  const snap = snapshotAt(79);
  const { shouldRoute: doRoute } = shouldRoute(snap, BASE_CONFIG);

  assert.equal(doRoute, false);
});

// ─── DEFAULT_LADDER ──────────────────────────────────────────────────────────

test('DEFAULT_LADDER maps all opus variants to sonnet', () => {
  assert.equal(DEFAULT_LADDER['claude-opus-4-6'], 'claude-sonnet-4-6');
  assert.equal(DEFAULT_LADDER['claude-opus-4'],   'claude-sonnet-4-6');
});

test('DEFAULT_LADDER maps all sonnet variants to haiku', () => {
  assert.equal(DEFAULT_LADDER['claude-sonnet-4-6'], 'claude-haiku-4-6');
  assert.equal(DEFAULT_LADDER['claude-sonnet-4-5'], 'claude-haiku-4-6');
  assert.equal(DEFAULT_LADDER['claude-sonnet-4'],   'claude-haiku-4-6');
});

// ─── buildRoutingHeaders() ────────────────────────────────────────────────────

test('buildRoutingHeaders() returns correct x-sniff-* headers', () => {
  const headers = buildRoutingHeaders('claude-opus-4-6', 'claude-sonnet-4-6', 82);

  assert.equal(headers['x-tollgate-routed'],          'true');
  assert.equal(headers['x-tollgate-original-model'],  'claude-opus-4-6');
  assert.equal(headers['x-tollgate-routed-model'],    'claude-sonnet-4-6');
  assert.equal(headers['x-tollgate-reason'],          'token-threshold-82');
});

// ─── modelTier() ─────────────────────────────────────────────────────────────

test('modelTier() identifies opus, sonnet, haiku correctly', () => {
  assert.equal(modelTier('claude-opus-4-6'),   'opus');
  assert.equal(modelTier('claude-sonnet-4-6'), 'sonnet');
  assert.equal(modelTier('claude-haiku-4-6'),  'haiku');
});

test('modelTier() with null — returns "unknown"', () => {
  assert.equal(modelTier(null),      'unknown');
  assert.equal(modelTier(undefined), 'unknown');
});
