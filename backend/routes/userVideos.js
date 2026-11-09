const express = require('express');

const { admin, adminInitialized } = require('../config/firebase');
const { verifyToken } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

const ensureFirestore = (res) => {
  if (!adminInitialized) {
    res.status(503).json({
      success: false,
      error:
        'Video storage requires Firebase Admin SDK (Firestore). Add backend/config/serviceAccountKey.json and enable Firestore.',
    });
    return false;
  }

  return true;
};

const getCollection = () => admin.firestore().collection('user_videos');

const toClientRecord = (doc) => {
  const data = doc.data();
  return {
    id: doc.id,
    ...data,
    createdAt: data.createdAt?.toDate?.().toISOString?.() || data.createdAt || null,
  };
};

const toSortableTimestamp = (value) => {
  if (!value) return 0;

  const date = new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? 0 : time;
};

/**
 * POST /save-video
 * Body: { videoUrl, incidentId }
 * Saves video metadata for the authenticated user.
 */
router.post('/save-video', verifyToken, async (req, res) => {
  if (!ensureFirestore(res)) return;

  const videoUrl = String(req.body?.videoUrl || '').trim();
  const incidentId = String(req.body?.incidentId || '').trim();

  if (!videoUrl) {
    return res.status(400).json({ success: false, error: 'videoUrl is required.' });
  }

  try {
    const payload = {
      userId: req.user.uid,
      videoUrl,
      incidentId: incidentId || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const ref = await getCollection().add(payload);
    const doc = await ref.get();

    logger.info('User video saved', {
      uid: req.user.uid,
      videoId: ref.id,
      incidentId: incidentId || null,
    });

    return res.status(201).json({ success: true, data: toClientRecord(doc) });
  } catch (error) {
    logger.error('User video save failed', {
      uid: req.user.uid,
      error: error.message,
    });
    return res.status(500).json({ success: false, error: 'Failed to save video metadata.' });
  }
});

/**
 * GET /user-videos/:userId
 * Returns only the authenticated user's videos.
 */
router.get('/user-videos/:userId', verifyToken, async (req, res) => {
  if (!ensureFirestore(res)) return;

  const requestedUserId = String(req.params.userId || '').trim();
  if (!requestedUserId) {
    return res.status(400).json({ success: false, error: 'userId is required.' });
  }

  if (requestedUserId !== req.user.uid) {
    return res.status(403).json({ success: false, error: 'Forbidden.' });
  }

  try {
    const snapshot = await getCollection()
      .where('userId', '==', req.user.uid)
      .get();

    const items = snapshot.docs
      .map(toClientRecord)
      .sort((a, b) => toSortableTimestamp(b.createdAt) - toSortableTimestamp(a.createdAt))
      .slice(0, 100);

    logger.info('User videos fetched', {
      uid: req.user.uid,
      count: items.length,
    });

    return res.json({
      success: true,
      data: items,
    });
  } catch (error) {
    logger.error('User videos fetch failed', {
      uid: req.user.uid,
      error: error.message,
    });
    return res.status(500).json({ success: false, error: 'Failed to load user videos.' });
  }
});

/**
 * DELETE /video/:id
 * Deletes a video metadata record (only if it belongs to the authenticated user).
 */
router.delete('/video/:id', verifyToken, async (req, res) => {
  if (!ensureFirestore(res)) return;

  const id = String(req.params.id || '').trim();
  if (!id) {
    return res.status(400).json({ success: false, error: 'id is required.' });
  }

  try {
    const ref = getCollection().doc(id);
    const doc = await ref.get();

    if (!doc.exists) {
      return res.status(404).json({ success: false, error: 'Video not found.' });
    }

    const data = doc.data() || {};
    if (data.userId !== req.user.uid) {
      return res.status(403).json({ success: false, error: 'Forbidden.' });
    }

    await ref.delete();

    logger.info('User video deleted', {
      uid: req.user.uid,
      videoId: id,
    });

    return res.json({ success: true });
  } catch (error) {
    logger.error('User video delete failed', {
      uid: req.user.uid,
      videoId: id,
      error: error.message,
    });
    return res.status(500).json({ success: false, error: 'Failed to delete video.' });
  }
});

module.exports = router;
