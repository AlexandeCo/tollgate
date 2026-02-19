/**
 * calls.js — GET /api/calls handler
 * 
 * Returns a paginated call log.
 * Supports ?limit and ?since (unix ms) query params.
 * 
 * 🐕 Every API call logged, in order.
 */

/**
 * Create the calls route handler (factory — injects db).
 * @param {object} db - database instance
 * @returns {function} - Fastify route handler
 */
export function createCallsHandler(db) {
  return async function callsHandler(request, reply) {
    const limit = Math.min(parseInt(request.query.limit || '100', 10), 1000);
    const since = request.query.since ? parseInt(request.query.since, 10) : null;
    const model = request.query.model || null;

    // Fetch raw rows
    let rows = db.getRecentCalls(limit, since);

    // Filter by model if requested
    if (model) {
      rows = rows.filter(r => r.model === model || r.model?.startsWith(model));
    }

    // Map snake_case DB fields → camelCase API fields
    const calls = rows.map(mapCall);

    return reply.send({
      calls,
      total: calls.length,
      nextCursor: calls.length > 0 ? calls[calls.length - 1].ts : null,
    });
  };
}

/**
 * Map a DB row to a clean API call object.
 * @param {object} row - raw SQLite row
 * @returns {object} - API-shaped call object
 */
function mapCall(row) {
  return {
    id:           row.id,
    ts:           row.ts,
    requestId:    row.request_id,
    model:        row.model,
    routedFrom:   row.routed_from,
    inputTokens:  row.input_tokens,
    outputTokens: row.output_tokens,
    cacheRead:    row.cache_read,
    cacheCreation:row.cache_creation,
    costUsd:      row.cost_usd,
    latencyMs:    row.latency_ms,
    stream:       row.stream === 1,
    stopReason:   row.stop_reason,
    errorCode:    row.error_code,
    timestamp:    new Date(row.ts).toISOString(),
  };
}
