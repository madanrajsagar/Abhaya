import AsyncStorage from '@react-native-async-storage/async-storage';
import authAPI from './api';

const SECURITY_PASSWORD_MAP_KEY = '@abhaya_security_password_map_v2';

export const DEFAULT_SECURITY_PASSWORD = '12345678';

export const SECURITY_PASSWORD_DESCRIPTION =
  'This extra in-app safety password is required at login and before submitting a route deviation reason. You can update it anytime from Settings.';

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

const readPasswordMap = async () => {
  try {
    const raw = await AsyncStorage.getItem(SECURITY_PASSWORD_MAP_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const writePasswordMap = async (nextMap) => {
  await AsyncStorage.setItem(SECURITY_PASSWORD_MAP_KEY, JSON.stringify(nextMap));
};

const resolveEmail = async (email) => {
  const normalized = normalizeEmail(email);
  if (normalized) {
    return normalized;
  }

  const storedUser = await authAPI.getStoredUser();
  return normalizeEmail(storedUser?.email);
};

export const cacheSecurityPassword = async ({ email, safetyPassword }) => {
  const normalizedEmail = await resolveEmail(email);
  const normalizedPassword = String(safetyPassword || '').trim();

  if (!normalizedEmail || !normalizedPassword) {
    return;
  }

  const existing = await readPasswordMap();
  existing[normalizedEmail] = normalizedPassword;
  await writePasswordMap(existing);
};

export const getSecurityPassword = async (email) => {
  const normalizedEmail = await resolveEmail(email);
  const existing = await readPasswordMap();
  return existing[normalizedEmail] || DEFAULT_SECURITY_PASSWORD;
};

export const verifySecurityPassword = async ({ email, input }) => {
  const normalizedEmail = await resolveEmail(email);
  const normalizedInput = String(input || '').trim();

  if (!normalizedInput) {
    return false;
  }

  if (normalizedEmail) {
    const remoteResult = await authAPI.verifySafetyPassword(normalizedEmail, normalizedInput);
    if (remoteResult?.success) {
      if (remoteResult.data?.valid) {
        await cacheSecurityPassword({
          email: normalizedEmail,
          safetyPassword: normalizedInput,
        });
      }
      return Boolean(remoteResult.data?.valid);
    }
  }

  const expected = await getSecurityPassword(normalizedEmail);
  return normalizedInput === expected;
};

export const updateSecurityPassword = async ({ email, nextPassword }) => {
  const normalizedPassword = String(nextPassword || '').trim();

  if (normalizedPassword.length < 8) {
    return {
      success: false,
      error: 'Safety password must be at least 8 characters long.',
    };
  }

  const result = await authAPI.updateProfile({
    safetyPassword: normalizedPassword,
  });

  if (!result?.success) {
    return result;
  }

  await cacheSecurityPassword({ email, safetyPassword: normalizedPassword });
  return { success: true, data: normalizedPassword };
};
