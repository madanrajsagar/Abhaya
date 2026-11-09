import AsyncStorage from '@react-native-async-storage/async-storage';

const REPORTS_KEY = '@abhaya_incident_reports_v1';

const safeJsonParse = (raw, fallback) => {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

export const saveIncidentReport = async (report) => {
  if (!report?.incidentId) {
    return { success: false, error: 'Missing incidentId.' };
  }

  try {
    const raw = await AsyncStorage.getItem(REPORTS_KEY);
    const parsed = raw ? safeJsonParse(raw, []) : [];
    const existing = Array.isArray(parsed) ? parsed : [];
    const filtered = existing.filter((item) => item?.incidentId !== report.incidentId);
    const next = [report, ...filtered].slice(0, 25);
    await AsyncStorage.setItem(REPORTS_KEY, JSON.stringify(next));
    return { success: true, data: report };
  } catch (e) {
    return { success: false, error: e?.message || 'Failed to save report.' };
  }
};

export const getIncidentReportById = async (incidentId) => {
  if (!incidentId) return { success: false, error: 'Missing incidentId.' };

  try {
    const raw = await AsyncStorage.getItem(REPORTS_KEY);
    const existing = raw ? safeJsonParse(raw, []) : [];
    const list = Array.isArray(existing) ? existing : [];
    const report = list.find((item) => item?.incidentId === incidentId) || null;
    return { success: true, data: report };
  } catch (e) {
    return { success: false, error: e?.message || 'Failed to load report.' };
  }
};

export const getLatestIncidentReport = async () => {
  try {
    const raw = await AsyncStorage.getItem(REPORTS_KEY);
    const existing = raw ? safeJsonParse(raw, []) : [];
    const list = Array.isArray(existing) ? existing : [];
    return { success: true, data: list[0] || null };
  } catch (e) {
    return { success: false, error: e?.message || 'Failed to load reports.' };
  }
};

export const listIncidentReports = async () => {
  try {
    const raw = await AsyncStorage.getItem(REPORTS_KEY);
    const existing = raw ? safeJsonParse(raw, []) : [];
    const list = Array.isArray(existing) ? existing : [];
    return { success: true, data: list };
  } catch (e) {
    return { success: false, error: e?.message || 'Failed to load reports.' };
  }
};
