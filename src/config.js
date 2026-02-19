/**
 * config.js — Tollgate configuration
 * 
 * Loads and saves config via the `conf` package.
 * Stored at ~/.config/tollgate/config.json
 * 
 * 🐕 A proxy never forgets where it buried its bones.
 */

import Conf from 'conf';

const defaults = {
  proxy: {
    port: 4243,
    target: 'https://api.anthropic.com',
  },
  dashboard: {
    port: 4244,
    autoOpen: false,
  },
  routing: {
    enabled: false,
    threshold: 80,
    ladder: {
      'claude-opus-4-6': 'claude-sonnet-4-6',
      'claude-sonnet-4-6': 'claude-haiku-4-6',
    },
  },
  alerts: {
    tokenWarningPercent: 80,
    tokenCriticalPercent: 95,
    requestWarningPercent: 80,
    pushEnabled: false,
  },
  db: {
    path: null, // null = use default (~/.tollgate/tollgate.db)
    retentionDays: 30,
  },
};

// Initialize conf store with defaults
const store = new Conf({
  projectName: 'tollgate',
  defaults,
  schema: {
    proxy: { type: 'object' },
    dashboard: { type: 'object' },
    routing: { type: 'object' },
    alerts: { type: 'object' },
    db: { type: 'object' },
  },
});

/**
 * Get the full config object (merged with defaults)
 */
export function getConfig() {
  return {
    proxy: store.get('proxy'),
    dashboard: store.get('dashboard'),
    routing: store.get('routing'),
    alerts: store.get('alerts'),
    db: store.get('db'),
  };
}

/**
 * Merge partial config update into stored config
 * @param {object} updates - partial config object
 */
export function updateConfig(updates) {
  for (const [section, values] of Object.entries(updates)) {
    const current = store.get(section) || {};
    store.set(section, { ...current, ...values });
  }
  return getConfig();
}

/**
 * Apply CLI flag overrides on top of stored config
 * @param {object} flags - parsed CLI flags
 * @returns {object} - final config for this session
 */
export function applyFlags(flags = {}) {
  const config = getConfig();

  if (flags.port) config.proxy.port = parseInt(flags.port, 10);
  if (flags.dashboardPort) config.dashboard.port = parseInt(flags.dashboardPort, 10);
  if (flags.warningThreshold) config.alerts.tokenWarningPercent = parseInt(flags.warningThreshold, 10);
  if (flags.routing !== undefined) config.routing.enabled = flags.routing;

  return config;
}

export { store };
export default getConfig;
