import AsyncStorage from '@react-native-async-storage/async-storage';
import journeyAPI from './journey';
import vehicleObservationAPI from './vehicleObservations';

const EVENT_CONFIG = {
  journey_started: {
    title: 'Journey started',
    icon: 'navigate-circle-outline',
    tint: '#0f9d7a',
    background: '#e9fbf4',
  },
  journey_completed: {
    title: 'Journey completed',
    icon: 'checkmark-done-circle-outline',
    tint: '#0f9d7a',
    background: '#e9fbf4',
  },
  journey_ended: {
    title: 'Journey ended',
    icon: 'pause-circle-outline',
    tint: '#6b7280',
    background: '#f3f4f6',
  },
  crime_zone_alert: {
    title: 'Danger area entered',
    icon: 'warning-outline',
    tint: '#dc2626',
    background: '#fff1f1',
  },
  deviation_detected: {
    title: 'Route deviation detected',
    icon: 'git-compare-outline',
    tint: '#ea580c',
    background: '#fff7ed',
  },
  deviation_safety_prompt: {
    title: 'Safety alert shown',
    icon: 'shield-outline',
    tint: '#ea580c',
    background: '#fff7ed',
  },
  stationary_detected: {
    title: 'Stationary alert',
    icon: 'timer-outline',
    tint: '#ea580c',
    background: '#fff7ed',
  },
  stationary_safety_prompt: {
    title: 'No movement safety alert',
    icon: 'shield-outline',
    tint: '#ea580c',
    background: '#fff7ed',
  },
  route_selected: {
    title: 'Route selected',
    icon: 'map-outline',
    tint: '#2563eb',
    background: '#ebf3ff',
  },
  route_switched: {
    title: 'Route switched',
    icon: 'swap-horizontal-outline',
    tint: '#2563eb',
    background: '#ebf3ff',
  },
  safe_deviation_reason: {
    title: 'Safety response saved',
    icon: 'shield-checkmark-outline',
    tint: '#7b57d1',
    background: '#f3edff',
  },
  safety_confirmed: {
    title: 'Safety confirmed',
    icon: 'shield-checkmark-outline',
    tint: '#0f9d7a',
    background: '#e9fbf4',
  },
  sos_sent: {
    title: 'SOS sent',
    icon: 'alert-circle-outline',
    tint: '#dc2626',
    background: '#fff1f1',
  },
  walking_started: {
    title: 'Walking tracker started',
    icon: 'walk-outline',
    tint: '#6e44cf',
    background: '#f3edff',
  },
  walking_location_logged: {
    title: 'Walking location saved',
    icon: 'location-outline',
    tint: '#2563eb',
    background: '#ebf3ff',
  },
  walking_completed: {
    title: 'Walk completed',
    icon: 'checkmark-done-circle-outline',
    tint: '#0f9d7a',
    background: '#e9fbf4',
  },
  walking_ended: {
    title: 'Walk ended',
    icon: 'pause-circle-outline',
    tint: '#6b7280',
    background: '#f3f4f6',
  },
  vehicle_scan_saved: {
    title: 'Vehicle no plate scanned',
    icon: 'car-sport-outline',
    tint: '#7b57d1',
    background: '#f3edff',
  },
};

const formatEventNotification = (event, historyItem) => {
  const config = EVENT_CONFIG[event.type] || {
    title: 'Journey update',
    icon: 'notifications-outline',
    tint: '#7b57d1',
    background: '#f3edff',
  };

  return {
    id: `${historyItem.id}-${event.type}-${event.createdAt || historyItem.updatedAt}`,
    source: 'journey',
    type: event.type,
    title: config.title,
    message: event.message || 'Journey status updated.',
    createdAt:
      event.createdAt || historyItem.updatedAt || historyItem.createdAt || new Date().toISOString(),
    icon: config.icon,
    tint: config.tint,
    background: config.background,
  };
};

const unavailableVehicleValuePattern = /^(unknown\b.*|not available|plate not readable|plate not detected|-|n\/a)$/i;
const isDisplayableVehicleValue = (value) => {
  const text = String(value || '').trim();
  return Boolean(text) && !unavailableVehicleValuePattern.test(text);
};

const getDisplayableVehicleValue = (value) =>
  isDisplayableVehicleValue(value) ? String(value).trim() : '';

const formatVehicleNotification = (item) => {
  const details = item.vehicleDetails || {};
  const vehicleSummary = [
    getDisplayableVehicleValue(item.vehicleType || details.vehicleType),
    getDisplayableVehicleValue(item.vehicleBrand || details.vehicleBrand),
    getDisplayableVehicleValue(item.vehicleModel || details.vehicleModel),
    getDisplayableVehicleValue(item.vehicleColor || details.vehicleColor),
  ].filter(Boolean);

  return {
    id: `vehicle-${item.id}`,
    source: 'vehicle',
    type: 'vehicle_scan_saved',
    title: 'Vehicle number plate scanned',
    message: [
      getDisplayableVehicleValue(item.plateNumber || details.plateNumber),
      vehicleSummary.join(' | '),
      getDisplayableVehicleValue(item.identificationMark || details.identificationMark),
    ].filter(Boolean).join(' | ') || 'Vehicle scan saved',
    createdAt: item.createdAt || item.updatedAt || new Date().toISOString(),
    icon: 'car-sport-outline',
    tint: '#7b57d1',
    background: '#f3edff',
  };
};

const CACHE_KEY = '@abhaya_notifications_cache_v1';
let memoryCache = null;

const readCache = async () => {
  if (memoryCache) return memoryCache;
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    memoryCache = raw ? JSON.parse(raw) : null;
  } catch {
    memoryCache = null;
  }
  return memoryCache;
};

const writeCache = async (items) => {
  memoryCache = items;
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(items));
  } catch {}
};

const notificationsAPI = {
  // Instant (no network) copy of the last loaded notifications.
  getCached: async () => (await readCache()) || [],

  // size = how many rows the caller needs; smaller means a faster request.
  list: async ({ size = 24 } = {}) => {
    const perSource = Math.min(Math.max(Number(size) || 24, 3), 8);
    const [history, vehicleScans] = await Promise.all([
      journeyAPI.listHistory({ limit: perSource, eventLimit: 4 }).catch(() => null),
      vehicleObservationAPI.list({ limit: perSource }).catch(() => null),
    ]);

    // If both requests failed, keep showing the cached data instead of an empty list.
    if (history === null && vehicleScans === null) {
      return (await readCache()) || [];
    }

    const journeyNotifications = (Array.isArray(history) ? history : []).flatMap((item) =>
      (Array.isArray(item.events) ? item.events : []).map((event) =>
        formatEventNotification(event, item)
      )
    );

    const vehicleNotifications = (Array.isArray(vehicleScans) ? vehicleScans : []).map(
      formatVehicleNotification
    );

    const result = [...vehicleNotifications, ...journeyNotifications]
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .slice(0, 24);

    writeCache(result);
    return result;
  },
};

export default notificationsAPI;
