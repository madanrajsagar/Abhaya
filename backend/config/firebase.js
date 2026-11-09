const admin = require('firebase-admin');
const { getEnvValue } = require('../utils/loadEnv');

/**
 * Initialize Firebase Admin SDK if service account key is available.
 * Admin SDK is optional — used for token verification on protected routes.
 * All auth operations (signup/login) use the Firebase REST API instead.
 */
let adminInitialized = false;

try {
  const fs = require('fs');
  const path = require('path');
  const backendDir = path.resolve(__dirname, '..');
  const envServiceAccountPath = getEnvValue('FIREBASE_SERVICE_ACCOUNT_PATH');
  const serviceAccountPath = envServiceAccountPath
    ? (path.isAbsolute(envServiceAccountPath)
        ? envServiceAccountPath
        : path.resolve(backendDir, envServiceAccountPath))
    : path.resolve(__dirname, 'serviceAccountKey.json');

  if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    adminInitialized = true;
    console.log('Firebase Admin SDK initialized (full mode)');
  } else {
    console.log('No service account key found — running in REST-only mode');
    console.log('Auth will work via Firebase REST API (API key).');
    console.log('To enable Admin SDK, add: backend/config/serviceAccountKey.json');
  }
} catch (error) {
  console.error('Firebase Admin init error:', error.message);
  console.log('   Continuing in REST-only mode...');
}

module.exports = { admin, adminInitialized };
