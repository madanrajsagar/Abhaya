const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

let loadedEnvPath = null;

const resolveCandidatePaths = () => {
  const backendDir = path.resolve(__dirname, '..');
  const projectRoot = path.resolve(backendDir, '..');

  return [
    path.join(backendDir, '.env'),
    path.join(projectRoot, '.env'),
  ];
};

const ensureEnvLoaded = () => {
  if (loadedEnvPath) {
    return loadedEnvPath;
  }

  for (const envPath of resolveCandidatePaths()) {
    if (!fs.existsSync(envPath)) {
      continue;
    }

    const result = dotenv.config({ path: envPath });
    if (!result.error) {
      loadedEnvPath = envPath;
      return loadedEnvPath;
    }
  }

  return null;
};

const getEnvValue = (name, fallback = '') => {
  ensureEnvLoaded();
  const value = process.env[name];
  return typeof value === 'string' && value.length ? value : fallback;
};

module.exports = {
  ensureEnvLoaded,
  getEnvValue,
};
