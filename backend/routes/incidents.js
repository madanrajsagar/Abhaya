const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { verifyToken } = require('../middleware/auth');

const router = express.Router();

const DB_PATH = path.join(__dirname, '..', 'data', 'incidents.json');

const readDb = () => {
  try {
    if (!fs.existsSync(DB_PATH)) {
      return { incidents: [] };
    }
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      incidents: Array.isArray(parsed?.incidents) ? parsed.incidents : [],
    };
  } catch {
    return { incidents: [] };
  }
};

const writeDb = (db) => {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmpPath, DB_PATH);
};

const findIncident = (db, incidentId) =>
  db.incidents.find((i) => i.incidentId === incidentId) || null;

// All incident routes require auth
router.use(verifyToken);

/**
 * POST /api/incidents/mock
 * Creates a mocked incident report record for the authenticated user.
 * Body (optional): { location: { lat, lng }, riskScore }
 */
router.post('/mock', (req, res) => {
  const db = readDb();
  const now = new Date().toISOString();

  const incident = {
    incidentId: crypto.randomUUID(),
    createdAt: now,
    user: {
      uid: req.user.uid,
      name: req.user.displayName || 'User',
      email: req.user.email || '',
      phone: req.body?.user?.phone || '',
    },
    location: {
      lat: Number(req.body?.location?.lat ?? 21.1458),
      lng: Number(req.body?.location?.lng ?? 79.0882),
    },
    riskScore: String(req.body?.riskScore || 'HIGH'),
    videoEvidence: [],
  };

  db.incidents.push(incident);
  writeDb(db);

  res.status(201).json({ success: true, data: incident });
});

/**
 * GET /api/incidents/latest
 * Returns the latest incident for the authenticated user.
 */
router.get('/latest', (req, res) => {
  const db = readDb();
  const latest = [...db.incidents]
    .filter((i) => i.user?.uid === req.user.uid)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];

  if (!latest) {
    return res.status(404).json({ success: false, error: 'No incidents found.' });
  }

  res.json({ success: true, data: latest });
});

/**
 * GET /api/incidents/:incidentId
 * Returns incident details (must belong to user).
 */
router.get('/:incidentId', (req, res) => {
  const db = readDb();
  const incident = findIncident(db, req.params.incidentId);

  if (!incident || incident.user?.uid !== req.user.uid) {
    return res.status(404).json({ success: false, error: 'Incident not found.' });
  }

  res.json({ success: true, data: incident });
});

/**
 * GET /api/incidents/:incidentId/videos
 * Returns video evidence list for an incident (must belong to user).
 */
router.get('/:incidentId/videos', (req, res) => {
  const db = readDb();
  const incident = findIncident(db, req.params.incidentId);

  if (!incident || incident.user?.uid !== req.user.uid) {
    return res.status(404).json({ success: false, error: 'Incident not found.' });
  }

  res.json({ success: true, data: incident.videoEvidence || [] });
});

/**
 * POST /api/incidents/:incidentId/videos
 * Adds a video evidence URL to an incident (must belong to user).
 * Body: { url, label }
 */
router.post('/:incidentId/videos', (req, res) => {
  const { url, label } = req.body || {};
  if (!url) {
    return res.status(400).json({ success: false, error: 'Video url is required.' });
  }

  const db = readDb();
  const incident = findIncident(db, req.params.incidentId);

  if (!incident || incident.user?.uid !== req.user.uid) {
    return res.status(404).json({ success: false, error: 'Incident not found.' });
  }

  const evidence = {
    id: crypto.randomUUID(),
    url: String(url),
    label: String(label || 'Incident Evidence Video'),
    uploadedAt: new Date().toISOString(),
  };

  incident.videoEvidence = Array.isArray(incident.videoEvidence) ? incident.videoEvidence : [];
  incident.videoEvidence.unshift(evidence);

  writeDb(db);
  res.status(201).json({ success: true, data: evidence });
});

module.exports = router;