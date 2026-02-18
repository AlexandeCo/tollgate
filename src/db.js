/**
 * db.js — SQLite layer for Sniff
 * 
 * Uses better-sqlite3 for synchronous, fast local storage.
 * Database lives at ~/.sniff/sniff.db
 * 
 * 🐕 Every bone Sniff finds gets buried here for later.
 */

import Database from 'better-sqlite3';
import { mkdirSync, existsSync, chmodSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * Get the default database path
 */
function getDefaultDbPath() {
  const dir = join(homedir(), '.sniff');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return join(dir, 'sniff.db');
}

/**
 * Create and initialize a Sniff database.
 * @param {string|null} dbPath - path to the database file, or null for default
 * @returns {Database} - initialized better-sqlite3 database
 */
export function createDb(dbPath = null) {
  const path = dbPath || getDefaultDbPath();
  const db = new Database(path);

  // Restrict database file to owner-only (rw-------) — it contains usage metadata
  // that should not be world-readable on multi-user systems.
  try { chmodSync(path, 0o600); } catch {}

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS calls (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      ts              INTEGER NOT NULL,
      request_id      TEXT,
      model           TEXT NOT NULL,
      input_tokens    INTEGER DEFAULT 0,
      output_tokens   INTEGER DEFAULT 0,
      cache_read      INTEGER DEFAULT 0,
      cache_creation  INTEGER DEFAULT 0,
      cost_usd        REAL DEFAULT 0,
      latency_ms      INTEGER,
      stream          INTEGER DEFAULT 0,
      stop_reason     TEXT,
      routed_from     TEXT,
      error_code      TEXT
    );

    CREATE TABLE IF NOT EXISTS rate_limit_snapshots (
      id                              INTEGER PRIMARY KEY AUTOINCREMENT,
      ts                              INTEGER NOT NULL,
      model                           TEXT,
      requests_remaining              INTEGER,
      tokens_remaining                INTEGER,
      input_tokens_remaining          INTEGER,
      output_tokens_remaining         INTEGER,
      requests_reset                  TEXT,
      tokens_reset                    TEXT
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      ts         INTEGER NOT NULL,
      type       TEXT NOT NULL,
      threshold  INTEGER,
      message    TEXT,
      resolved   INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint   TEXT UNIQUE NOT NULL,
      p256dh     TEXT NOT NULL,
      auth       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_calls_ts    ON calls(ts);
    CREATE INDEX IF NOT EXISTS idx_calls_model ON calls(model);
    CREATE INDEX IF NOT EXISTS idx_snapshots_ts ON rate_limit_snapshots(ts);
  `);

  // Prepare statements for performance
  const stmts = {
    insertCall: db.prepare(`
      INSERT INTO calls (
        ts, request_id, model, input_tokens, output_tokens,
        cache_read, cache_creation, cost_usd, latency_ms,
        stream, stop_reason, routed_from, error_code
      ) VALUES (
        @ts, @request_id, @model, @input_tokens, @output_tokens,
        @cache_read, @cache_creation, @cost_usd, @latency_ms,
        @stream, @stop_reason, @routed_from, @error_code
      )
    `),

    insertSnapshot: db.prepare(`
      INSERT INTO rate_limit_snapshots (
        ts, model, requests_remaining, tokens_remaining,
        input_tokens_remaining, output_tokens_remaining,
        requests_reset, tokens_reset
      ) VALUES (
        @ts, @model, @requests_remaining, @tokens_remaining,
        @input_tokens_remaining, @output_tokens_remaining,
        @requests_reset, @tokens_reset
      )
    `),

    getRecentCalls: db.prepare(`
      SELECT * FROM calls ORDER BY ts DESC LIMIT ?
    `),

    getCallsSince: db.prepare(`
      SELECT * FROM calls WHERE ts >= ? ORDER BY ts DESC LIMIT ?
    `),

    getLatestSnapshot: db.prepare(`
      SELECT * FROM rate_limit_snapshots ORDER BY ts DESC LIMIT 1
    `),

    getStatsCalls: db.prepare(`
      SELECT * FROM calls WHERE ts >= ?
    `),

    countCalls: db.prepare(`
      SELECT COUNT(*) as total FROM calls
    `),

    purgeOldCalls: db.prepare(`
      DELETE FROM calls WHERE ts < ?
    `),

    purgeOldSnapshots: db.prepare(`
      DELETE FROM rate_limit_snapshots WHERE ts < ?
    `),

    insertAlert: db.prepare(`
      INSERT INTO alerts (ts, type, threshold, message)
      VALUES (@ts, @type, @threshold, @message)
    `),

    saveSubscription: db.prepare(`
      INSERT OR REPLACE INTO push_subscriptions (endpoint, p256dh, auth, created_at)
      VALUES (@endpoint, @p256dh, @auth, @created_at)
    `),

    getSubscriptions: db.prepare(`
      SELECT endpoint, p256dh, auth FROM push_subscriptions ORDER BY id
    `),

    deleteSubscription: db.prepare(`
      DELETE FROM push_subscriptions WHERE endpoint = ?
    `),
  };

  /**
   * Insert a call record.
   * @param {object} call
   */
  function insertCall(call) {
    return stmts.insertCall.run({
      ts:             call.ts || Date.now(),
      request_id:     call.requestId || null,
      model:          call.model || 'unknown',
      input_tokens:   call.inputTokens || 0,
      output_tokens:  call.outputTokens || 0,
      cache_read:     call.cacheRead || 0,
      cache_creation: call.cacheCreation || 0,
      cost_usd:       call.costUsd || 0,
      latency_ms:     call.latencyMs || null,
      stream:         call.stream ? 1 : 0,
      stop_reason:    call.stopReason || null,
      routed_from:    call.routedFrom || null,
      error_code:     call.errorCode || null,
    });
  }

  /**
   * Insert a rate limit snapshot.
   * @param {object} snapshot
   */
  function insertSnapshot(snapshot) {
    return stmts.insertSnapshot.run({
      ts:                     snapshot.ts || Date.now(),
      model:                  snapshot.model || null,
      requests_remaining:     snapshot.requestsRemaining ?? null,
      tokens_remaining:       snapshot.tokensRemaining ?? null,
      input_tokens_remaining: snapshot.inputTokensRemaining ?? null,
      output_tokens_remaining:snapshot.outputTokensRemaining ?? null,
      requests_reset:         snapshot.requestsReset || null,
      tokens_reset:           snapshot.tokensReset || null,
    });
  }

  /**
   * Get recent calls from the log.
   * @param {number} limit - max number of calls to return
   * @param {number|null} since - optional unix ms timestamp to filter from
   * @returns {Array}
   */
  function getRecentCalls(limit = 100, since = null) {
    if (since) {
      return stmts.getCallsSince.all(since, limit);
    }
    return stmts.getRecentCalls.all(limit);
  }

  /**
   * Get the most recent rate limit snapshot.
   * @returns {object|null}
   */
  function getLatestSnapshot() {
    return stmts.getLatestSnapshot.get() || null;
  }

  /**
   * Get aggregated stats for a time window.
   * @param {number} windowMs - window size in milliseconds
   * @returns {object} - aggregated stats
   */
  function getStats(windowMs) {
    const since = Date.now() - windowMs;
    const calls = stmts.getStatsCalls.all(since);

    const byModel = {};
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCostUsd = 0;
    let totalCalls = 0;
    let errorCount = 0;
    const latencies = [];

    for (const call of calls) {
      totalCalls++;
      totalInputTokens  += call.input_tokens  || 0;
      totalOutputTokens += call.output_tokens || 0;
      totalCostUsd      += call.cost_usd      || 0;
      if (call.error_code) errorCount++;
      if (call.latency_ms) latencies.push(call.latency_ms);

      const model = call.model || 'unknown';
      if (!byModel[model]) byModel[model] = { calls: 0, costUsd: 0, inputTokens: 0, outputTokens: 0 };
      byModel[model].calls++;
      byModel[model].costUsd      += call.cost_usd     || 0;
      byModel[model].inputTokens  += call.input_tokens  || 0;
      byModel[model].outputTokens += call.output_tokens || 0;
    }

    // Calculate percentile latencies
    latencies.sort((a, b) => a - b);
    const p50 = latencies.length ? latencies[Math.floor(latencies.length * 0.5)] : null;
    const p95 = latencies.length ? latencies[Math.floor(latencies.length * 0.95)] : null;

    return {
      totalCalls,
      totalInputTokens,
      totalOutputTokens,
      totalCostUsd,
      byModel,
      p50LatencyMs: p50,
      p95LatencyMs: p95,
      errorRate: totalCalls > 0 ? errorCount / totalCalls : 0,
    };
  }

  /**
   * Purge records older than retentionDays.
   * @param {number} retentionDays
   */
  function purgeOld(retentionDays = 30) {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const callsDeleted     = stmts.purgeOldCalls.run(cutoff).changes;
    const snapshotsDeleted = stmts.purgeOldSnapshots.run(cutoff).changes;
    return { callsDeleted, snapshotsDeleted };
  }

  /**
   * Insert an alert record.
   */
  function insertAlert(alert) {
    return stmts.insertAlert.run({
      ts:        alert.ts || Date.now(),
      type:      alert.type,
      threshold: alert.threshold || null,
      message:   alert.message || null,
    });
  }

  /**
   * Save a push subscription (upsert by endpoint).
   * @param {{ endpoint: string, p256dh: string, auth: string }} sub
   */
  function saveSubscription(sub) {
    return stmts.saveSubscription.run({
      endpoint:   sub.endpoint,
      p256dh:     sub.p256dh,
      auth:       sub.auth,
      created_at: Date.now(),
    });
  }

  /**
   * Get all saved push subscriptions.
   * @returns {Array<{ endpoint: string, p256dh: string, auth: string }>}
   */
  function getSubscriptions() {
    return stmts.getSubscriptions.all();
  }

  /**
   * Remove a push subscription by endpoint.
   * @param {string} endpoint
   */
  function deleteSubscription(endpoint) {
    return stmts.deleteSubscription.run(endpoint);
  }

  return {
    db,
    insertCall,
    insertSnapshot,
    getRecentCalls,
    getLatestSnapshot,
    getStats,
    purgeOld,
    insertAlert,
    saveSubscription,
    getSubscriptions,
    deleteSubscription,
  };
}
