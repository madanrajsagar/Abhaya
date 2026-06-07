const express = require('express');
const cors = require('cors');

const { ensureEnvLoaded, getEnvValue } = require('./utils/loadEnv');
const logger = require('./utils/logger');

const loadedEnvPath = ensureEnvLoaded();

if (!loadedEnvPath) {
  logger.warn('backend/.env not found. Copy backend/.env.example -> backend/.env and restart the server.');
}

logger.info(`FIREBASE_API_KEY ${getEnvValue('FIREBASE_API_KEY') ? 'loaded' : 'missing'}`);

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '8mb' }));

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
  logger.info('Backend server started', {
    port: PORT,
    firebaseConfigured: Boolean(getEnvValue('FIREBASE_API_KEY')),
    envLoaded: Boolean(loadedEnvPath),
    logFilePath: logger.logFilePath,
    routes: [
      'POST   /api/auth/signup',
      'POST   /api/auth/login',
      'POST   /api/auth/refresh',
      'GET    /api/auth/profile',
      'PUT    /api/auth/profile',
      'DELETE /api/auth/account',
      'GET    /api/journey/geocode',
      'GET    /api/journey/route',
      'POST   /api/journey/check-deviation',
      'POST   /api/journey/sos',
      'GET    /api/history',
      'POST   /api/history',
      'POST   /api/history/:historyId/events',
      'PATCH  /api/history/:historyId',
      'GET    /api/vehicle-observations',
      'POST   /api/vehicle-observations',
      'POST   /api/save-video',
      'POST   /api/audio/transcribe',
      'GET    /api/user-videos/:userId',
      'DELETE /api/video/:id',
      'POST   /send-email',
      'POST   /api/send-email',
      'GET    /api/health',
    ],
  });
});
