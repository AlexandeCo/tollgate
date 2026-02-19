/**
 * status.js — GET /api/status handler
 * 
 * Returns current rate limit state from the latest snapshot.
 * Computes usedPercent fields for easy dashboard consumption.
 * 
 * 🐕 Tollgate's current status.
 */

// Known token limit for percent calculations (Claude Max typical window)
// This is a best-effort estimate since Anthropic doesn't send the limit in headers
const ESTIMATED_TOKEN_LIMIT    = 400_000;
const ESTIMATED_REQUEST_LIMIT  = 2_000; // approximate

/**
 * Create the status route handler (factory — injects db).
 * @param {object} db - database instance
 * @returns {function} - Fastify route handler
 */
export function createStatusHandler(db) {
  return async function statusHandler(request, reply) {
    const snapshot = db.getLatestSnapshot();

    if (!snapshot) {
      return reply.send({
        updatedAt:         null,
        secondsUntilReset: null,
        requests: {
          remaining:   null,
          limit:       ESTIMATED_REQUEST_LIMIT,
          usedPercent: null,
        },
        tokens: {
          remaining:      null,
          limit:          ESTIMATED_TOKEN_LIMIT,
          usedPercent:    null,
          inputRemaining: null,
          outputRemaining:null,
        },
        alerts: {
          routingActive: false,
          warningFired:  false,
        },
        tollgateStatus: 'waiting for first API call — point ANTHROPIC_BASE_URL at me!',
      });
    }

    const updatedAt = new Date(snapshot.ts).toISOString();

    // Compute seconds until reset
    let secondsUntilReset = null;
    if (snapshot.tokens_reset) {
      const resetMs = new Date(snapshot.tokens_reset).getTime();
      secondsUntilReset = Math.max(0, Math.round((resetMs - Date.now()) / 1000));
    }

    // Compute token usage percent
    const tokensRemaining = snapshot.tokens_remaining;
    const tokenUsedPct    = tokensRemaining !== null
      ? Math.round(((ESTIMATED_TOKEN_LIMIT - tokensRemaining) / ESTIMATED_TOKEN_LIMIT) * 100)
      : null;

    // Compute request usage percent
    const requestsRemaining = snapshot.requests_remaining;
    const requestUsedPct    = requestsRemaining !== null
      ? Math.round(((ESTIMATED_REQUEST_LIMIT - requestsRemaining) / ESTIMATED_REQUEST_LIMIT) * 100)
      : null;

    return reply.send({
      updatedAt,
      secondsUntilReset,
      snapshotAgeMs: Date.now() - snapshot.ts,
      requests: {
        remaining:   requestsRemaining,
        limit:       ESTIMATED_REQUEST_LIMIT,
        usedPercent: requestUsedPct,
        reset:       snapshot.requests_reset,
      },
      tokens: {
        remaining:       tokensRemaining,
        limit:           ESTIMATED_TOKEN_LIMIT,
        usedPercent:     tokenUsedPct,
        inputRemaining:  snapshot.input_tokens_remaining,
        outputRemaining: snapshot.output_tokens_remaining,
        reset:           snapshot.tokens_reset,
      },
      alerts: {
        routingActive: false, // Phase 2: wire to actual routing state
        warningFired:  tokenUsedPct !== null && tokenUsedPct >= 80,
      },
    });
  };
}
