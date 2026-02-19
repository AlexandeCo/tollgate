/**
 * stats.js — GET /api/stats handler
 * 
 * Aggregates call data for a time window: 1h, 24h, 7d.
 * Returns totals + per-model breakdown.
 * 
 * 🐕 Tollgate's scorecard — how far did we run today?
 */

const WINDOWS = {
  '1h':  1  * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d':  7  * 24 * 60 * 60 * 1000,
};

/**
 * Create the stats route handler (factory — injects db).
 * @param {object} db - database instance
 * @returns {function} - Fastify route handler
 */
export function createStatsHandler(db) {
  return async function statsHandler(request, reply) {
    const windowKey = request.query.window || '24h';

    if (!WINDOWS[windowKey]) {
      return reply.status(400).send({
        error:   'invalid_window',
        message: `Window must be one of: ${Object.keys(WINDOWS).join(', ')}`,
      });
    }

    const windowMs = WINDOWS[windowKey];
    const stats    = db.getStats(windowMs);

    return reply.send({
      window:           windowKey,
      totalCalls:       stats.totalCalls,
      totalInputTokens: stats.totalInputTokens,
      totalOutputTokens:stats.totalOutputTokens,
      totalCostUsd:     Math.round(stats.totalCostUsd * 100_000) / 100_000, // 5 decimal places
      byModel:          stats.byModel,
      p50LatencyMs:     stats.p50LatencyMs,
      p95LatencyMs:     stats.p95LatencyMs,
      errorRate:        Math.round(stats.errorRate * 10_000) / 10_000,      // 4 decimal places
    });
  };
}
