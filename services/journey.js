import { BASE_URL, backendUnavailableMessage } from './backendConfig';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

  if (options.authenticated) {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
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
    const error = new Error(payload.error || payload.message || 'Journey request failed.');
    error.status = response.status;
    throw error;
  }

  return payload.data;
};

const uploadMultipart = async (endpoint, { body, authenticated = false } = {}) => {
  const headers = {
    Accept: 'application/json',
  };

  if (authenticated) {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  let response;

  try {
    response = await fetch(`${BASE_URL}${endpoint}`, {
      method: 'POST',
      headers,
      body,
    });
  } catch (error) {
    const networkError = new Error(backendUnavailableMessage);
    networkError.cause = error;
    throw networkError;
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.success === false) {
    const error = new Error(payload.error || payload.message || 'Upload request failed.');
    error.status = response.status;
    throw error;
  }

  return payload.data;
};

const journeyAPI = {
  geocodeDestination: async (query) =>
    request(`/journey/geocode?query=${encodeURIComponent(query)}`, {
      method: 'GET',
    }),

  fetchRoute: async ({
    originLat,
    originLng,
    destLat,
    destLng,
    mode = 'vehicle',
    includeAlternatives = true,
  }) => {
    const url = new URL(`${BASE_URL}/journey/route`);
    url.searchParams.set('origin_lat', originLat);
    url.searchParams.set('origin_lng', originLng);
    url.searchParams.set('dest_lat', destLat);
    url.searchParams.set('dest_lng', destLng);
    url.searchParams.set('mode', mode);
    url.searchParams.set('include_alternatives', includeAlternatives ? 'true' : 'false');

    let response;

    try {
      response = await fetch(url.toString());
    } catch (error) {
      const networkError = new Error(backendUnavailableMessage);
      networkError.cause = error;
      throw networkError;
    }
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || payload.success === false) {
      const error = new Error(payload.error || 'Failed to plan route.');
      error.status = response.status;
      throw error;
    }

    return payload.data;
  },

  checkDeviation: async ({ userLat, userLng, route }) =>
    request('/journey/check-deviation', {
      method: 'POST',
      body: {
        user_lat: userLat,
        user_lng: userLng,
        route,
      },
    }),

  triggerSOS: async ({ userLat, userLng, reason }) =>
    request('/journey/sos', {
      method: 'POST',
      body: {
        user_lat: userLat,
        user_lng: userLng,
        reason,
      },
    }),

  transcribeAudio: async ({ uri, name = `audio-segment-${Date.now()}.m4a`, type = 'audio/mp4' }) => {
    const form = new FormData();
    form.append('audio', {
      uri,
      name,
      type,
    });

    return uploadMultipart('/audio/transcribe', {
      body: form,
    });
  },

  listHistory: async ({ limit, eventLimit } = {}) => {
    const params = new URLSearchParams();
    if (Number.isFinite(limit)) {
      params.set('limit', String(limit));
    }
    if (eventLimit === 'all') {
      params.set('eventLimit', 'all');
    } else if (Number.isFinite(eventLimit)) {
      params.set('eventLimit', String(eventLimit));
    }

    const query = params.toString();

    return request(`/history${query ? `?${query}` : ''}`, {
      method: 'GET',
      authenticated: true,
    });
  },

  createHistory: async ({ summary, event, message, status = 'active' }) =>
    request('/history', {
      method: 'POST',
      authenticated: true,
      body: {
        summary,
        event,
        message,
        status,
      },
    }),

  addHistoryEvent: async ({ historyId, type, message, location, metadata }) =>
    request(`/history/${historyId}/events`, {
      method: 'POST',
      authenticated: true,
      body: {
        type,
        message,
        location,
        metadata,
      },
    }),

  updateHistory: async ({ historyId, status, message, eventType }) =>
    request(`/history/${historyId}`, {
      method: 'PATCH',
      authenticated: true,
      body: {
        status,
        message,
        eventType,
      },
    }),
};

export default journeyAPI;
