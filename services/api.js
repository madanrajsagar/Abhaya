import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking, Share } from 'react-native';
import { BASE_URL, BASE_URL_CANDIDATES, backendUnavailableMessage } from './backendConfig';

const TOKEN_KEY = '@safeguard_token';
const REFRESH_KEY = '@safeguard_refresh';
const USER_KEY = '@safeguard_user';
const isBackendUnavailableError = (message) =>
  typeof message === 'string' &&
  (message.includes('Cannot reach the backend') || message.includes('Network error'));

let resolvedBaseUrl = BASE_URL;

const fetchJson = async (baseUrl, endpoint, options, headers) => {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await response.json();
  return { response, data };
};

const apiRequest = async (endpoint, options = {}) => {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (options.authenticated !== false) {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  try {
    let response;
    let data;
    let activeBaseUrl = resolvedBaseUrl;

    try {
      ({ response, data } = await fetchJson(activeBaseUrl, endpoint, options, headers));
    } catch (primaryError) {
      let recovered = false;

      for (const candidate of BASE_URL_CANDIDATES) {
        if (candidate === activeBaseUrl) {
          continue;
        }

        try {
          ({ response, data } = await fetchJson(candidate, endpoint, options, headers));
          activeBaseUrl = candidate;
          resolvedBaseUrl = candidate;
          recovered = true;
          break;
        } catch {
          // Try the next candidate.
        }
      }

      if (!recovered) {
        throw primaryError;
      }
    }

    if (response.status === 401 && data.error?.includes('expired')) {
      const refreshed = await refreshToken();
      if (refreshed) {
        const newToken = await AsyncStorage.getItem(TOKEN_KEY);
        headers.Authorization = `Bearer ${newToken}`;
        const retryResult = await fetchJson(activeBaseUrl, endpoint, options, headers);
        response = retryResult.response;
        data = retryResult.data;
      }
    }

    return data;
  } catch (error) {
    console.error(`API Error [${endpoint}] (${resolvedBaseUrl}${endpoint}):`, error.message);
    return {
      success: false,
      error: backendUnavailableMessage,
    };
  }
};

const storeAuthData = async (data) => {
  await AsyncStorage.multiSet([
    [TOKEN_KEY, data.idToken],
    [REFRESH_KEY, data.refreshToken],
    [
      USER_KEY,
      JSON.stringify({
        uid: data.uid,
        email: data.email,
        displayName: data.displayName,
        photoURL: data.photoURL || '',
        hasSafetyPassword: data.hasSafetyPassword,
      }),
    ],
  ]);
};

const clearAuthData = async () => {
  await AsyncStorage.multiRemove([TOKEN_KEY, REFRESH_KEY, USER_KEY]);
};

const getStoredUser = async () => {
  try {
    const userJson = await AsyncStorage.getItem(USER_KEY);
    return userJson ? JSON.parse(userJson) : null;
  } catch {
    return null;
  }
};

const persistUserProfile = async (nextUser) => {
  if (!nextUser || typeof nextUser !== 'object') {
    return;
  }

  const existing = await getStoredUser();
  const mergedUser = {
    ...(existing && typeof existing === 'object' ? existing : {}),
    ...nextUser,
  };

  await AsyncStorage.setItem(USER_KEY, JSON.stringify(mergedUser));
};

const refreshToken = async () => {
  try {
    const storedRefresh = await AsyncStorage.getItem(REFRESH_KEY);
    if (!storedRefresh) return false;

    const result = await apiRequest('/auth/refresh', {
      method: 'POST',
      body: { refreshToken: storedRefresh },
      authenticated: false,
    });

    if (result.success) {
      await AsyncStorage.setItem(TOKEN_KEY, result.data.idToken);
      await AsyncStorage.setItem(REFRESH_KEY, result.data.refreshToken);
      return true;
    }
    return false;
  } catch {
    return false;
  }
};

const authAPI = {
  signup: async (email, password, displayName, safetyPassword) => {
    const result = await apiRequest('/auth/signup', {
      method: 'POST',
      body: { email, password, displayName, safetyPassword },
      authenticated: false,
    });

    if (result.success) {
      await storeAuthData(result.data);
    }
    return result;
  },

  login: async (email, password) => {
    const result = await apiRequest('/auth/login', {
      method: 'POST',
      body: { email, password },
      authenticated: false,
    });

    if (result.success) {
      await storeAuthData(result.data);
    }
    return result;
  },

  verifySafetyPassword: async (email, safetyPassword) =>
    apiRequest('/auth/verify-safety-password', {
      method: 'POST',
      body: { email, safetyPassword },
      authenticated: false,
    }),

  logout: async () => {
    await clearAuthData();
    return { success: true };
  },

  getProfile: async () => {
    const result = await apiRequest('/auth/profile', { method: 'GET' });
    if (result?.success && result.data) {
      await persistUserProfile(result.data);
    }
    return result;
  },

  updateProfile: async (data) => {
    const result = await apiRequest('/auth/profile', {
      method: 'PUT',
      body: data,
    });

    if (result?.success && result.data) {
      await persistUserProfile(result.data);
    }

    return result;
  },

  deleteAccount: async () => {
    const result = await apiRequest('/auth/account', { method: 'DELETE' });
    if (result.success) await clearAuthData();
    return result;
  },

  getStoredUser,

  validateSession: async () => {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (!token) return { valid: false };

    const storedUser = await getStoredUser();
    const result = await apiRequest('/auth/profile', { method: 'GET' });
    if (result.success) {
      return { valid: true, user: result.data };
    }

    if (isBackendUnavailableError(result.error) && storedUser) {
      return {
        valid: true,
        user: storedUser,
        offline: true,
      };
    }

    const refreshed = await refreshToken();
    if (refreshed) {
      const retryResult = await apiRequest('/auth/profile', { method: 'GET' });
      if (retryResult.success) {
        return { valid: true, user: retryResult.data };
      }

      if (isBackendUnavailableError(retryResult.error) && storedUser) {
        return {
          valid: true,
          user: storedUser,
          offline: true,
        };
      }
    }

    await clearAuthData();
    return { valid: false };
  },
};

const getCloudinaryUploadConfig = () => {
  const uploadUrl =
    process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_URL || process.env.CLOUDINARY_UPLOAD_URL;
  const uploadPreset =
    process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET || process.env.CLOUDINARY_UPLOAD_PRESET;

  return {
    uploadUrl: uploadUrl ? String(uploadUrl).trim() : '',
    uploadPreset: uploadPreset ? String(uploadPreset).trim() : '',
  };
};

export const incidentAPI = {
  createMockIncident: async (payload = {}) =>
    apiRequest('/incidents/mock', {
      method: 'POST',
      body: payload,
    }),

  sendEmergencyEmail: async (report, recipients, deliveryPreferences) =>
    apiRequest('/send-email', {
      method: 'POST',
      body: { report, recipients, deliveryPreferences },
      authenticated: false,
    }),

  getLatestIncident: async () => apiRequest('/incidents/latest', { method: 'GET' }),

  getIncident: async (incidentId) =>
    apiRequest(`/incidents/${incidentId}`, { method: 'GET' }),

  listVideos: async (incidentId) =>
    apiRequest(`/incidents/${incidentId}/videos`, { method: 'GET' }),

  addVideo: async (incidentId, { url, label }) =>
    apiRequest(`/incidents/${incidentId}/videos`, {
      method: 'POST',
      body: { url, label },
    }),

  uploadVideoToCloudinary: async (videoUri) => {
    const { uploadUrl, uploadPreset } = getCloudinaryUploadConfig();
    if (!uploadUrl) {
      return {
        success: false,
        error:
          'Cloudinary is not configured. Set EXPO_PUBLIC_CLOUDINARY_UPLOAD_URL and optionally EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET.',
      };
    }

    try {
      if (__DEV__) {
        console.log('[cloudinary] uploadUrl =', uploadUrl);
        console.log('[cloudinary] uploadPreset =', uploadPreset || '(missing)');
      }

      const form = new FormData();
      form.append('file', {
        uri: videoUri,
        type: 'video/mp4',
        name: `evidence-${Date.now()}.mp4`,
      });
      if (uploadPreset) {
        form.append('upload_preset', uploadPreset);
      }

      const response = await fetch(uploadUrl, {
        method: 'POST',
        body: form,
        headers: {
          Accept: 'application/json',
        },
      });

      const data = await response.json();
      if (!response.ok) {
        const cloudMessage = data?.error?.message || 'Cloudinary upload failed.';
        if (String(cloudMessage).toLowerCase().includes('upload preset not found')) {
          return {
            success: false,
            error:
              'Cloudinary upload preset not found. Create an unsigned upload preset and update EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET.',
          };
        }
        return {
          success: false,
          error: cloudMessage,
        };
      }

      return {
        success: true,
        data: {
          url: data?.secure_url || data?.url || '',
          uploadedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error?.message || 'Cloudinary upload failed.',
      };
    }
  },
};

export const videoAPI = {
  saveVideo: async ({ videoUrl, incidentId }) =>
    apiRequest('/save-video', {
      method: 'POST',
      body: { videoUrl, incidentId },
    }),

  listUserVideos: async (userId) =>
    apiRequest(`/user-videos/${encodeURIComponent(String(userId || '').trim())}`, {
      method: 'GET',
    }),

  deleteVideo: async (id) =>
    apiRequest(`/video/${encodeURIComponent(String(id || '').trim())}`, {
      method: 'DELETE',
    }),

  openDownload: async (url) => {
    const videoUrl = String(url || '').trim();
    if (!videoUrl) {
      return { success: false, error: 'Video URL is missing.' };
    }

    try {
      const supported = await Linking.canOpenURL(videoUrl);
      if (supported) {
        await Linking.openURL(videoUrl);
        return { success: true };
      }

      await Share.share({
        message: videoUrl,
        title: 'Video Evidence',
        url: videoUrl,
      });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error?.message || 'Could not open the video download link.',
      };
    }
  },
};

export default authAPI;
