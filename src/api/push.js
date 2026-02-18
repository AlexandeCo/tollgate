/**
 * api/push.js — Push notification Fastify routes
 *
 * GET  /api/push/vapid-key  — returns public VAPID key for browser
 * POST /api/push/subscribe  — saves a push subscription
 * DELETE /api/push/subscribe — removes a push subscription
 *
 * 🐕 Sniff's bark delivery service.
 */

import { getVapidPublicKey, registerSubscription, unregisterSubscription } from '../push.js';

/**
 * Register push routes on a Fastify instance.
 * @param {FastifyInstance} app
 */
export function registerPushRoutes(app) {
  // Return the VAPID public key so the browser can subscribe
  app.get('/api/push/vapid-key', async (request, reply) => {
    const key = getVapidPublicKey();
    if (!key) {
      return reply.status(503).send({ error: 'Push not initialised' });
    }
    return reply.send({ publicKey: key });
  });

  // Save a new push subscription
  app.post('/api/push/subscribe', async (request, reply) => {
    const { endpoint, keys } = request.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return reply.status(400).send({ error: 'Invalid subscription object' });
    }
    try {
      registerSubscription({ endpoint, p256dh: keys.p256dh, auth: keys.auth });
      return reply.status(201).send({ ok: true });
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // Remove a push subscription
  app.delete('/api/push/subscribe', async (request, reply) => {
    const { endpoint } = request.body || {};
    if (!endpoint) {
      return reply.status(400).send({ error: 'Missing endpoint' });
    }
    try {
      unregisterSubscription(endpoint);
      return reply.send({ ok: true });
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });
}
