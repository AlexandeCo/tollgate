/**
 * pricing.js — Model pricing table + cost estimation
 * 
 * All prices are per 1 million tokens (USD).
 * 
 * 🐕 Tollgate's pricing data.
 * Update this table with each Claude release — it's the nose that knows.
 */

// Pricing per 1M tokens (input / output)
export const PRICING = {
  // Claude Opus 4 series
  'claude-opus-4-6':         { input: 15.00, output: 75.00 },
  'claude-opus-4':           { input: 15.00, output: 75.00 },

  // Claude Sonnet 4 series
  'claude-sonnet-4-6':       { input: 3.00,  output: 15.00 },
  'claude-sonnet-4-5':       { input: 3.00,  output: 15.00 },
  'claude-sonnet-4':         { input: 3.00,  output: 15.00 },

  // Claude Haiku 4 series
  'claude-haiku-4-6':        { input: 0.80,  output: 4.00  },
  'claude-haiku-4-5':        { input: 0.80,  output: 4.00  },
  'claude-haiku-4':          { input: 0.80,  output: 4.00  },

  // Claude 3.5 series (legacy but common)
  'claude-3-5-sonnet-20241022': { input: 3.00,  output: 15.00 },
  'claude-3-5-haiku-20241022':  { input: 0.80,  output: 4.00  },
  'claude-3-5-sonnet-20240620': { input: 3.00,  output: 15.00 },

  // Claude 3 series (older, still out there)
  'claude-3-opus-20240229':   { input: 15.00, output: 75.00 },
  'claude-3-sonnet-20240229': { input: 3.00,  output: 15.00 },
  'claude-3-haiku-20240307':  { input: 0.25,  output: 1.25  },
};

/**
 * Find pricing for a model by exact match, then prefix match.
 * Falls back to sonnet pricing if unknown (middle-ground estimate).
 * 
 * @param {string} model - model name/id
 * @returns {{ input: number, output: number }} - pricing per 1M tokens
 */
export function getPricing(model) {
  if (!model) return PRICING['claude-sonnet-4-6'];

  // Exact match first
  if (PRICING[model]) return PRICING[model];

  // Prefix match — handles dated model IDs and future variants
  for (const [key, price] of Object.entries(PRICING)) {
    if (model.startsWith(key) || key.startsWith(model)) {
      return price;
    }
  }

  // Fallback: sniff by name fragments
  const lower = model.toLowerCase();
  if (lower.includes('opus'))   return PRICING['claude-opus-4-6'];
  if (lower.includes('haiku'))  return PRICING['claude-haiku-4-6'];
  if (lower.includes('sonnet')) return PRICING['claude-sonnet-4-6'];

  // Unknown model — assume sonnet-tier pricing, log a warning
  return PRICING['claude-sonnet-4-6'];
}

/**
 * Estimate the cost of a single API call.
 * 
 * @param {string} model - model name/id
 * @param {number} inputTokens - number of input tokens
 * @param {number} outputTokens - number of output tokens
 * @param {number} [cacheReadTokens=0] - cache read tokens (discounted)
 * @param {number} [cacheCreationTokens=0] - cache creation tokens (slightly more expensive)
 * @returns {number} - estimated cost in USD
 */
export function estimateCost(model, inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheCreationTokens = 0) {
  const pricing = getPricing(model);

  const inputCost         = (inputTokens / 1_000_000)         * pricing.input;
  const outputCost        = (outputTokens / 1_000_000)        * pricing.output;

  // Cache pricing: reads are ~10% of input, creation is ~125% of input
  const cacheReadCost     = (cacheReadTokens / 1_000_000)     * (pricing.input * 0.1);
  const cacheCreationCost = (cacheCreationTokens / 1_000_000) * (pricing.input * 1.25);

  return inputCost + outputCost + cacheReadCost + cacheCreationCost;
}

/**
 * Format a cost in USD for display.
 * @param {number} usd - cost in USD
 * @returns {string} - formatted string like "$0.009"
 */
export function formatCost(usd) {
  if (usd === 0) return '$0.000';
  if (usd < 0.001) return `$${usd.toFixed(6)}`;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}
