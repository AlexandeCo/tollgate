/**
 * index.js — Sniff main entry point
 * 
 * Starts the proxy server (port 4243) and the API/dashboard server (port 4244).
 * Wires them together via EventEmitter.
 * 
 * 🐕 Sniff is on the trail!
 */

import { EventEmitter } from 'events';
import chalk from 'chalk';

import { createDb }        from './db.js';
import { createProxy }     from './proxy.js';
import { createApiServer } from './api/server.js';
import { initPush }        from './push.js';

/**
 * Start Sniff.
 * 
 * @param {object} config - full config (from getConfig() + applyFlags())
 * @returns {Promise<{ proxyServer, apiServer, db, emitter }>}
 */
export async function start(config) {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(50); // Dashboard + proxy + multiple SSE clients

  // Initialize database
  const dbPath = config?.db?.path || null;
  const db = createDb(dbPath);

  // Initialize push notifications (generates VAPID keys on first run)
  try { initPush(db); } catch (err) {
    console.error(chalk.yellow('Warning: push notifications unavailable:', err.message));
  }

  // Purge old records on startup
  const retentionDays = config?.db?.retentionDays || 30;
  try {
    const purged = db.purgeOld(retentionDays);
    if (purged.callsDeleted > 0 || purged.snapshotsDeleted > 0) {
      console.log(chalk.gray(
        `🗑️  Sniff cleaned up: ${purged.callsDeleted} old calls, ${purged.snapshotsDeleted} old snapshots`
      ));
    }
  } catch (err) {
    console.error(chalk.yellow('Warning: could not purge old records:', err.message));
  }

  // Create proxy server
  const proxyServer = createProxy(db, emitter, config);

  // Create API server
  const apiServer = await createApiServer(db, emitter, config);

  const proxyPort    = config?.proxy?.port    || 4243;
  const dashboardPort = config?.dashboard?.port || 4244;

  // Start both servers
  await Promise.all([
    new Promise((resolve, reject) => {
      proxyServer.listen(proxyPort, '127.0.0.1', (err) => {
        if (err) reject(err);
        else resolve();
      });
    }),
    apiServer.listen({ port: dashboardPort, host: '127.0.0.1' }),
  ]);

  // 🐕 Startup banner
  console.log('');
  console.log(chalk.bold.green('🐕 Sniff is on the trail!'));
  console.log(`   ${chalk.cyan('Proxy:')}     ${chalk.white(`http://localhost:${proxyPort}`)}  ${chalk.gray('(point ANTHROPIC_BASE_URL here)')}`);
  console.log(`   ${chalk.cyan('Dashboard:')} ${chalk.white(`http://localhost:${dashboardPort}`)}`);
  console.log('');
  console.log(chalk.green('   Good boy. Watching every call.'));
  console.log('');

  // Track session stats for shutdown summary
  let sessionCalls     = 0;
  let sessionTokens    = 0;
  let sessionCost      = 0;
  let sessionRateLimits = 0;

  emitter.on('call', (call) => {
    sessionCalls++;
    sessionTokens += (call.inputTokens || 0) + (call.outputTokens || 0);
    sessionCost   += call.costUsd || 0;
  });

  emitter.on('alert', (alert) => {
    if (alert.type === 'rate_limit_hit') sessionRateLimits++;
  });

  // Graceful shutdown handler
  async function shutdown() {
    console.log('');
    console.log(chalk.bold.cyan('🐕 Sniff is off duty. Good boy today.'));
    console.log(
      chalk.gray(
        `   Session: ${sessionCalls} calls · ` +
        `${Math.round(sessionTokens / 1000)}k tokens · ` +
        `$${sessionCost.toFixed(2)} · ` +
        `${sessionRateLimits} rate limits hit`
      )
    );

    try {
      proxyServer.close();
      await apiServer.close();
      db.db.close();
    } catch {}

    process.exit(0);
  }

  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);

  return { proxyServer, apiServer, db, emitter };
}
