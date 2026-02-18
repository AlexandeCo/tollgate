/**
 * extractor.test.js — Unit tests for src/extractor.js
 * 
 * Uses Node's built-in test runner (node:test + node:assert).
 * Run: node --test test/extractor.test.js
 * 
 * 🔬 Quill — QA Lead
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';

import {
  extractHeaders,
  extractBody,
  isStreaming,
  StreamTap,
} from '../src/extractor.js';

// ─── extractHeaders() ───────────────────────────────────────────────────────

test('extractHeaders() with full rate limit headers present', () => {
  const headers = {
    'request-id':                                       'req_01XYZ',
    'anthropic-ratelimit-requests-remaining':            '42',
    'anthropic-ratelimit-tokens-remaining':              '38000',
    'anthropic-ratelimit-input-tokens-remaining':        '20000',
    'anthropic-ratelimit-output-tokens-remaining':       '18000',
    'anthropic-ratelimit-requests-reset':                '2026-02-18T22:00:00Z',
    'anthropic-ratelimit-tokens-reset':                  '2026-02-18T22:05:00Z',
  };

  const snap = extractHeaders(headers);

  assert.equal(snap.requestId,             'req_01XYZ');
  assert.equal(snap.requestsRemaining,     42);
  assert.equal(snap.tokensRemaining,       38000);
  assert.equal(snap.inputTokensRemaining,  20000);
  assert.equal(snap.outputTokensRemaining, 18000);
  assert.equal(snap.requestsReset,         '2026-02-18T22:00:00Z');
  assert.equal(snap.tokensReset,           '2026-02-18T22:05:00Z');
  assert.ok(typeof snap.ts === 'number', 'ts should be a numeric timestamp');
});

test('extractHeaders() with partial headers — missing fields become null', () => {
  const headers = {
    'anthropic-ratelimit-tokens-remaining': '5000',
  };

  const snap = extractHeaders(headers);

  assert.equal(snap.tokensRemaining,       5000,  'present field parses correctly');
  assert.equal(snap.requestId,             null,  'missing requestId is null');
  assert.equal(snap.requestsRemaining,     null,  'missing requestsRemaining is null');
  assert.equal(snap.inputTokensRemaining,  null,  'missing inputTokensRemaining is null');
  assert.equal(snap.outputTokensRemaining, null,  'missing outputTokensRemaining is null');
  assert.equal(snap.requestsReset,         null,  'missing requestsReset is null');
  assert.equal(snap.tokensReset,           null,  'missing tokensReset is null');
});

test('extractHeaders() with no headers — all fields null', () => {
  const snap = extractHeaders({});

  assert.equal(snap.requestId,             null);
  assert.equal(snap.requestsRemaining,     null);
  assert.equal(snap.tokensRemaining,       null);
  assert.equal(snap.inputTokensRemaining,  null);
  assert.equal(snap.outputTokensRemaining, null);
  assert.equal(snap.requestsReset,         null);
  assert.equal(snap.tokensReset,           null);
});

test('extractHeaders() with null input — does not throw', () => {
  const snap = extractHeaders(null);
  assert.equal(snap.requestId, null);
  assert.equal(snap.tokensRemaining, null);
});

test('extractHeaders() with non-numeric token value — returns null', () => {
  const snap = extractHeaders({ 'anthropic-ratelimit-tokens-remaining': 'bogus' });
  assert.equal(snap.tokensRemaining, null);
});

// ─── extractBody() ──────────────────────────────────────────────────────────

test('extractBody() for non-streaming JSON body with usage object', () => {
  const body = JSON.stringify({
    id:          'msg_01ABC',
    type:        'message',
    role:        'assistant',
    model:       'claude-opus-4-6',
    stop_reason: 'end_turn',
    usage: {
      input_tokens:  100,
      output_tokens: 250,
      cache_read_input_tokens:     50,
      cache_creation_input_tokens: 10,
    },
  });

  const result = extractBody(body);

  assert.equal(result.inputTokens,   100);
  assert.equal(result.outputTokens,  250);
  assert.equal(result.cacheRead,     50);
  assert.equal(result.cacheCreation, 10);
  assert.equal(result.stopReason,    'end_turn');
  assert.equal(result.model,         'claude-opus-4-6');
});

test('extractBody() with partial usage — missing fields default to 0', () => {
  const body = JSON.stringify({
    model:       'claude-sonnet-4-6',
    stop_reason: 'max_tokens',
    usage: { input_tokens: 500 },
  });

  const result = extractBody(body);
  assert.equal(result.inputTokens,   500);
  assert.equal(result.outputTokens,  0);
  assert.equal(result.cacheRead,     0);
  assert.equal(result.cacheCreation, 0);
  assert.equal(result.stopReason,    'max_tokens');
  assert.equal(result.model,         'claude-sonnet-4-6');
});

test('extractBody() with no usage object — returns empty usage', () => {
  const body = JSON.stringify({ type: 'message' });
  const result = extractBody(body);

  assert.equal(result.inputTokens,   0);
  assert.equal(result.outputTokens,  0);
  assert.equal(result.cacheRead,     0);
  assert.equal(result.cacheCreation, 0);
  assert.equal(result.stopReason,    null);
  assert.equal(result.model,         null);
});

test('extractBody() with malformed JSON — returns empty usage without throwing', () => {
  const result = extractBody('not valid json {{{');

  assert.equal(result.inputTokens,  0);
  assert.equal(result.outputTokens, 0);
  assert.equal(result.stopReason,   null);
  assert.equal(result.model,        null);
});

test('extractBody() with Buffer input — decodes and parses correctly', () => {
  const body = Buffer.from(JSON.stringify({
    model: 'claude-haiku-4-6',
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 20 },
  }));

  const result = extractBody(body);
  assert.equal(result.inputTokens,  10);
  assert.equal(result.outputTokens, 20);
  assert.equal(result.model,        'claude-haiku-4-6');
});

// ─── isStreaming() ───────────────────────────────────────────────────────────

test('isStreaming() returns true for text/event-stream content-type', () => {
  assert.equal(isStreaming({ 'content-type': 'text/event-stream' }), true);
});

test('isStreaming() returns false for application/json', () => {
  assert.equal(isStreaming({ 'content-type': 'application/json' }), false);
});

test('isStreaming() returns false with no headers', () => {
  assert.equal(isStreaming({}), false);
  assert.equal(isStreaming(null), false);
});

// ─── StreamTap ──────────────────────────────────────────────────────────────

/**
 * Helper: pipe chunks through StreamTap, collect output, resolve with usage.
 */
