const express = require('express');

const { admin, adminInitialized } = require('../config/firebase');
const { verifyToken } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

const getHistoryCollection = (uid) =>
  admin.firestore().collection('users').doc(uid).collection('journeyHistory');

const ensureFirestore = (res) => {
  if (!adminInitialized) {
    res.status(503).json({
      success: false,
      error:
        'Journey history requires Firebase Admin SDK. Add backend/config/serviceAccountKey.json and enable Firestore.',
    });
    return false;
  }

  return true;
};

const sanitizeNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const sanitizeText = (value) => {
  const text = String(value || '').trim();
  return text || null;
};

const sanitizeRouteSummary = (summary = {}) => ({
  destinationName: String(summary.destinationName || ''),
  destinationLat: sanitizeNumber(summary.destinationLat),
  destinationLng: sanitizeNumber(summary.destinationLng),
  startLat: sanitizeNumber(summary.startLat),
  startLng: sanitizeNumber(summary.startLng),
  eta: sanitizeNumber(summary.eta),
  distanceKm: sanitizeNumber(summary.distanceKm),
  selectedRouteIndex: Number.isInteger(summary.selectedRouteIndex)
    ? summary.selectedRouteIndex
    : null,
  journeyMode: sanitizeText(summary.journeyMode) || 'vehicle',
  vehicleScanId: sanitizeText(summary.vehicleScanId),
  plateNumber: sanitizeText(summary.plateNumber),
  vehicleType: sanitizeText(summary.vehicleType),
  vehicleBrand: sanitizeText(summary.vehicleBrand),
  vehicleModel: sanitizeText(summary.vehicleModel),
  vehicleColor: sanitizeText(summary.vehicleColor),
});

const clampLimit = (value, fallback, max) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }

  return Math.min(Math.floor(numeric), max);
};

const resolveEventLimit = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (String(value).trim().toLowerCase() === 'all') {
    return null;
  }

  return clampLimit(value, 25, 500);
};

const toClientRecord = (doc) => {
  const data = doc.data();

  return {
    id: doc.id,
    ...data,
    createdAt: data.createdAt?.toDate?.().toISOString?.() || data.createdAt || null,
    updatedAt: data.updatedAt?.toDate?.().toISOString?.() || data.updatedAt || null,
    endedAt: data.endedAt?.toDate?.().toISOString?.() || data.endedAt || null,
  };
};

router.get('/', verifyToken, async (req, res) => {
  if (!ensureFirestore(res)) return;

  const limit = clampLimit(req.query.limit, 12, 50);
  const eventLimit = resolveEventLimit(req.query.eventLimit);

  try {
    const snapshot = await getHistoryCollection(req.user.uid)
      .orderBy('updatedAt', 'desc')
      .limit(limit)
      .get();

    const records = snapshot.docs.map((doc) => {
      const record = toClientRecord(doc);
      const events = Array.isArray(record.events) ? record.events : [];

      return {
        ...record,
        events: eventLimit === null ? events : events.slice(-eventLimit),
        eventCount: events.length,
      };
    });

    return res.json({
      success: true,
      data: records,
    });
  } catch (error) {
    logger.error('Journey history list failed', {
      uid: req.user.uid,
      error: error.message,
    });

    return res.status(500).json({
      success: false,
      error: 'Failed to load journey history.',
    });
  }
});

router.post('/', verifyToken, async (req, res) => {
  if (!ensureFirestore(res)) return;

  const summary = sanitizeRouteSummary(req.body.summary);
  const status = String(req.body.status || 'active');
  const event = String(req.body.event || 'journey_started');

  if (!summary.destinationName || summary.startLat === null || summary.startLng === null) {
    return res.status(400).json({
      success: false,
      error: 'Destination and start location are required for journey history.',
    });
  }

  try {
    const now = admin.firestore.FieldValue.serverTimestamp();
    const docRef = await getHistoryCollection(req.user.uid).add({
      ...summary,
      status,
      events: [
        {
          type: event,
          message: String(req.body.message || 'Journey started'),
          createdAt: new Date().toISOString(),
        },
      ],
      createdAt: now,
      updatedAt: now,
    });

    return res.status(201).json({
      success: true,
      data: { id: docRef.id },
    });
  } catch (error) {
    logger.error('Journey history create failed', {
      uid: req.user.uid,
      error: error.message,
    });

    return res.status(500).json({
      success: false,
      error: 'Failed to save journey history.',
    });
  }
});

router.post('/:historyId/events', verifyToken, async (req, res) => {
  if (!ensureFirestore(res)) return;

  const historyId = String(req.params.historyId || '').trim();
  const event = {
    type: String(req.body.type || 'journey_event'),
    message: String(req.body.message || ''),
    location: req.body.location || null,
    metadata: req.body.metadata || null,
    createdAt: new Date().toISOString(),
  };

  try {
    const docRef = getHistoryCollection(req.user.uid).doc(historyId);
    await docRef.update({
      events: admin.firestore.FieldValue.arrayUnion(event),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ success: true });
  } catch (error) {
    logger.error('Journey history event failed', {
      uid: req.user.uid,
      historyId,
      error: error.message,
    });

    return res.status(500).json({
      success: false,
      error: 'Failed to save journey event.',
    });
  }
});

router.patch('/:historyId', verifyToken, async (req, res) => {
  if (!ensureFirestore(res)) return;

  const historyId = String(req.params.historyId || '').trim();
  const status = String(req.body.status || 'completed');
  const eventMessage = String(req.body.message || `Journey ${status}`);
  const eventType = String(
    req.body.eventType || (status === 'completed' ? 'journey_completed' : 'journey_ended')
  );

  try {
    const docRef = getHistoryCollection(req.user.uid).doc(historyId);
    await docRef.update({
      status,
      endedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      events: admin.firestore.FieldValue.arrayUnion({
        type: eventType,
        message: eventMessage,
        createdAt: new Date().toISOString(),
      }),
    });

    return res.json({ success: true });
  } catch (error) {
    logger.error('Journey history update failed', {
      uid: req.user.uid,
      historyId,
      error: error.message,
    });

    return res.status(500).json({
      success: false,
      error: 'Failed to update journey history.',
    });
  }
});

module.exports = router;
