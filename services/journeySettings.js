import AsyncStorage from '@react-native-async-storage/async-storage';

const JOURNEY_SETTINGS_KEY = '@abhaya_journey_settings';

// Default journey settings
export const DEFAULT_JOURNEY_SETTINGS = {
  idleThreshold: 5, // in minutes
  autoSOSSensitivity: 'medium', // 'low', 'medium', 'high'
  audioMonitoring: true, // enabled/disabled
  emergencyAlertDelay: 10, // in seconds
  locationTrackingInterval: 5, // in seconds
  crimeZoneAlertRadius: 500, // in meters
  smsAlertsEnabled: true, // enabled/disabled
  callAlertsEnabled: true, // enabled/disabled
};

// Idle threshold options in minutes
export const IDLE_THRESHOLD_OPTIONS = [
  { label: '3 minutes', value: 3 },
  { label: '5 minutes', value: 5 },
  { label: '10 minutes', value: 10 },
  { label: '15 minutes', value: 15 },
  { label: '20 minutes', value: 20 },
];

// Auto SOS sensitivity options
export const AUTO_SOS_SENSITIVITY_OPTIONS = [
  { label: 'Low', value: 'low', description: 'Only alert in extreme danger' },
  { label: 'Medium', value: 'medium', description: 'Balanced safety and usability' },
  { label: 'High', value: 'high', description: 'Alert for any suspicious activity' },
];

// Emergency alert delay options in seconds
export const EMERGENCY_ALERT_DELAY_OPTIONS = [
  { label: '5 seconds', value: 5 },
  { label: '10 seconds', value: 10 },
  { label: '15 seconds', value: 15 },
  { label: '20 seconds', value: 20 },
];

// Location tracking interval options in seconds
export const LOCATION_TRACKING_INTERVAL_OPTIONS = [
  { label: '3 seconds', value: 3 },
  { label: '5 seconds', value: 5 },
  { label: '10 seconds', value: 10 },
];

// Crime zone alert radius options in meters
export const CRIME_ZONE_ALERT_RADIUS_OPTIONS = [
  { label: '300 meters', value: 300 },
  { label: '500 meters', value: 500 },
  { label: '1000 meters', value: 1000 },
];

// Get all journey settings
export const getJourneySettings = async () => {
  try {
    const stored = await AsyncStorage.getItem(JOURNEY_SETTINGS_KEY);
    if (stored) {
      return {
        ...DEFAULT_JOURNEY_SETTINGS,
        ...JSON.parse(stored),
      };
    }
    return DEFAULT_JOURNEY_SETTINGS;
  } catch (error) {
    console.error('Error loading journey settings:', error);
    return DEFAULT_JOURNEY_SETTINGS;
  }
};

// Update specific journey setting
export const updateJourneySettings = async (settingKey, value) => {
  try {
    const current = await getJourneySettings();
    const updated = {
      ...current,
      [settingKey]: value,
    };
    await AsyncStorage.setItem(JOURNEY_SETTINGS_KEY, JSON.stringify(updated));
    return updated;
  } catch (error) {
    console.error('Error updating journey settings:', error);
    throw error;
  }
};

// Update multiple settings at once
export const updateMultipleJourneySettings = async (settingsObject) => {
  try {
    const current = await getJourneySettings();
    const updated = {
      ...current,
      ...settingsObject,
    };
    await AsyncStorage.setItem(JOURNEY_SETTINGS_KEY, JSON.stringify(updated));
    return updated;
  } catch (error) {
    console.error('Error updating journey settings:', error);
    throw error;
  }
};

// Reset to default settings
export const resetJourneySettings = async () => {
  try {
    await AsyncStorage.setItem(JOURNEY_SETTINGS_KEY, JSON.stringify(DEFAULT_JOURNEY_SETTINGS));
    return DEFAULT_JOURNEY_SETTINGS;
  } catch (error) {
    console.error('Error resetting journey settings:', error);
    throw error;
  }
};

// Get specific setting
export const getJourneySetting = async (settingKey) => {
  try {
    const settings = await getJourneySettings();
    return settings[settingKey];
  } catch (error) {
    console.error('Error getting journey setting:', error);
    return DEFAULT_JOURNEY_SETTINGS[settingKey];
  }
};
