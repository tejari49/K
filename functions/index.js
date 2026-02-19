'use strict';

const admin = require('firebase-admin');
const functions = require('firebase-functions');

admin.initializeApp();

const db = admin.firestore();

const APP_ID = 'timeroster-app';
const APP_URL = 'https://tejari49.github.io/Meal/';

// Always neutral notification text (privacy)
function buildNeutralNotification() {
  return {
    title: 'Kalender aktualisiert',
    body: 'Es gibt neue Updates.'
  };
}

async function getUserTokens(userId) {
  const tokensSnap = await db.collection('artifacts').doc(APP_ID).collection('users').doc(userId).collection('fcm_tokens').get();
  const tokens = [];
  tokensSnap.forEach(d => {
    const data = d.data() || {};
    const token = data.token || d.id;
    if (token) tokens.push(token);
  });
  return tokens;
}

async function removeBadTokens(userId, badTokens) {
  if (!badTokens || badTokens.length === 0) return;
  const batch = db.batch();
  badTokens.forEach(t => {
    const ref = db.collection('artifacts').doc(APP_ID).collection('users').doc(userId).collection('fcm_tokens').doc(t);
    batch.delete(ref);
  });
  await batch.commit();
}

// 1) Deliver queued push notifications (created by client via notification_queue)
exports.sendQueuedNotification = functions.firestore
  .document(`artifacts/${APP_ID}/notification_queue/{notifId}`)
  .onCreate(async (snap) => {
    const notif = snap.data() || {};
    const recipientUserId = notif.recipientUserId;

    if (!recipientUserId) {
      await snap.ref.set({ status: 'invalid', error: 'missing recipientUserId', processedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      return;
    }

    const tokens = await getUserTokens(recipientUserId);
    if (!tokens.length) {
      await snap.ref.set({ status: 'no_tokens', processedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      return;
    }

    const neutral = buildNeutralNotification();
    const data = Object.assign({}, (notif.data || {}), {
      url: APP_URL,
      type: (notif.data && notif.data.type) ? String(notif.data.type) : 'update'
    });

    const message = {
      tokens,
      notification: neutral,
      data,
      webpush: {
        fcmOptions: { link: APP_URL }
      }
    };

    const resp = await admin.messaging().sendEachForMulticast(message);

    const bad = [];
    resp.responses.forEach((r, idx) => {
      if (!r.success) {
        const code = r.error && r.error.code ? r.error.code : '';
        if (code.includes('registration-token-not-registered') || code.includes('invalid-argument')) {
          bad.push(tokens[idx]);
        }
      }
    });

    if (bad.length) {
      await removeBadTokens(recipientUserId, bad);
    }

    await snap.ref.set({
      status: 'sent',
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
      successCount: resp.successCount,
      failureCount: resp.failureCount
    }, { merge: true });
  });

// 2) Secret chat: mirror contacts when a request is accepted (avoid client cross-writes)
exports.mirrorSecretContactOnAccept = functions.firestore
  .document(`artifacts/${APP_ID}/secret_requests/{reqId}`)
  .onWrite(async (change) => {
    const after = change.after.exists ? (change.after.data() || {}) : null;
    if (!after) return;

    if (after.status !== 'accepted') return;

    const from = after.from;
    const to = after.to;
    if (!from || !to) return;

    // Create contact documents on both sides (id = other uid)
    const fromName = after.fromName || (String(from).slice(0, 6) + '…');
    const toName = after.toName || (String(to).slice(0, 6) + '…');

    const refA = db.collection('artifacts').doc(APP_ID).collection('users').doc(from).collection('secret_contacts').doc(to);
    const refB = db.collection('artifacts').doc(APP_ID).collection('users').doc(to).collection('secret_contacts').doc(from);

    await Promise.all([
      refA.set({ friendId: to, name: toName, acceptedAt: admin.firestore.FieldValue.serverTimestamp(), mirrored: true }, { merge: true }),
      refB.set({ friendId: from, name: fromName, acceptedAt: admin.firestore.FieldValue.serverTimestamp(), mirrored: true }, { merge: true })
    ]);

    // Optional cleanup (keep accepted log small)
    try {
      await change.after.ref.delete();
    } catch (e) {
      // ignore
    }
  });
