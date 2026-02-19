/**
 * proxy.js — The heart of Tollgate
 * 
 * Creates an HTTP proxy that forwards requests to api.anthropic.com,
 * taps the response to extract headers + usage, persists to SQLite,
 * and emits events for the dashboard.
 * 
 * 🐕 Tollgate's extractor to the ground — every trail documented.
 */

import httpProxy from 'http-proxy';
import http from 'http';
import { Readable } from 'stream';
import chalk from 'chalk';

import { extractHeaders, extractBody, isStreaming, StreamTap } from './extractor.js';
import { maybeReroute, buildRoutingHeaders, modelTier } from './router.js';
import { estimateCost, formatCost } from './pricing.js';
import { notifyAll } from './push.js';

const TARGET = 'https://api.anthropic.com';

// In-memory alert dedup set — cleared on rate limit window reset
const _firedAlerts = new Set();

/**
 * Create the Tollgate proxy server.
 * 
 * @param {object} db - database instance from createDb()
 * @param {EventEmitter} emitter - event emitter for SSE broadcasts
 * @param {object} config - full tollgate config
 * @returns {http.Server} - the proxy HTTP server
 */
export function createProxy(db, emitter, config) {
  // Create the underlying http-proxy instance
  const proxy = httpProxy.createProxyServer({
    target:             TARGET,
    changeOrigin:       true,
    secure:             true,
    selfHandleResponse: true, // We manually pipe the response
  });

  // Handle proxy-level errors (connection refused, DNS failures, etc.)
  proxy.on('error', (err, req, res) => {
    console.error(chalk.red(`❌ Tollgate error: ${err.message}`));
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
    }
    try { res.end(JSON.stringify({ error: 'proxy_error', message: err.message })); } catch {}
  });

  /**
   * Core response handler — runs for every proxied response.
   * 
   * 1. Extract rate limit headers (available immediately with the HTTP response)
   * 2. Handle streaming vs. non-streaming body tap
   * 3. Persist to SQLite
   * 4. Emit SSE events
   */
  proxy.on('proxyRes', (proxyRes, req, res) => {
    const startTime      = req._tgStartTime   || Date.now();
    const requestedModel = req._tgModel        || 'unknown';
    const routedFrom     = req._tgRoutedFrom   || null;
    const streamFlag     = isStreaming(proxyRes.headers);

    // Step 1: Extract rate limit snapshot from response headers
    const snapshot = extractHeaders(proxyRes.headers);
    snapshot.model = requestedModel;

    // Persist snapshot if we have token data
    if (snapshot.tokensRemaining !== null) {
      try { db.insertSnapshot(snapshot); } catch (err) {
        console.error('DB insertSnapshot error:', err.message);
      }
      emitter.emit('snapshot', snapshot);
      checkAlerts(snapshot, config, emitter, db);
    }

    // Build response headers — filter hop-by-hop, add routing headers if needed
    const outHeaders = filterHeaders(proxyRes.headers);
    if (req._tgRoutingHeaders) {
      Object.assign(outHeaders, req._tgRoutingHeaders);
    }

    // Copy status code and headers to client response
    res.writeHead(proxyRes.statusCode, outHeaders);

    // Track error codes
    const errorCode = proxyRes.statusCode >= 400 ? String(proxyRes.statusCode) : null;

    if (errorCode === '429') {
      const resetAt = snapshot.tokensReset || snapshot.requestsReset || 'unknown';
      console.log(chalk.red(`⛔ Rate limit hit. Pausing until reset.`));
      console.log(chalk.red(`   Reset at: ${resetAt}`));
      emitter.emit('alert', {
        type:    'rate_limit_hit',
        message: `Rate limit hit. Reset at: ${resetAt}`,
        resetAt,
      });
    }

    if (streamFlag) {
      // Streaming: tap the SSE body while passing through to client
      const tap = new StreamTap((usage) => {
        const latencyMs = Date.now() - startTime;
        const costUsd   = estimateCost(
          requestedModel,
          usage.inputTokens,
          usage.outputTokens,
          usage.cacheRead,
          usage.cacheCreation,
        );

        persistAndEmit(db, emitter, {
          ts:            startTime,
          requestId:     snapshot.requestId,
          model:         requestedModel,
          inputTokens:   usage.inputTokens,
          outputTokens:  usage.outputTokens,
          cacheRead:     usage.cacheRead,
          cacheCreation: usage.cacheCreation,
          costUsd,
          latencyMs,
          stream:        true,
          stopReason:    usage.stopReason,
          routedFrom,
          errorCode,
        }, requestedModel, costUsd, latencyMs);
      });

      proxyRes.pipe(tap).pipe(res);

    } else {
      // Non-streaming: buffer the body, then extract usage
      const chunks = [];
      proxyRes.on('data', (chunk) => chunks.push(chunk));
      proxyRes.on('end', () => {
        const latencyMs = Date.now() - startTime;
        const rawBody   = Buffer.concat(chunks);
        const usage     = extractBody(rawBody);
        const costUsd   = estimateCost(
          requestedModel,
          usage.inputTokens,
          usage.outputTokens,
          usage.cacheRead,
          usage.cacheCreation,
        );

        persistAndEmit(db, emitter, {
          ts:            startTime,
          requestId:     snapshot.requestId,
          model:         requestedModel,
          inputTokens:   usage.inputTokens,
          outputTokens:  usage.outputTokens,
          cacheRead:     usage.cacheRead,
          cacheCreation: usage.cacheCreation,
          costUsd,
          latencyMs,
          stream:        false,
          stopReason:    usage.stopReason,
          routedFrom,
          errorCode,
        }, requestedModel, costUsd, latencyMs);
      });

      proxyRes.pipe(res);
    }
  });

  // Create the HTTP server that handles incoming requests
  const server = http.createServer((req, res) => {
    req._tgStartTime = Date.now();

    // Buffer the request body so we can inspect + possibly rewrite it
    const reqChunks = [];
    req.on('data', (chunk) => reqChunks.push(chunk));
    req.on('end', () => {
      const rawBody   = Buffer.concat(reqChunks);
      let   bodyBuf   = rawBody;
      let   parsedBody = null;

      // Attempt to parse JSON body
      if (rawBody.length > 0) {
        try {
          parsedBody = JSON.parse(rawBody.toString('utf8'));
        } catch {
          // Not JSON — pass through unchanged
        }
      }

      // Store model name before potential routing
      req._tgModel = parsedBody?.model || 'unknown';

      // Apply smart routing if enabled and we have a JSON body
      if (parsedBody && config?.routing?.enabled) {
        const latestSnapshot = db.getLatestSnapshot();
        const { body, routedFrom, routedTo, usedPercent } = maybeReroute(parsedBody, latestSnapshot, config);

        if (routedFrom && routedTo) {
          req._tgModel        = routedTo;
          req._tgRoutedFrom   = routedFrom;
          req._tgRoutingHeaders = buildRoutingHeaders(routedFrom, routedTo, usedPercent);

          console.log(
            chalk.yellow(`🐾 Rerouted: ${modelTier(routedFrom)} → ${modelTier(routedTo)} `) +
            chalk.yellow(`(tokens at ${usedPercent}%) — saving your biscuits`)
          );

          emitter.emit('alert', {
            type:        'route_downgrade',
            fromModel:   routedFrom,
            toModel:     routedTo,
            usedPercent,
            message:     `Rerouted ${routedFrom} → ${routedTo} (${usedPercent}% used)`,
          });

          bodyBuf = Buffer.from(JSON.stringify(body), 'utf8');
        }
      }

      // Forward with corrected content-length
      const headers = { ...req.headers };
      headers['content-length'] = String(bodyBuf.length);

      proxy.web(req, res, {
        target: TARGET,
        buffer: Readable.from(bodyBuf),
        headers,
      });
    });
  });

  return server;
}

