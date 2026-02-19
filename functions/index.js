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

// 3) Friend requests: Create / Accept requests safely from Cloud Function
exports.addFriendRequest = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'User not authenticated');
  
  const { friendCode } = data;
  const currentUid = context.auth.uid;
  
  if (!friendCode || typeof friendCode !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid friend code');
  }

  try {
    // 1) Find friend by code in public_profiles
    const profilesSnap = await db.collection('artifacts').doc(APP_ID).collection('public_profiles').where('shareCode', '==', friendCode).limit(1).get();
    
    if (profilesSnap.empty) {
      throw new functions.https.HttpsError('not-found', 'Friend code not found');
    }

    const friendProfile = profilesSnap.docs[0].data();
    const friendUid = friendProfile.userId;
    const friendName = friendProfile.name || 'Friend';

    if (friendUid === currentUid) {
      throw new functions.https.HttpsError('invalid-argument', 'Cannot add yourself');
    }

    // 2) Get current user's shareCode
    const currentProfileSnap = await db.collection('artifacts').doc(APP_ID).collection('users').doc(currentUid).get();
    const currentProfileData = currentProfileSnap.data() || {};
    const currentShareCode = currentProfileData.shareCode || '';
    const currentName = currentProfileData.name || currentUid.slice(0, 6);

    // 3) Write both directions in transaction
    await db.runTransaction(async (transaction) => {
      transaction.set(
        db.collection('artifacts').doc(APP_ID).collection('users').doc(currentUid).collection('friends').doc(friendUid),
        { status: 'pending_sent', shareCode: friendCode, name: friendName, createdAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
      transaction.set(
        db.collection('artifacts').doc(APP_ID).collection('users').doc(friendUid).collection('friends').doc(currentUid),
        { status: 'pending_received', shareCode: currentShareCode, name: currentName, createdAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    });

    return { success: true, friendName };
  } catch (e) {
    console.error('addFriendRequest error:', e);
    throw new functions.https.HttpsError('internal', e.message || 'Error adding friend');
  }
});

// 4) Accept friend request
exports.acceptFriendRequest = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'User not authenticated');
  
  const { friendUid } = data;
  const currentUid = context.auth.uid;

  if (!friendUid || typeof friendUid !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid friend UID');
  }

  try {
    await db.runTransaction(async (transaction) => {
      transaction.update(
        db.collection('artifacts').doc(APP_ID).collection('users').doc(currentUid).collection('friends').doc(friendUid),
        { status: 'accepted', acceptedAt: admin.firestore.FieldValue.serverTimestamp() }
      );
      transaction.update(
        db.collection('artifacts').doc(APP_ID).collection('users').doc(friendUid).collection('friends').doc(currentUid),
        { status: 'accepted', acceptedAt: admin.firestore.FieldValue.serverTimestamp() }
      );
    });

    return { success: true };
  } catch (e) {
    console.error('acceptFriendRequest error:', e);
    throw new functions.https.HttpsError('internal', e.message || 'Error accepting request');
  }
});

// 5) Update user profile and public profile (creates/updates shareCode)
exports.updateUserProfile = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'User not authenticated');
  
  const { name, shareCode } = data;
  const uid = context.auth.uid;

  try {
    const profileRef = db.collection('artifacts').doc(APP_ID).collection('users').doc(uid);
    
    // Update main profile
    await profileRef.set(
      { name: name || uid.slice(0, 6), shareCode, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );

    // Update public profile
    if (shareCode) {
      await db.collection('artifacts').doc(APP_ID).collection('public_profiles').doc(shareCode).set(
        { userId: uid, name: name || uid.slice(0, 6), updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    }

    return { success: true };
  } catch (e) {
    console.error('updateUserProfile error:', e);
    throw new functions.https.HttpsError('internal', e.message || 'Error updating profile');
  }
});
