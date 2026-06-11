const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const { ensureEnvLoaded, getEnvValue } = require('./utils/loadEnv');
const logger = require('./utils/logger');

const loadedEnvPath = ensureEnvLoaded();

if (!loadedEnvPath) {
  console.warn('backend/.env not found. Copy backend/.env.example -> backend/.env and restart the server.');
}

console.log(`FIREBASE_API_KEY ${getEnvValue('FIREBASE_API_KEY') ? 'loaded' : 'missing'}`);

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '8mb' }));

app.use('/api/auth/login', rateLimit({ windowMs: 60 * 1000, max: 10, message: { success: false, error: 'Too many login attempts. Try again later.' } }));
app.use('/api/auth/signup', rateLimit({ windowMs: 60 * 1000, max: 5, message: { success: false, error: 'Too many signup attempts. Try again later.' } }));
app.use('/api/journey/sos', rateLimit({ windowMs: 60 * 1000, max: 5, message: { success: false, error: 'Too many SOS requests. Try again later.' } }));
app.use('/api/audio/transcribe', rateLimit({ windowMs: 60 * 1000, max: 10, message: { success: false, error: 'Too many transcription requests. Try again later.' } }));
app.use('/send-email', rateLimit({ windowMs: 60 * 1000, max: 5, message: { success: false, error: 'Too many email requests. Try again later.' } }));
app.use('/api/send-email', rateLimit({ windowMs: 60 * 1000, max: 5, message: { success: false, error: 'Too many email requests. Try again later.' } }));

app.use((req, res, next) => {
  const startedAt = Date.now();

  res.on('finish', () => {
    logger.info('HTTP request completed', {
      method: req.method,
      path: req.originalUrl || req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
      ip: req.ip,
    });
  });

  next();
});

const authRoutes = require('./routes/auth');
const journeyRoutes = require('./routes/journey');
const historyRoutes = require('./routes/history');
const vehicleObservationRoutes = require('./routes/vehicleObservations');
const incidentRoutes = require('./routes/incidents');
const emailRoutes = require('./routes/email');
const userVideoRoutes = require('./routes/userVideos');
const audioRoutes = require('./routes/audio');

app.use('/api/auth', authRoutes);
app.use('/api/journey', journeyRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/vehicle-observations', vehicleObservationRoutes);
app.use('/api/incidents', incidentRoutes);
app.use('/api/audio', audioRoutes);
app.use(userVideoRoutes);
app.use('/api', userVideoRoutes);

// Supports both:
// - POST /send-email
// - POST /api/send-email
app.use(['/send-email', '/api/send-email'], emailRoutes);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'SafeGuard Backend',
    firebaseConfigured: Boolean(getEnvValue('FIREBASE_API_KEY')),
    envLoaded: Boolean(loadedEnvPath),
    timestamp: new Date().toISOString(),
  });
});

app.use((req, res) => {
  logger.warn('Route not found', {
    method: req.method,
    path: req.originalUrl || req.path,
  });

  res.status(404).json({
    success: false,
    error: `Route ${req.method} ${req.path} not found.`,
  });
});

app.use((err, req, res, next) => {
  logger.error('Unhandled server error', {
    method: req.method,
    path: req.path,
    error: err.message,
  });

  res.status(500).json({
    success: false,
    error: 'Internal server error.',
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`SafeGuard Backend Server running on http://0.0.0.0:${PORT}`);
  console.log('Available routes:');
  console.log('POST   /api/auth/signup');
  console.log('POST   /api/auth/login');
  console.log('POST   /api/auth/refresh');
  console.log('GET    /api/auth/profile');
  console.log('PUT    /api/auth/profile');
  console.log('DELETE /api/auth/account');
  console.log('GET    /api/journey/geocode');
  console.log('GET    /api/journey/route');
  console.log('POST   /api/journey/check-deviation');
  console.log('POST   /api/journey/sos');
  console.log('GET    /api/history');
  console.log('POST   /api/history');
  console.log('POST   /api/history/:historyId/events');
  console.log('PATCH  /api/history/:historyId');
  console.log('GET    /api/vehicle-observations');
  console.log('POST   /api/vehicle-observations');
  console.log('POST   /api/save-video');
  console.log('POST   /api/audio/transcribe');
  console.log('GET    /api/user-videos/:userId');
  console.log('DELETE /api/video/:id');
  console.log('POST   /send-email');
  console.log('POST   /api/send-email');
  console.log('GET    /api/health');

  logger.info('Backend server started', {
    port: PORT,
    firebaseConfigured: Boolean(getEnvValue('FIREBASE_API_KEY')),
    envLoaded: Boolean(loadedEnvPath),
    logFilePath: logger.logFilePath,
  });
});
