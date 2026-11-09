import AsyncStorage from '@react-native-async-storage/async-storage';
import { BASE_URL, backendUnavailableMessage } from './backendConfig';

const TOKEN_KEY = '@safeguard_token';
const REFRESH_KEY = '@safeguard_refresh';

const refreshToken = async () => {
  const storedRefresh = await AsyncStorage.getItem(REFRESH_KEY);
  if (!storedRefresh) {
    return false;
  }

  let response;

  try {
    response = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refreshToken: storedRefresh }),
    });
  } catch (error) {
    const networkError = new Error(backendUnavailableMessage);
    networkError.cause = error;
    throw networkError;
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.success === false || !payload.data?.idToken) {
    return false;
  }

  await AsyncStorage.setItem(TOKEN_KEY, payload.data.idToken);

  if (payload.data.refreshToken) {
    await AsyncStorage.setItem(REFRESH_KEY, payload.data.refreshToken);
  }

  return true;
};

const request = async (endpoint, options = {}) => {
  let response;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    response = await fetch(`${BASE_URL}${endpoint}`, {
      ...options,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch (error) {
    const networkError = new Error(backendUnavailableMessage);
    networkError.cause = error;
    throw networkError;
  }

  let payload = await response.json().catch(() => ({}));

  if (response.status === 401 && String(payload.error || '').includes('expired')) {
    const refreshed = await refreshToken();

    if (refreshed) {
      const newToken = await AsyncStorage.getItem(TOKEN_KEY);
      if (newToken) {
        headers.Authorization = `Bearer ${newToken}`;
      }

      try {
        response = await fetch(`${BASE_URL}${endpoint}`, {
          ...options,
          headers,
          body: options.body ? JSON.stringify(options.body) : undefined,
        });
      } catch (error) {
        const networkError = new Error(backendUnavailableMessage);
        networkError.cause = error;
        throw networkError;
      }

      payload = await response.json().catch(() => ({}));
    }
  }

  if (!response.ok || payload.success === false) {
    const error = new Error(
      payload.error || payload.message || 'Vehicle observation request failed.'
    );
    error.status = response.status;
    throw error;
  }

  return payload.data;
};

const vehicleObservationAPI = {
  list: async ({ limit } = {}) => {
    const params = new URLSearchParams();
    if (Number.isFinite(limit)) {
      params.set('limit', String(limit));
    }

    const query = params.toString();

    return request(`/vehicle-observations${query ? `?${query}` : ''}`, {
      method: 'GET',
    });
  },

  create: async (payload) =>
    request('/vehicle-observations', {
      method: 'POST',
      body: payload,
    }),
};

export default vehicleObservationAPI;
