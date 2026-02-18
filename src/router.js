/**
 * router.js — Smart model downgrade routing
 * 
 * Pure function: takes a request body + current snapshot + config,
 * returns (possibly modified) request body.
 * 
 * 🐕 When Sniff smells trouble ahead, he takes the safer path.
 * Saves your biscuits before you run out.
 */

/**
 * Default routing ladder: expensive → cheaper models.
 * Used if config doesn't specify one.
 */
export const DEFAULT_LADDER = {
  'claude-opus-4-6':   'claude-sonnet-4-6',
  'claude-sonnet-4-6': 'claude-haiku-4-6',
  'claude-sonnet-4-5': 'claude-haiku-4-6',
  'claude-opus-4':     'claude-sonnet-4-6',
  'claude-sonnet-4':   'claude-haiku-4-6',
};

/**
 * Compute the token usage percentage from the latest snapshot.
 * Returns null if we don't have enough data.
 * 
 * @param {object|null} latestSnapshot - from db.getLatestSnapshot()
 * @returns {number|null} - usage percent (0–100), or null if unknown
 */
export function computeUsagePercent(latestSnapshot) {
  if (!latestSnapshot) return null;

  const remaining = latestSnapshot.tokens_remaining;
  const reset     = latestSnapshot.tokens_reset;

  if (remaining === null || remaining === undefined) return null;

  // We need to estimate the total limit.
  // Anthropic doesn't directly tell us the limit in headers, only remaining.
  // We can estimate from input + output remaining if available:
  const inputRemaining  = latestSnapshot.input_tokens_remaining;
  const outputRemaining = latestSnapshot.output_tokens_remaining;

  // Return remaining as a sentinel — caller computes percent against config threshold
  // using the snapshot directly
  return remaining;
}

/**
 * Determine if routing should be triggered based on snapshot + config.
 * 
 * @param {object|null} latestSnapshot - latest db snapshot row
 * @param {object} config - routing config (enabled, threshold, etc.)
 * @returns {{ shouldRoute: boolean, usedPercent: number|null, tokensRemaining: number|null }}
 */
export function shouldRoute(latestSnapshot, config) {
  if (!config?.routing?.enabled) {
    return { shouldRoute: false, usedPercent: null, tokensRemaining: null };
  }

  if (!latestSnapshot) {
    return { shouldRoute: false, usedPercent: null, tokensRemaining: null };
  }

  const remaining = latestSnapshot.tokens_remaining;
  if (remaining === null || remaining === undefined) {
    return { shouldRoute: false, usedPercent: null, tokensRemaining: null };
  }

  // We don't have the limit directly — we approximate from the snapshot context.
  // Store a rough "max tokens ever seen" as a heuristic, but for routing
  // we use the configurable knownLimit approach.
  // Anthropic Claude Max tier is 400k tokens per window typically.
  // Let callers pass in known limit, or we fall back to 400000 as a default.
  const knownLimit = config.routing.knownLimit || 400_000;
  const usedPercent = Math.round(((knownLimit - remaining) / knownLimit) * 100);
  const threshold = config.routing.threshold || 80;

  return {
    shouldRoute:     usedPercent >= threshold,
    usedPercent,
    tokensRemaining: remaining,
  };
}

/**
 * Maybe reroute a request to a cheaper model.
 * Pure function — returns a new (or same) request body object.
 * 
 * @param {object} requestBody - the parsed JSON request body
 * @param {object|null} latestSnapshot - latest rate limit snapshot from db
 * @param {object} config - full sniff config
 * @returns {{ body: object, routedFrom: string|null, routedTo: string|null, usedPercent: number|null }}
 */
export function maybeReroute(requestBody, latestSnapshot, config) {
  const result = {
    body:        requestBody,
    routedFrom:  null,
    routedTo:    null,
    usedPercent: null,
  };

  if (!requestBody) return result;

  const { shouldRoute: doRoute, usedPercent } = shouldRoute(latestSnapshot, config);
  result.usedPercent = usedPercent;

  if (!doRoute) return result;

  const requestedModel = requestBody.model;
  if (!requestedModel) return result;

  const ladder = config?.routing?.ladder || DEFAULT_LADDER;

  // Walk the ladder: find the next-cheaper model
  const targetModel = findDowngrade(requestedModel, ladder);

  if (!targetModel || targetModel === requestedModel) {
    // Already at the floor, or no downgrade path
    return result;
  }

  // Create a new body with the model rewritten
  result.body = { ...requestBody, model: targetModel };
  result.routedFrom = requestedModel;
  result.routedTo   = targetModel;

  return result;
}

/**
 * Find the downgraded model for a given model, following the ladder chain.
 * 
 * @param {string} model - original model
 * @param {object} ladder - mapping from model to cheaper model
 * @returns {string|null} - target model, or null if no downgrade path
 */
function findDowngrade(model, ladder) {
  if (!model || !ladder) return null;

  // Direct lookup first
  if (ladder[model]) return ladder[model];

  // Prefix match: handles dated model IDs like claude-opus-4-6-20250215
  for (const [key, target] of Object.entries(ladder)) {
    if (model.startsWith(key)) return target;
  }

  return null;
}

/**
 * Build the x-sniff-* response headers to add when routing occurs.
 * @param {string} originalModel
 * @param {string} routedModel
 * @param {number} usedPercent
 * @returns {object} - header key-value pairs
 */
export function buildRoutingHeaders(originalModel, routedModel, usedPercent) {
  return {
    'x-sniff-routed':         'true',
    'x-sniff-original-model': originalModel,
    'x-sniff-routed-model':   routedModel,
    'x-sniff-reason':         `token-threshold-${usedPercent}`,
  };
}

/**
 * Get a human-friendly name for a model's tier.
 * Used in log messages.
 */
export function modelTier(model) {
  if (!model) return 'unknown';
  const m = model.toLowerCase();
  if (m.includes('opus'))   return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku'))  return 'haiku';
  return model.split('-')[1] || model;
}
