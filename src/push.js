/**
 * push.js — Web Push notification support for Sniff
 *
 * Generates VAPID keys on first run (stored in conf), manages subscriptions
 * in SQLite, and fires push notifications when alerts trigger.
 *
 * 🐕 Sniff can bark even when you're not watching the dashboard!
 */

import webpush from 'web-push';
import { store } from './config.js';

let _db = null;

/**
 * Initialise push module — call once after db is ready.
 * Generates VAPID keys if not already stored.
 * @param {object} db - database instance from createDb()
 */
export function initPush(db) {
  _db = db;

  // Generate VAPID keys on first run
  let vapidKeys = store.get('vapid');
  if (!vapidKeys || !vapidKeys.publicKey || !vapidKeys.privateKey) {
    vapidKeys = webpush.generateVAPIDKeys();
    store.set('vapid', vapidKeys);
  }

  webpush.setVapidDetails(
    'mailto:sniff@localhost',
    vapidKeys.publicKey,
    vapidKeys.privateKey
  );
}

/**
 * Get the VAPID public key (safe to expose to browser clients).
 * @returns {string}
 */
export function getVapidPublicKey() {
  const vapidKeys = store.get('vapid');
  return vapidKeys?.publicKey || '';
}

/**
 * Register a new push subscription (saves to SQLite).
 * @param {object} subscription - PushSubscription JSON from browser
 */
export function registerSubscription(subscription) {
  if (!_db) throw new Error('Push module not initialised — call initPush(db) first');
  _db.saveSubscription(subscription);
}

/**
 * Remove a push subscription.
 * @param {string} endpoint
 */
export function unregisterSubscription(endpoint) {
  if (!_db) throw new Error('Push module not initialised — call initPush(db) first');
  _db.deleteSubscription(endpoint);
}

/**
 * Send a push notification to a single subscription.
 * Silently removes the subscription if it's expired/invalid (410).
 * @param {object} subscription - PushSubscription JSON
 * @param {object} payload - { title, body, type }
 */
export async function sendPush(subscription, payload) {
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
  } catch (err) {
    // 410 Gone = subscription is expired, clean it up
    if (err.statusCode === 410 && _db) {
      try { _db.deleteSubscription(subscription.endpoint); } catch {}
    }
    // Don't rethrow — push failures are non-fatal
  }
}

/**
 * Send a push notification to all registered subscribers.
 * @param {string} type - alert type ('token_warning', 'token_critical', etc.)
 * @param {string} message - human-readable message
 */
export async function notifyAll(type, message) {
  if (!_db) return;

  let subs;
  try {
    subs = _db.getSubscriptions();
  } catch {
    return;
  }

  if (!subs || subs.length === 0) return;

  const titleMap = {
    token_warning:  '🦴 Sniff Warning',
    token_critical: '🚨 Sniff Critical',
    rate_limit_hit: '🛑 Rate Limit Hit',
  };

  const payload = {
    title: titleMap[type] || '🐕 Sniff Alert',
    body:  message,
    type,
  };

  await Promise.allSettled(subs.map(sub => sendPush({
    endpoint: sub.endpoint,
    keys: { p256dh: sub.p256dh, auth: sub.auth },
  }, payload)));
}
