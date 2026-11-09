import Constants from 'expo-constants';
import { Platform } from 'react-native';

const API_PORT = '5000';

const trimTrailingSlash = (value) => value.replace(/\/+$/, '');

const normalizeBaseUrl = (value) => {
  const trimmed = trimTrailingSlash(value.trim());
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
};

const extractHost = (value) => {
  if (!value || typeof value !== 'string') {
    return null;
  }

  return value
    .replace(/^[a-z]+:\/\//i, '')
    .split('/')[0]
    .split(':')[0];
};

const getExpoHost = () =>
  extractHost(Constants.expoConfig?.hostUri) ||
  extractHost(Constants.expoGoConfig?.debuggerHost) ||
  extractHost(Constants.platform?.hostUri) ||
  extractHost(Constants.manifest?.debuggerHost);

const buildBaseCandidates = () => {
  const configuredValues = [
    process.env.EXPO_PUBLIC_API_BASE_URL,
    process.env.EXPO_PUBLIC_API_URL,
    process.env.EXPO_PUBLIC_BACKEND_API_URL,
    process.env.EXPO_PUBLIC_BACKEND_URL,
  ]
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => normalizeBaseUrl(value));

  const discoveredValues = [];

  if (Platform.OS === 'web') {
    discoveredValues.push(`http://localhost:${API_PORT}/api`);
  }

  const expoHost = getExpoHost();
  if (expoHost) {
    discoveredValues.push(`http://${expoHost}:${API_PORT}/api`);
  }

  if (Platform.OS === 'android') {
    discoveredValues.push(`http://10.0.2.2:${API_PORT}/api`);
  }

  discoveredValues.push(`http://localhost:${API_PORT}/api`);

  return [...configuredValues, ...discoveredValues].filter(
    (value, index, list) => value && list.indexOf(value) === index
  );
};

export const BASE_URL_CANDIDATES = buildBaseCandidates();
export const BASE_URL = BASE_URL_CANDIDATES[0];
export const HEALTH_URL = `${BASE_URL}/health`;

export const backendUnavailableMessage = `Cannot reach the backend at ${BASE_URL}. Start the backend with "cd Abhaya/backend && npm start", then open ${HEALTH_URL} from this device/browser. If it does not open, set EXPO_PUBLIC_API_BASE_URL to your computer LAN IP, for example http://192.168.1.10:5000/api, and restart Expo.`;
