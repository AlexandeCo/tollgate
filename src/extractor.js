/**
 * extractor.js — Parse Anthropic response headers and bodies
 * 
 * Pure functions: extract structured data from raw HTTP responses.
 * No side effects. Fully testable in isolation.
 * 
 * 🐕 Sniff's nose — turns raw bytes into useful data.
 */

import { Transform } from 'stream';

/**
 * Extract rate limit snapshot from response headers.
 * 
 * @param {object} headers - raw HTTP response headers (lowercase keys)
 * @returns {object} - structured snapshot object
 */
export function extractHeaders(headers) {
  const h = headers || {};

  return {
    ts: Date.now(),
    requestId:             h['request-id']                               || null,
    requestsRemaining:     parseIntOrNull(h['anthropic-ratelimit-requests-remaining']),
    tokensRemaining:       parseIntOrNull(h['anthropic-ratelimit-tokens-remaining']),
    inputTokensRemaining:  parseIntOrNull(h['anthropic-ratelimit-input-tokens-remaining']),
    outputTokensRemaining: parseIntOrNull(h['anthropic-ratelimit-output-tokens-remaining']),
    requestsReset:         h['anthropic-ratelimit-requests-reset']       || null,
    tokensReset:           h['anthropic-ratelimit-tokens-reset']         || null,
  };
}

/**
 * Extract usage data from a non-streaming response body.
 * 
 * @param {string|Buffer} rawBody - the full JSON response body
 * @returns {object} - usage fields
 */
export function extractBody(rawBody) {
  try {
    const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const data = JSON.parse(body);
    return parseUsageFromObject(data);
  } catch {
    return emptyUsage();
  }
}

/**
 * Parse usage from a parsed response object.
 * Works for both /messages and streaming final events.
 * 
 * @param {object} data - parsed JSON response
 * @returns {object} - usage fields
 */
function parseUsageFromObject(data) {
  const usage = data?.usage || {};
  return {
    inputTokens:       usage.input_tokens                 || 0,
    outputTokens:      usage.output_tokens                || 0,
    cacheRead:         usage.cache_read_input_tokens      || 0,
    cacheCreation:     usage.cache_creation_input_tokens  || 0,
    stopReason:        data?.stop_reason                  || null,
    model:             data?.model                        || null,
  };
}

/**
 * Empty usage object — returned when parsing fails or data isn't available.
 */
function emptyUsage() {
  return {
    inputTokens:   0,
    outputTokens:  0,
    cacheRead:     0,
    cacheCreation: 0,
    stopReason:    null,
    model:         null,
  };
}

/**
 * Parse an integer or return null.
 * @param {string|undefined} val
 * @returns {number|null}
 */
function parseIntOrNull(val) {
  if (val === undefined || val === null || val === '') return null;
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

/**
 * Detect whether a response is a streaming SSE response.
 * @param {object} headers - response headers
 * @returns {boolean}
 */
export function isStreaming(headers) {
  const ct = (headers?.['content-type'] || '').toLowerCase();
  return ct.includes('text/event-stream');
}

/**
 * StreamTap — a Transform stream that passes all data through
 * while watching for the final usage event in a streaming SSE response.
 * 
 * Anthropic sends usage in the final `message_delta` event:
 *   event: message_delta
 *   data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":...}}
 * 
 * And in the `message_start` event for input tokens:
 *   event: message_start
 *   data: {"type":"message_start","message":{"usage":{"input_tokens":...}}}
 * 
 * @param {function} onUsage - callback called with usage object when stream ends
 */
export class StreamTap extends Transform {
  constructor(onUsage) {
    super();
    this._onUsage = onUsage;
    this._buffer  = '';
    this._usage   = {
      inputTokens:   0,
      outputTokens:  0,
      cacheRead:     0,
      cacheCreation: 0,
      stopReason:    null,
      model:         null,
    };
  }

  _transform(chunk, encoding, callback) {
    // Pass the chunk through unchanged
    this.push(chunk);

    // Accumulate text for SSE event parsing
    this._buffer += chunk.toString('utf8');

    // Parse complete SSE events from buffer
    const lines = this._buffer.split('\n');
    // Keep the last incomplete line in the buffer
    this._buffer = lines.pop() || '';

    let currentEvent = null;
    for (const line of lines) {
      if (line.startsWith('event:')) {
        currentEvent = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        const dataStr = line.slice(5).trim();
        if (dataStr === '[DONE]') continue;
        try {
          const data = JSON.parse(dataStr);
          this._parseEvent(currentEvent, data);
        } catch {
          // Non-JSON data line — skip
        }
      }
    }

    callback();
  }

  _flush(callback) {
    // Parse any remaining buffer content
    if (this._buffer.trim()) {
      const lines = this._buffer.split('\n');
      let currentEvent = null;
      for (const line of lines) {
        if (line.startsWith('event:')) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          const dataStr = line.slice(5).trim();
          if (dataStr === '[DONE]') continue;
          try {
            const data = JSON.parse(dataStr);
            this._parseEvent(currentEvent, data);
          } catch { /* skip */ }
        }
      }
    }

    // Fire the callback with accumulated usage
    try {
      this._onUsage(this._usage);
    } catch (err) {
      // Don't let callback errors break the stream
      console.error('StreamTap onUsage callback error:', err);
    }

    callback();
  }

  /**
   * Parse a single SSE event and update accumulated usage.
   * @param {string} eventType
   * @param {object} data
   */
  _parseEvent(eventType, data) {
    if (!data) return;

    switch (data.type) {
      case 'message_start': {
        // message_start has input_tokens and model
        const msg = data.message || {};
        const usage = msg.usage || {};
        if (usage.input_tokens)               this._usage.inputTokens   += usage.input_tokens;
        if (usage.cache_read_input_tokens)     this._usage.cacheRead     += usage.cache_read_input_tokens;
        if (usage.cache_creation_input_tokens) this._usage.cacheCreation += usage.cache_creation_input_tokens;
        if (msg.model)                         this._usage.model = msg.model;
        break;
      }

      case 'message_delta': {
        // message_delta has output_tokens and stop_reason
        const usage = data.usage || {};
        if (usage.output_tokens) this._usage.outputTokens += usage.output_tokens;
        const delta = data.delta || {};
        if (delta.stop_reason)   this._usage.stopReason = delta.stop_reason;
        break;
      }

      default:
        break;
    }
  }
}
