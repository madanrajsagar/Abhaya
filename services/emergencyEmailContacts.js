import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@abhaya_emergency_email_contacts_v2';
const LEGACY_STORAGE_KEY = '@abhaya_emergency_email_contacts_v1';

const createId = () =>
  `email_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const normalizeLabel = (value) => String(value || '').trim();

const titleize = (value) =>
  String(value || '')
    .replace(/[_\-\.]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();

const buildDefaultLabel = (email, index = 0) => {
  const localPart = normalizeEmail(email).split('@')[0] || '';
  const titled = titleize(localPart);
  return titled ? `${titled} Email` : `Emergency Email ${index + 1}`;
};

export const DEFAULT_EMAIL_CONTACTS = [
  { id: 'default_email_1', label: 'Harshad Email', email: 'khataleharshad26@gmail.com' },
  { id: 'default_email_2', label: 'Madan Email', email: 'madanrajsagar83@gmail.com' },
  { id: 'default_email_3', label: 'Shambhu Email', email: 'gaikwadshambhu24@gmail.com' },
  { id: 'default_email_4', label: 'Amey Email', email: 'ameymohite2006@gmail.com' },
];

export const isValidEmergencyEmail = (value) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));

const normalizeContact = (value, index = 0) => {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    const email = normalizeEmail(value);
    if (!isValidEmergencyEmail(email)) {
      return null;
    }

    return {
      id: createId(),
      label: buildDefaultLabel(email, index),
      email,
    };
  }

  const email = normalizeEmail(value.email);
  if (!isValidEmergencyEmail(email)) {
    return null;
  }

  return {
    id: String(value.id || createId()),
    label: normalizeLabel(value.label) || buildDefaultLabel(email, index),
    email,
  };
};

const dedupeContacts = (values = []) => {
  const next = [];
  const seen = new Set();

  values.forEach((value, index) => {
    const normalized = normalizeContact(value, index);
    if (!normalized || seen.has(normalized.email)) {
      return;
    }

    seen.add(normalized.email);
    next.push(normalized);
  });

  return next;
};

const loadLegacyContacts = async () => {
  try {
    const raw = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return null;
    }

    return dedupeContacts(parsed);
  } catch {
    return null;
  }
};

export const getEmergencyEmailContacts = async () => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return dedupeContacts(parsed);
      }
    }

    const legacyContacts = await loadLegacyContacts();
    if (legacyContacts) {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(legacyContacts));
      return legacyContacts;
    }

    return [...DEFAULT_EMAIL_CONTACTS];
  } catch {
    return [...DEFAULT_EMAIL_CONTACTS];
  }
};

export const saveEmergencyEmailContacts = async (contacts = []) => {
  const normalized = dedupeContacts(contacts);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
};

export const addEmergencyEmailContact = async ({ email, label }) => {
  const normalizedEmail = normalizeEmail(email);
  const normalizedLabel = normalizeLabel(label);

  if (!isValidEmergencyEmail(normalizedEmail)) {
    throw new Error('Enter a valid email address.');
  }

  if (!normalizedLabel) {
    throw new Error('Enter a label like Mom Email or Police Email.');
  }

  const current = await getEmergencyEmailContacts();
  if (current.some((item) => item.email === normalizedEmail)) {
    throw new Error('This email is already in the emergency list.');
  }

  return saveEmergencyEmailContacts([
    ...current,
    {
      id: createId(),
      label: normalizedLabel,
      email: normalizedEmail,
    },
  ]);
};

export const updateEmergencyEmailContact = async ({ id, label, email }) => {
  const normalizedEmail = normalizeEmail(email);
  const normalizedLabel = normalizeLabel(label);

  if (!id) {
    throw new Error('Email contact id is required.');
  }

  if (!isValidEmergencyEmail(normalizedEmail)) {
    throw new Error('Enter a valid email address.');
  }

  if (!normalizedLabel) {
    throw new Error('Enter a label like Mom Email or Police Email.');
  }

  const current = await getEmergencyEmailContacts();
  const duplicate = current.find((item) => item.email === normalizedEmail && item.id !== id);
  if (duplicate) {
    throw new Error('Another emergency email already uses this address.');
  }

  const next = current.map((item) =>
    item.id === id
      ? {
          ...item,
          label: normalizedLabel,
          email: normalizedEmail,
        }
      : item
  );

  return saveEmergencyEmailContacts(next);
};

export const removeEmergencyEmailContact = async (id) => {
  const current = await getEmergencyEmailContacts();
  const next = current.filter((item) => item.id !== id);
  return saveEmergencyEmailContacts(next);
};

export const getEmergencyEmailAddresses = async () => {
  const contacts = await getEmergencyEmailContacts();
  return contacts.map((item) => item.email);
};