function tapStream(chunks) {
  return new Promise((resolve, reject) => {
    let usage = null;
    const tap = new StreamTap((u) => { usage = u; });

    const output = [];
    const sink = new Writable({
      write(chunk, _enc, cb) { output.push(chunk); cb(); },
    });

    tap.on('error', reject);
    sink.on('error', reject);
    sink.on('finish', () => resolve({ usage, output: Buffer.concat(output).toString('utf8') }));

    tap.pipe(sink);

    for (const chunk of chunks) {
      tap.write(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    tap.end();
  });
}

test('StreamTap passes all data through unchanged', async () => {
  const sse = [
    'event: message_start\n',
    'data: {"type":"message_start","message":{"model":"claude-sonnet-4-6","usage":{"input_tokens":50}}}\n\n',
    'event: message_delta\n',
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":120}}\n\n',
  ].join('');

  const { output } = await tapStream([sse]);
  assert.equal(output, sse, 'StreamTap must not alter the data passing through');
});

test('StreamTap fires onUsage callback with correct usage on stream end', async () => {
  const sse = [
    'event: message_start\n',
    'data: {"type":"message_start","message":{"model":"claude-opus-4-6","usage":{"input_tokens":100,"cache_read_input_tokens":20,"cache_creation_input_tokens":5}}}\n\n',
    'event: message_delta\n',
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":200}}\n\n',
  ].join('');

  const { usage } = await tapStream([sse]);

  assert.ok(usage !== null, 'onUsage callback should be fired');
  assert.equal(usage.inputTokens,   100);
  assert.equal(usage.outputTokens,  200);
  assert.equal(usage.cacheRead,     20);
  assert.equal(usage.cacheCreation, 5);
  assert.equal(usage.stopReason,    'end_turn');
  assert.equal(usage.model,         'claude-opus-4-6');
});

test('StreamTap handles stream split across multiple chunks', async () => {
  // Split the SSE event at an arbitrary byte boundary to test buffering
  const full = 'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-haiku-4-6","usage":{"input_tokens":30}}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":60}}\n\n';
  const mid = Math.floor(full.length / 2);
  const chunks = [full.slice(0, mid), full.slice(mid)];

  const { usage } = await tapStream(chunks);

  assert.equal(usage.inputTokens,  30);
  assert.equal(usage.outputTokens, 60);
  assert.equal(usage.stopReason,   'end_turn');
});

test('StreamTap with empty stream — fires onUsage with zero usage', async () => {
  const { usage } = await tapStream([]);

  assert.ok(usage !== null, 'onUsage callback should fire even for empty stream');
  assert.equal(usage.inputTokens,  0);
  assert.equal(usage.outputTokens, 0);
  assert.equal(usage.cacheRead,    0);
  assert.equal(usage.stopReason,   null);
  assert.equal(usage.model,        null);
});