/**
 * Persist a call record to the database and emit SSE + terminal log.
 */
function persistAndEmit(db, emitter, callRecord, model, costUsd, latencyMs) {
  try {
    db.insertCall(callRecord);
  } catch (err) {
    console.error('DB insertCall error:', err.message);
  }

  emitter.emit('call', callRecord);

  // Terminal log in beagle style 🐕
  const inFmt    = (callRecord.inputTokens  || 0).toLocaleString();
  const outFmt   = (callRecord.outputTokens || 0).toLocaleString();
  const routeStr = callRecord.routedFrom
    ? chalk.gray(` [↓ from ${modelTier(callRecord.routedFrom)}]`)
    : '';

  console.log(
    chalk.cyan('🛂 tollgate') + '  ' +
    chalk.white(model) +
    routeStr + '  ' +
    chalk.gray(`${inFmt} in / ${outFmt} out`) + '  ' +
    chalk.green(formatCost(costUsd)) + '  ' +
    chalk.gray(`${latencyMs}ms`)
  );
}

/**
 * Check snapshot against configured alert thresholds.
 * Fires to emitter and logs to terminal. Deduplicates per window.
 */
function checkAlerts(snapshot, config, emitter, db) {
  const remaining = snapshot.tokensRemaining;
  if (remaining === null || remaining === undefined) return;

  const alerts      = config?.alerts || {};
  const warningPct  = alerts.tokenWarningPercent  || 80;
  const criticalPct = alerts.tokenCriticalPercent || 95;
  const knownLimit  = config?.routing?.knownLimit  || 400_000;

  const usedPercent = Math.round(((knownLimit - remaining) / knownLimit) * 100);

  // Minutes until reset
  let minutesUntilReset = null;
  if (snapshot.tokensReset) {
    const resetMs = new Date(snapshot.tokensReset).getTime();
    minutesUntilReset = Math.max(0, Math.round((resetMs - Date.now()) / 60_000));
  }

  // Warning alert
  const warningKey = `warning-${warningPct}`;
  if (usedPercent >= warningPct && !_firedAlerts.has(warningKey)) {
    _firedAlerts.add(warningKey);
    const resetStr = minutesUntilReset !== null ? `   Reset in: ${minutesUntilReset} minutes` : '';
    console.log(chalk.yellow(
      `🦴 WOOF! ${warningPct}% of token budget consumed (remaining: ${remaining.toLocaleString()} / ${knownLimit.toLocaleString()})`
    ));
    if (resetStr) console.log(chalk.yellow(resetStr));

    emitter.emit('alert', {
      type: 'token_warning', threshold: warningPct, usedPercent, remaining, minutesUntilReset,
      message: `${warningPct}% of token budget used`,
    });
    try { db.insertAlert({ type: 'token_warning', threshold: warningPct, message: `${usedPercent}% used` }); } catch {}
    notifyAll('token_warning', `${warningPct}% of token budget used (${remaining?.toLocaleString()} tokens remaining)`).catch(() => {});
  }

  // Critical alert
  const criticalKey = `critical-${criticalPct}`;
  if (usedPercent >= criticalPct && !_firedAlerts.has(criticalKey)) {
    _firedAlerts.add(criticalKey);
    console.log(chalk.red(`🚨 SNIFF ALERT! ${criticalPct}% of token budget consumed — critical!`));
    emitter.emit('alert', {
      type: 'token_critical', threshold: criticalPct, usedPercent, remaining,
      message: `${criticalPct}% of token budget used — critical!`,
    });
    try { db.insertAlert({ type: 'token_critical', threshold: criticalPct, message: `${usedPercent}% used` }); } catch {}
    notifyAll('token_critical', `CRITICAL: ${criticalPct}% of token budget used — only ${remaining?.toLocaleString()} tokens remaining!`).catch(() => {});
  }

  // Reset detection: if usage dropped below warning threshold, clear dedup
  if (usedPercent < warningPct && _firedAlerts.size > 0) {
    _firedAlerts.clear();
    console.log(chalk.green(`✅ Token budget restored. Tollgate resuming.`));
    emitter.emit('reset', { remaining, usedPercent, message: 'Token budget restored.' });
  }
}

/**
 * Filter hop-by-hop headers that shouldn't be forwarded to the client.
 * @param {object} headers - incoming response headers
 * @returns {object} - filtered headers
 */
function filterHeaders(headers) {
  const hopByHop = new Set([
    'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'te', 'trailers', 'transfer-encoding', 'upgrade',
  ]);

  const out = {};
  for (const [key, val] of Object.entries(headers || {})) {
    if (!hopByHop.has(key.toLowerCase())) {
      out[key] = val;
    }
  }
  return out;
}
