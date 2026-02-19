/**
 * api/server.js — Fastify dashboard + API server
 * 
 * Serves the REST API on port 4244.
 * Routes: /api/status, /api/calls, /api/stats, /api/events (SSE)
 * Also serves static dashboard files from ~/Projects/sniff/dashboard/ (package: tollgate)
 * 
 * 
 */

import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { existsSync } from 'fs';

import { createStatusHandler }  from './status.js';
import { createCallsHandler }   from './calls.js';
import { createStatsHandler }   from './stats.js';
import { eventsHandler }        from './events.js';
import { registerPushRoutes }   from './push.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Create and configure the Fastify API server.
 * 
 * @param {object} db       - database instance from createDb()
 * @param {EventEmitter} emitter - event emitter (same as proxy uses)
 * @param {object} config   - full tollgate config
 * @returns {FastifyInstance}
 */
export async function createApiServer(db, emitter, config) {
  const app = Fastify({
    logger: false, // We use our own chalk-based logging
  });

  // ─── CORS (for dashboard running on same origin) ────────────────────────────
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('Access-Control-Allow-Origin',  '*');
    reply.header('Access-Control-Allow-Methods', 'GET, PATCH, DELETE, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type');
    return payload; // Fastify 5: must return payload in onSend hooks
  });

  app.options('*', async () => '');

  // ─── Static dashboard files ──────────────────────────────────────────────────
  // Try ~/Projects/sniff/dashboard/ (package: tollgate) first, fall back to adjacent dashboard/ dir
  const dashboardPaths = [
    resolve(process.env.HOME || '~', 'Projects', 'sniff', 'dashboard'),
    join(__dirname, '..', '..', 'dashboard'),
    join(__dirname, '..', 'dashboard'),
  ];

  const dashboardRoot = dashboardPaths.find(p => existsSync(p));

  if (dashboardRoot) {
    await app.register(fastifyStatic, {
      root:        dashboardRoot,
      prefix:      '/',
      decorateReply: true,
    });
  } else {
    // Serve a minimal inline dashboard if the directory doesn't exist yet
    app.get('/', async (request, reply) => {
      reply.type('text/html').send(minimalDashboard());
    });
  }

  // ─── API Routes ─────────────────────────────────────────────────────────────
  app.get('/api/status', createStatusHandler(db));
  app.get('/api/calls',  createCallsHandler(db));
  app.get('/api/stats',  createStatsHandler(db));
  app.get('/api/events', eventsHandler);

  // Config endpoint (read-only in Phase 1 — writable in Phase 2)
  app.get('/api/config', async (request, reply) => {
    return reply.send(config);
  });

  // Health check
  app.get('/api/health', async (request, reply) => {
    return reply.send({ status: 'ok', name: 'tollgate', version: '0.1.0' });
  });

  // Push notification routes
  registerPushRoutes(app);

  // Wire emitter events → SSE broadcast
  const { emit: sseEmit } = await import('./events.js');

  emitter.on('snapshot', (data) => sseEmit('snapshot', data));
  emitter.on('call',     (data) => sseEmit('call',     data));
  emitter.on('alert',    (data) => sseEmit('alert',    data));
  emitter.on('reset',    (data) => sseEmit('reset',    data));

  return app;
}

/**
 * Minimal inline dashboard for when the dashboard/ directory isn't built yet.
 */
function minimalDashboard() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>🛂 Tollgate Dashboard</title>
  <style>
    body { font-family: monospace; background: #1a1a2e; color: #e0e0e0; padding: 2rem; }
    h1 { color: #7eb8f7; }
    pre { background: #0d0d1a; padding: 1rem; border-radius: 8px; overflow: auto; }
    .good { color: #4caf50; }
    .warn { color: #ff9800; }
    .card { background: #0d0d1a; border-radius: 8px; padding: 1rem; margin: 1rem 0; }
    button { background: #7eb8f7; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; color: #000; }
  </style>
</head>
<body>
  <h1>🛂 Tollgate is running!</h1>
  <p>Dashboard UI (Phase 2) coming soon. API is live:</p>
  
  <div class="card">
    <h3>Current Status</h3>
    <pre id="status">Loading...</pre>
  </div>

  <div class="card">
    <h3>Recent Calls</h3>
    <pre id="calls">Loading...</pre>
  </div>

  <div class="card">
    <h3>Live Events</h3>
    <pre id="events" style="max-height:200px;overflow:auto">Connecting...</pre>
  </div>

  <button onclick="refresh()">🔄 Refresh</button>

  <script>
    async function refresh() {
      const [status, calls] = await Promise.all([
        fetch('/api/status').then(r => r.json()),
        fetch('/api/calls?limit=10').then(r => r.json()),
      ]);
      document.getElementById('status').textContent = JSON.stringify(status, null, 2);
      document.getElementById('calls').textContent  = JSON.stringify(calls,  null, 2);
    }

    const es = new EventSource('/api/events');
    const eventsEl = document.getElementById('events');
    es.onmessage = (e) => {
      eventsEl.textContent = e.data + '\\n' + eventsEl.textContent;
    };
    es.addEventListener('connected', () => { eventsEl.textContent = '✅ Connected\\n'; });
    es.addEventListener('snapshot',  (e) => { eventsEl.textContent = '[snapshot] ' + e.data + '\\n' + eventsEl.textContent; });
    es.addEventListener('call',      (e) => { eventsEl.textContent = '[call] '     + e.data + '\\n' + eventsEl.textContent; });
    es.addEventListener('alert',     (e) => { eventsEl.textContent = '[alert] '    + e.data + '\\n' + eventsEl.textContent; });

    refresh();
  </script>
</body>
</html>`;
}
