const { admin, adminInitialized } = require('../config/firebase');
const { getEnvValue } = require('../utils/loadEnv');
const logger = require('../utils/logger');

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn('Protected route rejected due to missing token', {
      path: req.originalUrl || req.path,
      method: req.method,
    });

    return res.status(401).json({
      success: false,
      error: 'No token provided. Send Authorization: Bearer <token>',
    });
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    if (adminInitialized) {
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      req.user = {
        uid: decodedToken.uid,
        email: decodedToken.email,
        displayName: decodedToken.name || '',
      };
    } else {
      const apiKey = getEnvValue('FIREBASE_API_KEY');

      if (!apiKey) {
        return res.status(500).json({
          success: false,
          error:
            'Backend misconfigured: FIREBASE_API_KEY is missing. Create backend/.env from backend/.env.example and restart the backend server.',
        });
      }

      const response = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
        }
      );

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error.message);
      }

      const userInfo = data.users?.[0];
      if (!userInfo) {
        throw new Error('User not found');
      }

      req.user = {
        uid: userInfo.localId,
        email: userInfo.email,
        displayName: userInfo.displayName || '',
      };
    }

    logger.info('Token verified', {
      path: req.originalUrl || req.path,
      method: req.method,
      uid: req.user.uid,
      email: logger.maskEmail(req.user.email),
      adminMode: adminInitialized,
    });

    return next();
  } catch (error) {
    logger.warn('Token verification failed', {
      path: req.originalUrl || req.path,
      method: req.method,
      error: error.message,
      adminMode: adminInitialized,
    });

    return res.status(401).json({
      success: false,
      error: 'Invalid or expired token.',
    });
  }
};

module.exports = { verifyToken };
