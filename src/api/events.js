/**
 * events.js — Server-Sent Events (SSE) handler
 * 
 * Keeps a live Set of connected SSE clients.
 * All proxy events are broadcast here in real-time.
 * 
 * 🐕 Tollgate broadcasts to everyone listening on the trail.
 */

// Set of connected SSE response objects
const clients = new Set();

/**
 * Add a new SSE client connection.
 * Sets up connection cleanup on close.
 * 
 * @param {object} res - Fastify reply object (raw Node res)
 */
export function addClient(res) {
  clients.add(res);
  res.on('close', () => {
    clients.delete(res);
  });
}

/**
 * Emit an SSE event to all connected clients.
 * 
 * @param {string} event - event name (snapshot|call|alert|reset)
 * @param {object} data - event payload
 */
export function emit(event, data) {
  if (clients.size === 0) return;

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      // Client disconnected — remove from set
      clients.delete(res);
    }
  }
}

/**
 * Get current client count (for diagnostics).
 */
export function clientCount() {
  return clients.size;
}

/**
 * Fastify route handler for GET /api/events
 * Sets up SSE headers and registers client.
 * 
 * @param {object} request - Fastify request
 * @param {object} reply - Fastify reply
 */
export function eventsHandler(request, reply) {
  const res = reply.raw;

  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
    'X-Accel-Buffering': 'no', // Disable nginx buffering if behind proxy
  });

  // Send an initial heartbeat so the client knows it's connected
  res.write('event: connected\ndata: {"status":"monitoring"}\n\n');

  // Register this client
  addClient(res);

  // Keep alive ping every 30s to prevent timeout
  const pingInterval = setInterval(() => {
    try {
      res.write(':ping\n\n');
    } catch {
      clearInterval(pingInterval);
      clients.delete(res);
    }
  }, 30_000);

  res.on('close', () => {
    clearInterval(pingInterval);
  });

  // Don't call reply.send() — we're managing the response manually
  return reply;
}
