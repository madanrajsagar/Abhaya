import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AccessibilityInfo,
  Alert,
  Dimensions,
  Modal,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import MapView, { Circle, Marker, Polyline } from 'react-native-maps';
import { CameraView } from 'expo-camera';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../context/AuthContext';

import journeyAPI from '../services/journey';
import vehicleObservationAPI from '../services/vehicleObservations';
import AudioAnalysisService from '../services/AudioAnalysisService';
import {
  SECURITY_PASSWORD_DESCRIPTION,
  verifySecurityPassword,
} from '../services/securityPassword';
import crimeZones from '../kolhapur_crime_zones.json';

const { width } = Dimensions.get('window');

const DEFAULT_REGION = {
  latitude: 19.076,
  longitude: 72.8777,
  latitudeDelta: 0.12,
  longitudeDelta: 0.12,
};

const CHECK_INTERVAL_MS = 5000;
const CONSECUTIVE_REQUIRED = 3;
const GPS_SMOOTH_N = 3;
const ARRIVAL_THRESHOLD_METRES = 80;
const STATIONARY_RADIUS_METRES = 50;
const STATIONARY_REMINDER_MS = 5 * 60 * 1000;
const STATIONARY_CHECK_INTERVAL_MS = 10 * 1000;
const WALKING_LOCATION_LOG_INTERVAL_MS = 60 * 1000;
const GPS_MAX_ACCEPTABLE_ACCURACY_METRES = 120;
const ACTIVE_JOURNEY_KEY = '@abhaya_active_journey';
const ZONE_ALERT_COOLDOWN_MS = 45 * 1000;
const SAFE_REASON_SUPPRESSION_MS = 10 * 60 * 1000;
const SAFE_REASON_DISTANCE_ESCALATION_METRES = 500;
const NEARBY_CRIME_ZONE_RADIUS_METRES = 500;
const MAP_CRIME_ZONE_RADIUS_METRES = 100;
const MONITORED_CRIME_RISKS = new Set(['high', 'medium']);
const MIN_MAP_DELTA = 0.003;
const MAX_MAP_DELTA = 0.4;

const CRIME_ZONE_STYLES = {
  high: {
    fillColor: 'rgba(239, 68, 68, 0.18)',
    strokeColor: 'rgba(220, 38, 38, 0.9)',
    cardTint: '#fff1f1',
    textColor: '#b91c1c',
    label: 'High Risk',
  },
  medium: {
    fillColor: 'rgba(249, 115, 22, 0.14)',
    strokeColor: 'rgba(234, 88, 12, 0.78)',
    cardTint: '#fff7ed',
    textColor: '#c2410c',
    label: 'Medium Risk',
  },
  low: {
    fillColor: 'rgba(245, 158, 11, 0.12)',
    strokeColor: 'rgba(217, 119, 6, 0.68)',
    cardTint: '#fffbeb',
    textColor: '#a16207',
    label: 'Low Risk',
  },
};

const parseLatLngInput = (value) => {
  const numeric = Number(String(value).trim());
  return Number.isFinite(numeric) ? numeric : null;
};

const toMapCoordinate = ([latitude, longitude]) => ({ latitude, longitude });
const toRadians = (value) => (value * Math.PI) / 180;

const isValidCoordinate = ({ latitude, longitude }) =>
  Number.isFinite(latitude) &&
  Number.isFinite(longitude) &&
  latitude >= -90 &&
  latitude <= 90 &&
  longitude >= -180 &&
  longitude <= 180 &&
  !(Math.abs(latitude) < 0.000001 && Math.abs(longitude) < 0.000001);

const haversineMetres = (lat1, lng1, lat2, lng2) => {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) ** 2;

  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const fitDelta = (points = []) => {
  if (!points.length) {
    return DEFAULT_REGION;
  }

  const latitudes = points.map((point) => point.latitude);
  const longitudes = points.map((point) => point.longitude);

  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.6, 0.02),
    longitudeDelta: Math.max((maxLng - minLng) * 1.6, 0.02),
  };
};

const getCrimeZoneStyle = (risk = 'low') => CRIME_ZONE_STYLES[risk] || CRIME_ZONE_STYLES.low;

const formatResolvedAddress = (result) => {
  if (!result) {
    return '';
  }

  const primary = [result.name, result.street].filter(Boolean).join(', ');
  const secondary = [
    result.district,
    result.city,
    result.subregion,
    result.region,
    result.postalCode,
    result.country,
  ].filter(Boolean);

  return [primary, secondary.join(', ')].filter(Boolean).join(', ');
};

const formatCrimeTypes = (crimeTypes = []) =>
  Array.isArray(crimeTypes) && crimeTypes.length
    ? crimeTypes.map((value) => String(value || '').replace(/\b\w/g, (letter) => letter.toUpperCase())).join(', ')
    : 'Reported safety incidents';

const formatZoneDistance = (distance) =>
  Number.isFinite(distance)
    ? distance < 1000
      ? `${Math.round(distance)} m away`
      : `${(distance / 1000).toFixed(1)} km away`
    : 'Distance unavailable';

const unavailableVehicleValuePattern = /^(unknown\b.*|not available|plate not readable|plate not detected|-|n\/a)$/i;
const isDisplayableVehicleValue = (value) => {
  const text = String(value || '').trim();
  return Boolean(text) && !unavailableVehicleValuePattern.test(text);
};

const getVehicleFieldValue = (vehicle, key) => {
  const value = vehicle?.[key] || vehicle?.vehicleDetails?.[key];
  return isDisplayableVehicleValue(value) ? String(value).trim() : '';
};

const buildVehicleHistorySummary = (vehicle) => {
  if (!vehicle) {
    return null;
  }

  return {
    vehicleScanId: vehicle.id || null,
    plateNumber: getVehicleFieldValue(vehicle, 'plateNumber') || null,
    vehicleType: getVehicleFieldValue(vehicle, 'vehicleType') || null,
    vehicleBrand: getVehicleFieldValue(vehicle, 'vehicleBrand') || null,
    vehicleModel: getVehicleFieldValue(vehicle, 'vehicleModel') || null,
    vehicleColor: getVehicleFieldValue(vehicle, 'vehicleColor') || null,
  };
};

const SAFE_DEVIATION_REASON_OPTIONS = [
  'Taking a shortcut',
  'Avoiding traffic',
  'Road blocked',
  'Stopping briefly',
];
const SAFE_STATIONARY_REASON_OPTIONS = [
  'Waiting for pickup',
  'Taking a short break',
  'Traffic stopped',
  'Phone network issue',
];

const getSafeReasonModalContent = (promptType) => {
  if (promptType === 'stationary') {
    return {
      title: 'Reason for safety check',
      body: 'Tell us why you have paused or stayed in the same place so we can stop escalation safely.',
      placeholder: 'Why are you safe right now?',
      options: SAFE_STATIONARY_REASON_OPTIONS,
    };
  }

  return {
    title: 'Reason for deviation',
    body: 'Tell us why you moved away from the route. Example: changing shortcut or avoiding traffic.',
    placeholder: 'Reason for deviation',
    options: SAFE_DEVIATION_REASON_OPTIONS,
  };
};

const formatAudioMeterValue = (value) =>
  Number.isFinite(value) ? `${value.toFixed(1)} dB` : '--';

const resolveSosTriggerType = (reason) => {
  const normalizedReason = String(reason || '').toLowerCase();

  if (normalizedReason.includes('scream') || normalizedReason.includes('panic keyword')) {
    return 'Audio Panic SOS';
  }

  if (normalizedReason.includes('stationary')) {
    return 'Stationary Alert SOS';
  }

  return 'Journey SOS';
};

const getUserDisplayName = (user) =>
  String(user?.displayName || user?.name || 'Abhaya User').trim() || 'Abhaya User';

const getUserPhone = (user) =>
  String(user?.phone || user?.phoneNumber || user?.mobile || user?.contact || '').trim();

const buildRuntimeVehicleDetails = (vehicle) => {
  if (!vehicle) {
    return null;
  }

  const vehicleDetails = {
    vehicleScanId: vehicle?.id || null,
    plateNumber: getVehicleFieldValue(vehicle, 'plateNumber') || null,
    vehicleType: getVehicleFieldValue(vehicle, 'vehicleType') || null,
    vehicleBrand: getVehicleFieldValue(vehicle, 'vehicleBrand') || null,
    vehicleModel: getVehicleFieldValue(vehicle, 'vehicleModel') || null,
    vehicleColor: getVehicleFieldValue(vehicle, 'vehicleColor') || null,
    identificationMark: getVehicleFieldValue(vehicle, 'identificationMark') || null,
  };

  const hasVehicleData = Object.values(vehicleDetails).some(Boolean);
  return hasVehicleData ? vehicleDetails : null;
};

const classifySafeDeviationReason = (reason) => {
  const normalized = String(reason || '').trim().toLowerCase();

  if (!normalized) {
    return {
      code: 'safe_unknown_reason',
      notification: 'Deviation marked safe. Monitoring will continue on your updated movement.',
    };
  }

  if (
    normalized.includes('shortcut') ||
    normalized.includes('short cut') ||
    normalized.includes('alternate route') ||
    normalized.includes('changed route')
  ) {
    return {
      code: 'safe_shortcut',
      notification: 'Deviation noted as a route change or shortcut. We will keep monitoring and avoid asking again for a short time.',
    };
  }

  if (
    normalized.includes('traffic') ||
    normalized.includes('jam') ||
    normalized.includes('crowd') ||
    normalized.includes('congestion')
  ) {
    return {
      code: 'safe_traffic',
      notification: 'Deviation noted due to traffic. The app will continue monitoring and will not repeat the same prompt right away.',
    };
  }

  if (
    normalized.includes('road block') ||
    normalized.includes('blocked') ||
    normalized.includes('closed') ||
    normalized.includes('construction') ||
    normalized.includes('diversion')
  ) {
    return {
      code: 'safe_road_issue',
      notification: 'Deviation noted due to a road issue. Monitoring will continue and the same question will be delayed for a while.',
    };
  }

  if (
    normalized.includes('stop') ||
    normalized.includes('wait') ||
    normalized.includes('pickup') ||
    normalized.includes('drop')
  ) {
    return {
      code: 'safe_brief_stop',
      notification: 'Deviation noted as a brief stop. Monitoring will stay active without repeatedly asking the same question.',
    };
  }

  return {
    code: 'safe_custom_reason',
    notification: 'Your reason has been recorded. Monitoring will continue and no SOS will be sent.',
  };
};

export default function JourneyScreen({ navigation, route: screenRoute }) {
  const { user } = useAuth();
  const routedVehicleScan = screenRoute?.params?.linkedVehicleScan || null;
  const requestedMode = screenRoute?.params?.mode || null;
  const mapRef = useRef(null);
  const watchSubscriptionRef = useRef(null);
  const checkIntervalRef = useRef(null);
  const stationaryIntervalRef = useRef(null);
  const smoothingBufferRef = useRef([]);
  const latestPositionRef = useRef(null);
  const latestRouteRef = useRef([]);
  const isCheckingRef = useRef(false);
  const stationaryAnchorRef = useRef(null);
  const stationaryAlertOpenRef = useRef(false);
  const restoredJourneyRef = useRef(false);
  const dismissSafetyPromptRef = useRef(null);
  const sendPromptSOSRef = useRef(null);
  const isTestLocationActiveRef = useRef(false);
  const safetyPromptRef = useRef(null);
  const activeHistoryIdRef = useRef(null);
  const isSosFinalizedRef = useRef(false);
  const isSosInFlightRef = useRef(false);
  const hasTriggeredSosRef = useRef(false);
  const lastAnnouncedZoneRef = useRef({ id: null, at: 0 });
  const lastSafeDeviationRef = useRef({
    classification: null,
    reason: '',
    suppressUntil: 0,
    baselineDistance: null,
  });
  const activeAudioPromptTypeRef = useRef(null);

  const [permissionStatus, setPermissionStatus] = useState('pending');
  const [locationError, setLocationError] = useState('');
  const [currentPosition, setCurrentPosition] = useState(null);
  const [accuracy, setAccuracy] = useState(null);

  const [destinationQuery, setDestinationQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedDestination, setSelectedDestination] = useState(null);
  const [journeyStart, setJourneyStart] = useState(null);
  const [activeHistoryId, setActiveHistoryId] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isPlanningRoute, setIsPlanningRoute] = useState(false);
  const [journeyError, setJourneyError] = useState('');

  const [route, setRoute] = useState([]);
  const [routeOptions, setRouteOptions] = useState([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(null);
  const [alternatives, setAlternatives] = useState([]);
  const [eta, setEta] = useState(null);
  const [distanceKm, setDistanceKm] = useState(null);
  const [isTracking, setIsTracking] = useState(false);
  const [isSosFinalized, setIsSosFinalized] = useState(false);
  const [isCheckingDeviation, setIsCheckingDeviation] = useState(false);
  const [deviationDistance, setDeviationDistance] = useState(null);
  const [deviationThreshold, setDeviationThreshold] = useState(null);
  const [isCurrentlyDeviated, setIsCurrentlyDeviated] = useState(false);
  const [consecutiveDeviationCount, setConsecutiveDeviationCount] = useState(0);
  const [safetyPrompt, setSafetyPrompt] = useState(null);
  const [safeReasonPrompt, setSafeReasonPrompt] = useState(null);
  const [safeReasonText, setSafeReasonText] = useState('');
  const [safeReasonPassword, setSafeReasonPassword] = useState('');
  const [safetyNotification, setSafetyNotification] = useState(null);
  const [vehicleObservations, setVehicleObservations] = useState([]);
  const [latestVehicleScan, setLatestVehicleScan] = useState(null);
  const [isLoadingLatestVehicleScan, setIsLoadingLatestVehicleScan] = useState(false);
  const [vehicleTypeInput, setVehicleTypeInput] = useState('');
  const [vehicleColorInput, setVehicleColorInput] = useState('');
  const [vehicleBrandInput, setVehicleBrandInput] = useState('');
  const [vehicleModelInput, setVehicleModelInput] = useState('');
  const [vehicleNoteInput, setVehicleNoteInput] = useState('');
  const [testLatitude, setTestLatitude] = useState('');
  const [testLongitude, setTestLongitude] = useState('');
  const [isTestLocationActive, setIsTestLocationActive] = useState(false);
  const [activeCrimeZone, setActiveCrimeZone] = useState(null);
  const [nearbyCrimeZones, setNearbyCrimeZones] = useState([]);
  const [mapRegion, setMapRegion] = useState(DEFAULT_REGION);
  const [audioDebugState, setAudioDebugState] = useState({
    isAnalyzing: false,
    latestMetering: null,
    averageMetering: null,
    lastTranscript: '',
    matchedKeywords: [],
    lastEvent: 'idle',
    lastPanicReason: '',
    updatedAt: null,
  });
  const [audioSimulationInput, setAudioSimulationInput] = useState('');
  const lastWalkingLogAtRef = useRef(0);
  const isVehicleScanMode = requestedMode === 'vehicle';
  const linkedVehicleScan = isVehicleScanMode ? routedVehicleScan || latestVehicleScan : null;
  const vehicleHistorySummary = useMemo(
    () => buildVehicleHistorySummary(linkedVehicleScan),
    [linkedVehicleScan]
  );
  const linkedVehicleDisplay = useMemo(() => {
    if (!linkedVehicleScan) {
      return null;
    }

    const plateNumber = getVehicleFieldValue(linkedVehicleScan, 'plateNumber');
    const vehicleType = getVehicleFieldValue(linkedVehicleScan, 'vehicleType');
    const vehicleBrand = getVehicleFieldValue(linkedVehicleScan, 'vehicleBrand');
    const vehicleModel = getVehicleFieldValue(linkedVehicleScan, 'vehicleModel');
    const vehicleColor = getVehicleFieldValue(linkedVehicleScan, 'vehicleColor');
    const identificationMark = getVehicleFieldValue(linkedVehicleScan, 'identificationMark');

    return {
      title: plateNumber || vehicleType || 'Scanned vehicle',
      meta: [vehicleType, vehicleBrand, vehicleModel, vehicleColor].filter(Boolean),
      infoCards: [
        ['Plate Number', plateNumber],
        ['Vehicle Type', vehicleType],
        ['Brand', vehicleBrand],
        ['Model', vehicleModel],
        ['Color', vehicleColor],
        ['Visible Mark', identificationMark],
      ].filter(([, value]) => Boolean(value)),
    };
  }, [linkedVehicleScan]);
  const isWalkingMode = !isVehicleScanMode;
  const journeyMode = isWalkingMode ? 'walking' : 'vehicle';
  const trackerTitle = isWalkingMode ? 'Walking Guardian' : 'Auto/Vehicle Guardian';
  const destinationCardTitle = isWalkingMode ? 'Walking Destination' : 'Vehicle Journey Destination';
  const destinationCardSubtitle = isWalkingMode
    ? 'Enter only the destination and Abhaya will monitor the walk with 1 minute location logs.'
    : vehicleHistorySummary
      ? vehicleHistorySummary.plateNumber
        ? `Vehicle scan is linked (${vehicleHistorySummary.plateNumber}). Enter the destination to track this auto/vehicle journey.`
        : 'Vehicle scan is linked. Enter the destination to track this auto/vehicle journey.'
      : 'Vehicle scan mode is active. Enter the destination to track this auto/vehicle journey.';

  const routeCoordinates = useMemo(
    () => route.map(toMapCoordinate),
    [route]
  );

  const crimeZoneMarkers = useMemo(
    () =>
      crimeZones
        .filter(
          (zone) =>
            MONITORED_CRIME_RISKS.has(zone.risk) &&
            Number.isFinite(zone.latitude) &&
            Number.isFinite(zone.longitude)
        )
        .map((zone) => ({
          ...zone,
          coordinate: {
            latitude: zone.latitude,
            longitude: zone.longitude,
          },
        })),
    []
  );

  const lockedStartCoordinate = useMemo(
    () => (journeyStart ? toMapCoordinate(journeyStart) : routeCoordinates[0]),
    [journeyStart, routeCoordinates]
  );

  const alternativeCoordinates = useMemo(
    () =>
      alternatives.map((alternative) => ({
        ...alternative,
        coordinates: alternative.route.map(toMapCoordinate),
      })),
    [alternatives]
  );
  const safeReasonModalContent = useMemo(
    () => getSafeReasonModalContent(safeReasonPrompt?.type),
    [safeReasonPrompt?.type]
  );
  const isDeviationAudioUiVisible =
    __DEV__ &&
    (safetyPrompt?.type === 'deviation' || safeReasonPrompt?.type === 'deviation');

  useEffect(() => {
    latestPositionRef.current = currentPosition;
  }, [currentPosition]);

  useEffect(() => {
    latestRouteRef.current = route;
  }, [route]);

  useEffect(() => {
    activeHistoryIdRef.current = activeHistoryId;
  }, [activeHistoryId]);

  useEffect(() => {
    isSosFinalizedRef.current = isSosFinalized;
  }, [isSosFinalized]);

  useEffect(() => {
    isTestLocationActiveRef.current = isTestLocationActive;
  }, [isTestLocationActive]);

  useEffect(() => {
    const unsubscribeDebug = AudioAnalysisService.addDebugListener((nextState) => {
      setAudioDebugState(nextState);
    });

    return () => {
      unsubscribeDebug();
      AudioAnalysisService.stopAnalysis().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!currentPosition) {
      setActiveCrimeZone(null);
      setNearbyCrimeZones([]);
      return;
    }

    const nearbyZones = crimeZones
      .filter((zone) => {
        if (
          !Number.isFinite(zone.latitude) ||
          !Number.isFinite(zone.longitude)
        ) {
          return false;
        }

        const distance = haversineMetres(
          currentPosition.latitude,
          currentPosition.longitude,
          zone.latitude,
          zone.longitude
        );

        const effectiveRadius =
          MONITORED_CRIME_RISKS.has(zone.risk) ? NEARBY_CRIME_ZONE_RADIUS_METRES : zone.radius;

        if (!Number.isFinite(effectiveRadius)) {
          return false;
        }

        return MONITORED_CRIME_RISKS.has(zone.risk) && distance <= effectiveRadius;
      })
      .map((zone) => ({
        ...zone,
        distance: haversineMetres(
          currentPosition.latitude,
          currentPosition.longitude,
          zone.latitude,
          zone.longitude
        ),
        effectiveRadius: NEARBY_CRIME_ZONE_RADIUS_METRES,
      }))
      .sort((a, b) => {
        if (a.risk === b.risk) {
          return a.distance - b.distance;
        }

        return a.risk === 'high' ? -1 : 1;
      });

    setNearbyCrimeZones(nearbyZones);
    setActiveCrimeZone(nearbyZones[0] || null);
  }, [currentPosition]);

  const stopEmergencyAudioMonitoring = useCallback(async () => {
    activeAudioPromptTypeRef.current = null;
    await AudioAnalysisService.stopAnalysis().catch(() => {});
  }, []);

  const prewarmEmergencyEvidencePermissions = useCallback(async () => {
    try {
      await Promise.allSettled([
        CameraView.requestCameraPermissionsAsync(),
        CameraView.requestMicrophonePermissionsAsync(),
      ]);
    } catch {
      // Permission pre-warm is best-effort and should never block the journey flow.
    }
  }, []);

  const resetDeviationState = useCallback(() => {
    setDeviationDistance(null);
    setDeviationThreshold(null);
    setIsCurrentlyDeviated(false);
    setConsecutiveDeviationCount(0);
    setSafetyPrompt(null);
    stationaryAlertOpenRef.current = false;
  }, []);

  const stopDeviationChecks = useCallback(() => {
    if (checkIntervalRef.current) {
      clearInterval(checkIntervalRef.current);
      checkIntervalRef.current = null;
    }
  }, []);

  const stopStationaryChecks = useCallback(() => {
    if (stationaryIntervalRef.current) {
      clearInterval(stationaryIntervalRef.current);
      stationaryIntervalRef.current = null;
    }
  }, []);

  const stopTracking = useCallback(() => {
    stopDeviationChecks();
    stopStationaryChecks();
    setIsTracking(false);
    stationaryAnchorRef.current = null;
    resetDeviationState();
  }, [resetDeviationState, stopDeviationChecks, stopStationaryChecks]);

  const clearSavedJourney = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(ACTIVE_JOURNEY_KEY);
    } catch {
      // Local persistence is best-effort; monitoring should keep working without it.
    }
  }, []);

  const resetJourney = useCallback(async ({ skipHistoryUpdate = false } = {}) => {
    const historyId = activeHistoryIdRef.current;

    if (historyId && !skipHistoryUpdate) {
      await journeyAPI.updateHistory({
        historyId,
        status: 'ended',
        message: isWalkingMode ? 'Walk ended by user' : 'Journey ended by user',
        eventType: isWalkingMode ? 'walking_ended' : 'journey_ended',
      }).catch(() => {});
    }

    stopDeviationChecks();
    stopStationaryChecks();
    setDestinationQuery('');
    setSearchResults([]);
    setSelectedDestination(null);
    setJourneyStart(null);
    activeHistoryIdRef.current = null;
    setActiveHistoryId(null);
    setJourneyError('');
    setRoute([]);
    setRouteOptions([]);
    setSelectedRouteIndex(null);
    setAlternatives([]);
    setEta(null);
    setDistanceKm(null);
    setIsTracking(false);
    setIsSosFinalized(false);
    isSosInFlightRef.current = false;
    hasTriggeredSosRef.current = false;
    setVehicleObservations([]);
    setVehicleTypeInput('');
    setVehicleColorInput('');
    setVehicleBrandInput('');
    setVehicleModelInput('');
    setVehicleNoteInput('');
    stationaryAnchorRef.current = null;
    lastWalkingLogAtRef.current = 0;
    activeAudioPromptTypeRef.current = null;
    resetDeviationState();
    await stopEmergencyAudioMonitoring();
    await clearSavedJourney();
  }, [
    clearSavedJourney,
    isWalkingMode,
    resetDeviationState,
    stopDeviationChecks,
    stopEmergencyAudioMonitoring,
    stopStationaryChecks,
  ]);

  const completeJourney = useCallback(async () => {
    const historyId = activeHistoryIdRef.current;

    if (historyId) {
      await journeyAPI.updateHistory({
        historyId,
        status: 'completed',
        message: isWalkingMode ? 'Walk completed safely' : 'Journey completed safely',
        eventType: isWalkingMode ? 'walking_completed' : 'journey_completed',
      }).catch(() => {});
    }

    await resetJourney({ skipHistoryUpdate: true });
  }, [isWalkingMode, resetJourney]);

  const completeJourneyImmediately = useCallback(
    async (destination, position) => {
      const destinationName = destination?.displayName || 'destination';
      const completionMessage = isWalkingMode
        ? 'Walk completed because source and destination are the same.'
        : 'Journey completed because source and destination are the same.';

      setJourneyError('');

      try {
        const result = await journeyAPI.createHistory({
          event: isWalkingMode ? 'walking_started' : 'journey_started',
          message: isWalkingMode
            ? `Started walking monitor to ${destinationName}`
            : `Started auto/vehicle journey to ${destinationName}`,
          summary: {
            destinationName,
            destinationLat: destination?.lat,
            destinationLng: destination?.lng,
            startLat: position.latitude,
            startLng: position.longitude,
            eta: 0,
            distanceKm: 0,
            selectedRouteIndex: 0,
            journeyMode,
            ...(vehicleHistorySummary || {}),
          },
        });

        if (result?.id) {
          activeHistoryIdRef.current = result.id;
          setActiveHistoryId(result.id);

          if (vehicleHistorySummary) {
            const scanLinkedMessage = vehicleHistorySummary.plateNumber
              ? `Linked scanned vehicle: ${vehicleHistorySummary.plateNumber}`
              : 'Linked scanned vehicle';

            await journeyAPI.addHistoryEvent({
              historyId: result.id,
              type: 'vehicle_scan_linked',
              message: scanLinkedMessage,
              metadata: vehicleHistorySummary,
            });
          }

          await journeyAPI.updateHistory({
            historyId: result.id,
            status: 'completed',
            message: completionMessage,
            eventType: isWalkingMode ? 'walking_completed' : 'journey_completed',
          });
        }
      } catch {
        setJourneyError('Journey ended, but history logs could not be saved properly.');
      } finally {
        await resetJourney({ skipHistoryUpdate: true });
      }

      Alert.alert(isWalkingMode ? 'Walk Complete' : 'Journey Complete', `${completionMessage} Tracking has been stopped.`);
    },
    [isWalkingMode, journeyMode, resetJourney, vehicleHistorySummary]
  );

  useEffect(() => {
    let isMounted = true;

    const restoreJourney = async () => {
      try {
        const savedJourney = await AsyncStorage.getItem(ACTIVE_JOURNEY_KEY);
        if (!savedJourney || !isMounted) {
          return;
        }

        const parsed = JSON.parse(savedJourney);
        if (!parsed?.selectedDestination) {
          return;
        }

        setDestinationQuery(parsed.destinationQuery || parsed.selectedDestination.displayName || '');
        setSelectedDestination(parsed.selectedDestination);
        setJourneyStart(parsed.journeyStart || null);
        setActiveHistoryId(parsed.activeHistoryId || null);
        setRoute(Array.isArray(parsed.route) ? parsed.route : []);
        setRouteOptions(Array.isArray(parsed.routeOptions) ? parsed.routeOptions : []);
        setSelectedRouteIndex(
          Number.isInteger(parsed.selectedRouteIndex) ? parsed.selectedRouteIndex : null
        );
        setAlternatives(Array.isArray(parsed.alternatives) ? parsed.alternatives : []);
        setEta(parsed.eta ?? null);
        setDistanceKm(parsed.distanceKm ?? null);
        setVehicleObservations(Array.isArray(parsed.vehicleObservations) ? parsed.vehicleObservations : []);
        setIsTracking(Boolean(parsed.route?.length > 1));
        setJourneyError('');
      } catch {
        await clearSavedJourney();
      } finally {
        restoredJourneyRef.current = true;
      }
    };

    restoreJourney();

    return () => {
      isMounted = false;
    };
  }, [clearSavedJourney]);

  useEffect(() => {
    if (!restoredJourneyRef.current) {
      return;
    }

    const saveJourney = async () => {
      if (!selectedDestination && routeOptions.length === 0 && route.length === 0) {
        return;
      }

      try {
        await AsyncStorage.setItem(
          ACTIVE_JOURNEY_KEY,
          JSON.stringify({
            destinationQuery,
            selectedDestination,
            journeyStart,
            activeHistoryId,
            route,
            routeOptions,
            selectedRouteIndex,
            alternatives,
            eta,
            distanceKm,
            vehicleObservations,
            savedAt: Date.now(),
          })
        );
      } catch {
        // If storage is full or unavailable, keep the live journey in memory.
      }
    };

    saveJourney();
  }, [
    alternatives,
    activeHistoryId,
    destinationQuery,
    distanceKm,
    eta,
    journeyStart,
    route,
    routeOptions,
    selectedDestination,
    selectedRouteIndex,
    vehicleObservations,
  ]);

  useEffect(() => () => {
    stopDeviationChecks();
    stopStationaryChecks();
    stopEmergencyAudioMonitoring().catch(() => {});
    if (watchSubscriptionRef.current) {
      watchSubscriptionRef.current.remove();
      watchSubscriptionRef.current = null;
    }
  }, [stopDeviationChecks, stopEmergencyAudioMonitoring, stopStationaryChecks]);

  const loadLatestVehicleScan = useCallback(async () => {
    setIsLoadingLatestVehicleScan(true);

    try {
      const scans = await vehicleObservationAPI.list();
      setLatestVehicleScan(Array.isArray(scans) && scans.length > 0 ? scans[0] : null);
    } catch {
      setLatestVehicleScan(null);
    } finally {
      setIsLoadingLatestVehicleScan(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadLatestVehicleScan();
    }, [loadLatestVehicleScan])
  );

  useEffect(() => {
    if (routedVehicleScan) {
      setLatestVehicleScan(routedVehicleScan);
    }
  }, [routedVehicleScan]);

  const smoothPosition = useCallback((rawPosition) => {
    const buffer = smoothingBufferRef.current;
    buffer.push(rawPosition);
    if (buffer.length > GPS_SMOOTH_N) {
      buffer.shift();
    }

    const latitude =
      buffer.reduce((sum, entry) => sum + entry.latitude, 0) / buffer.length;
    const longitude =
      buffer.reduce((sum, entry) => sum + entry.longitude, 0) / buffer.length;

    return {
      latitude,
      longitude,
      accuracy: rawPosition.accuracy,
    };
  }, []);

  const applyLivePosition = useCallback((coords, { resetSmoothing = false } = {}) => {
    const rawPosition = {
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy: coords.accuracy,
    };

    if (!isValidCoordinate(rawPosition)) {
      setLocationError('Live GPS returned invalid coordinates. Please enable location and try again.');
      return null;
    }

    if (
      coords.accuracy &&
      coords.accuracy > GPS_MAX_ACCEPTABLE_ACCURACY_METRES &&
      latestPositionRef.current
    ) {
      setLocationError(`Waiting for better GPS accuracy. Current accuracy is +/-${Math.round(coords.accuracy)}m.`);
      return null;
    }

    if (resetSmoothing) {
      smoothingBufferRef.current = [];
    }

    const smoothed = smoothPosition(rawPosition);
    setCurrentPosition(smoothed);
    latestPositionRef.current = smoothed;
    setAccuracy(Math.round(coords.accuracy || 0));
    setLocationError('');
    return smoothed;
  }, [smoothPosition]);

  const refreshLiveLocation = useCallback(async () => {
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.BestForNavigation,
    });

    return applyLivePosition(position.coords, { resetSmoothing: true });
  }, [applyLivePosition]);

  const startLocationWatcher = useCallback(async () => {
    const permission = await Location.requestForegroundPermissionsAsync();

    if (permission.status !== 'granted') {
      setPermissionStatus('denied');
      setLocationError('Location permission is required to track a safe journey.');
      return;
    }

    setPermissionStatus('granted');
    setLocationError('');

    const initialPosition = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Highest,
    });

    applyLivePosition(initialPosition.coords, { resetSmoothing: true });

    watchSubscriptionRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 2000,
        distanceInterval: 1,
        mayShowUserSettingsDialog: true,
      },
      (position) => {
        if (!isTestLocationActiveRef.current) {
          applyLivePosition(position.coords);
        }
      }
    );
  }, [applyLivePosition]);

  useEffect(() => {
    startLocationWatcher().catch((error) => {
      setPermissionStatus('error');
      setLocationError(error.message || 'Unable to start location tracking.');
    });
  }, [startLocationWatcher]);

  const shareLiveLocation = useCallback(async () => {
    const position = latestPositionRef.current;

    if (!position) {
      Alert.alert('Location Unavailable', 'Current location is not available yet.');
      return;
    }

    const url = `https://www.openstreetmap.org/?mlat=${position.latitude}&mlon=${position.longitude}#map=17/${position.latitude}/${position.longitude}`;
    await Share.share({
      message: `My live location: ${url}`,
    });
  }, []);

  const buildRuntimeIncidentReportSeed = useCallback(
    (reason, position) => {
      const triggerType = resolveSosTriggerType(reason);
      const runtimeVehicle = buildRuntimeVehicleDetails(linkedVehicleScan);
      const location =
        position && Number.isFinite(position.latitude) && Number.isFinite(position.longitude)
          ? {
              lat: position.latitude,
              lng: position.longitude,
              address: '',
              source: 'journey_tracking',
              capturedAt: new Date().toISOString(),
            }
          : {
              lat: null,
              lng: null,
              address: '',
              source: 'journey_tracking',
              capturedAt: new Date().toISOString(),
            };

      const timeline = [
        'SOS triggered from active journey monitoring',
        reason ? `Trigger reason: ${reason}` : '',
        selectedDestination?.displayName ? `Destination selected: ${selectedDestination.displayName}` : '',
        Number.isFinite(distanceKm) ? `Planned distance: ${distanceKm} km` : '',
        Number.isFinite(eta) ? `Estimated arrival: ${eta} min` : '',
        runtimeVehicle?.plateNumber ? `Scanned vehicle linked: ${runtimeVehicle.plateNumber}` : '',
        activeCrimeZone?.name
          ? `Nearby risk zone at trigger time: ${activeCrimeZone.name} (${getCrimeZoneStyle(activeCrimeZone.risk).label})`
          : '',
      ].filter(Boolean);

      return {
        createdAt: new Date().toISOString(),
        status: 'ACTIVE',
        user: {
          uid: user?.uid || user?.id || null,
          name: getUserDisplayName(user),
          phone: getUserPhone(user) || null,
          email: user?.email || null,
        },
        location,
        trigger: {
          type: triggerType,
          riskScore: 'HIGH',
          reason: reason || null,
        },
        vehicle: runtimeVehicle,
        journey: {
          mode: journeyMode,
          historyId: activeHistoryIdRef.current || null,
          selectedRouteIndex:
            Number.isInteger(selectedRouteIndex) && selectedRouteIndex >= 0
              ? selectedRouteIndex
              : null,
          distanceKm: Number.isFinite(distanceKm) ? distanceKm : null,
          etaMinutes: Number.isFinite(eta) ? eta : null,
          destinationName: selectedDestination?.displayName || null,
          destinationLat: selectedDestination?.lat ?? null,
          destinationLng: selectedDestination?.lng ?? null,
          monitoringStatus: 'paused_for_sos',
          source: 'journey_runtime',
        },
        zone: activeCrimeZone
          ? {
              id: activeCrimeZone.id || null,
              name: activeCrimeZone.name || null,
              risk: activeCrimeZone.risk || null,
              description: activeCrimeZone.description || null,
              distance:
                Number.isFinite(activeCrimeZone.distance) ? activeCrimeZone.distance : null,
            }
          : null,
        evidence: [],
        timeline,
        notification: {
          sent: false,
        },
      };
    },
    [
      activeCrimeZone,
      distanceKm,
      eta,
      journeyMode,
      linkedVehicleScan,
      selectedDestination?.displayName,
      selectedDestination?.lat,
      selectedDestination?.lng,
      selectedRouteIndex,
      user,
    ]
  );

  const triggerSOS = useCallback(
    async (reason, options = {}) => {
      if (hasTriggeredSosRef.current || isSosFinalizedRef.current || isSosInFlightRef.current) {
        return;
      }

      let position = latestPositionRef.current;

      if (!position) {
        try {
          const lastKnownPosition = await Location.getLastKnownPositionAsync();
          if (lastKnownPosition?.coords) {
            position = {
              latitude: lastKnownPosition.coords.latitude,
              longitude: lastKnownPosition.coords.longitude,
            };
          }
        } catch {}
      }

      if (!position) {
        try {
          const freshPosition = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });

          if (freshPosition?.coords) {
            position = {
              latitude: freshPosition.coords.latitude,
              longitude: freshPosition.coords.longitude,
            };
          }
        } catch {}
      }

      if (!position) {
        Alert.alert('Location Unavailable', 'Wait for GPS before sending SOS.');
        return;
      }

      latestPositionRef.current = position;
      setCurrentPosition(position);

      isSosInFlightRef.current = true;

      try {
        if (options.finalizeJourney !== false) {
          stopEmergencyAudioMonitoring().catch(() => {});
          stopTracking();
          clearSavedJourney().catch(() => {});
          setIsSosFinalized(true);
          stationaryAlertOpenRef.current = false;
          safetyPromptRef.current = null;
          setSafetyPrompt(null);
          setSafeReasonPrompt(null);
          setSafeReasonText('');
          setSafeReasonPassword('');
          setSafetyNotification({
            title: 'SOS active',
            message: 'Journey monitoring has been paused while the emergency report is prepared.',
            tone: 'info',
          });
        }

        const reportSeed =
          options.prepareReport !== false
            ? buildRuntimeIncidentReportSeed(reason, position)
            : null;

        if (options.prepareReport !== false) {
          navigation.navigate('IncidentReport', {
            autoStartEvidence: true,
            triggerType: resolveSosTriggerType(reason),
            triggerReason: reason,
            source: 'journey_sos',
            reportSeed,
          });
        }

        (async () => {
          try {
            await journeyAPI.triggerSOS({
              userLat: position.latitude,
              userLng: position.longitude,
              reason,
            });
            hasTriggeredSosRef.current = true;

            if (activeHistoryIdRef.current) {
              await journeyAPI.addHistoryEvent({
                historyId: activeHistoryIdRef.current,
                type: 'sos_sent',
                message: `SOS sent: ${reason}`,
                location: {
                  lat: position.latitude,
                  lng: position.longitude,
                },
              }).catch(() => {});

              if (options.finalizeJourney !== false) {
                await journeyAPI.updateHistory({
                  historyId: activeHistoryIdRef.current,
                  status: 'ended',
                  message: 'Journey monitoring paused after SOS was triggered',
                }).catch(() => {});
              }
            }

            if (options.showAlert !== false) {
              Alert.alert(
                'SOS Sent',
                'Emergency alert has been recorded with your live location.'
              );
            }
          } catch (error) {
            if (options.showAlert !== false) {
              Alert.alert(
                'SOS Sync Delayed',
                error?.message || 'Emergency sync is taking longer than expected, but evidence recording has started.'
              );
            }
          } finally {
            isSosInFlightRef.current = false;
          }
        })();
      } catch (error) {
        isSosInFlightRef.current = false;
        if (!hasTriggeredSosRef.current) {
          setIsSosFinalized(false);
        }
        Alert.alert('SOS Failed', error.message || 'Could not send SOS right now.');
      }
    },
    [
      buildRuntimeIncidentReportSeed,
      clearSavedJourney,
      navigation,
      stopEmergencyAudioMonitoring,
      stopTracking,
    ]
  );

  const startEmergencyAudioMonitoring = useCallback(
    async (promptType) => {
      activeAudioPromptTypeRef.current = promptType || 'deviation';
      prewarmEmergencyEvidencePermissions().catch(() => {});

      const started = await AudioAnalysisService.startAnalysis((panicReason) => {
        const historyId = activeHistoryIdRef.current;
        const position = latestPositionRef.current;

        if (historyId) {
          journeyAPI.addHistoryEvent({
            historyId,
            type: 'audio_panic_detected',
            message: panicReason,
            location: position
              ? {
                  lat: position.latitude,
                  lng: position.longitude,
                }
              : null,
            metadata: {
              promptType: activeAudioPromptTypeRef.current || null,
            },
          }).catch(() => {});
        }

        triggerSOS(panicReason, {
          showAlert: false,
          prepareReport: true,
          finalizeJourney: true,
        });
      });

      if (!started) {
        setSafetyNotification({
          title: 'Audio monitoring unavailable',
          message:
            'Microphone access is off or audio capture could not start. Journey prompts and SOS still work normally.',
          tone: 'info',
        });
      }
    },
    [prewarmEmergencyEvidencePermissions, triggerSOS]
  );

  const showSafetyPrompt = useCallback(
    (prompt) => {
      if (isSosFinalizedRef.current) {
        return;
      }

      stationaryAlertOpenRef.current = true;
      safetyPromptRef.current = prompt;
      setSafetyPrompt(prompt);
      startEmergencyAudioMonitoring(prompt?.type).catch(() => {});

      addJourneyLog({
        type: prompt?.type === 'stationary' ? 'stationary_safety_prompt' : 'deviation_safety_prompt',
        message:
          prompt?.message ||
          (prompt?.type === 'stationary'
            ? 'Safety check shown after no movement was detected.'
            : 'Safety check shown after route deviation was detected.'),
        metadata: {
          title: prompt?.title || null,
          promptType: prompt?.type || 'deviation',
        },
      });
    },
    [addJourneyLog, startEmergencyAudioMonitoring]
  );

  const dismissSafetyPrompt = useCallback(() => {
    stationaryAlertOpenRef.current = false;
    safetyPromptRef.current = null;
    setSafetyPrompt(null);
    setConsecutiveDeviationCount(0);

    const position = latestPositionRef.current;
    if (position) {
      stationaryAnchorRef.current = {
        latitude: position.latitude,
        longitude: position.longitude,
        since: Date.now(),
      };
    }
  }, []);

  const sendPromptSOS = useCallback(async () => {
    const activePrompt = safetyPromptRef.current || safetyPrompt;
    const reason = activePrompt?.type === 'stationary'
      ? 'stationary_no_movement_safety_prompt'
      : 'route_deviation_safety_prompt';

    await triggerSOS(reason, {
      showAlert: false,
      prepareReport: true,
      finalizeJourney: true,
    });
    dismissSafetyPrompt();
  }, [dismissSafetyPrompt, safetyPrompt, triggerSOS]);

  const addJourneyLog = useCallback(async ({ type, message, metadata }) => {
    const historyId = activeHistoryIdRef.current;
    if (!historyId) {
      return;
    }

    const position = latestPositionRef.current;

    try {
      await journeyAPI.addHistoryEvent({
        historyId,
        type,
        message,
        location: position
          ? {
              lat: position.latitude,
              lng: position.longitude,
            }
          : null,
        metadata,
      });
    } catch {
      // History logging should never block safety monitoring.
    }
  }, []);

  const saveVehicleObservation = useCallback(async () => {
    if (!selectedDestination) {
      Alert.alert(
        'Select Destination First',
        'Choose a destination in Journey before saving vehicle details for this trip.'
      );
      return;
    }

    if (
      !vehicleTypeInput.trim() &&
      !vehicleColorInput.trim() &&
      !vehicleBrandInput.trim() &&
      !vehicleModelInput.trim() &&
      !vehicleNoteInput.trim()
    ) {
      Alert.alert(
        'Add Vehicle Details',
        'Enter at least one vehicle detail so it can be stored for this journey.'
      );
      return;
    }

    const observation = {
      id: `${Date.now()}`,
      plateNumber: 'NO_PLATE',
      vehicleType: vehicleTypeInput.trim() || null,
      color: vehicleColorInput.trim() || null,
      brand: vehicleBrandInput.trim() || null,
      model: vehicleModelInput.trim() || null,
      note: vehicleNoteInput.trim() || null,
      capturedAt: new Date().toISOString(),
    };

    setVehicleObservations((previous) => [observation, ...previous]);
    setVehicleTypeInput('');
    setVehicleColorInput('');
    setVehicleBrandInput('');
    setVehicleModelInput('');
    setVehicleNoteInput('');

    await addJourneyLog({
      type: 'vehicle_observation_added',
      message: 'Vehicle details without visible plate saved for current journey',
      metadata: observation,
    });

    Alert.alert(
      'Vehicle Saved',
      'This no-plate vehicle detail has been stored for the duration of the current journey.'
    );
  }, [
    addJourneyLog,
    selectedDestination,
    vehicleBrandInput,
    vehicleColorInput,
    vehicleModelInput,
    vehicleNoteInput,
    vehicleTypeInput,
  ]);

  const toggleJourneyMonitoring = useCallback(async () => {
    if (route.length <= 1 || isSosFinalized) {
      return;
    }

    const nextIsTracking = !isTracking;
    setIsTracking(nextIsTracking);

    if (!nextIsTracking) {
      await stopEmergencyAudioMonitoring();
    }

    await addJourneyLog({
      type: nextIsTracking ? 'journey_resumed' : 'journey_paused',
      message: nextIsTracking
        ? 'Journey monitoring resumed by user'
        : 'Journey monitoring paused by user',
      metadata: {
        selectedDestination: selectedDestination?.displayName || null,
      },
    });
  }, [
    addJourneyLog,
    isSosFinalized,
    isTracking,
    route.length,
    selectedDestination?.displayName,
    stopEmergencyAudioMonitoring,
  ]);

  const submitSafeReason = useCallback(async () => {
    const reason = safeReasonText.trim();
    const password = safeReasonPassword.trim();
    const promptType = safeReasonPrompt?.type || 'deviation';
    const deviationClassification =
      promptType === 'deviation' ? classifySafeDeviationReason(reason) : null;

    if (!password) {
      Alert.alert('Safety Password Required', 'Enter your safety password before submitting your safety reason.');
      return;
    }

    const isPasswordValid = await verifySecurityPassword({
      email: user?.email,
      input: password,
    });
    if (!isPasswordValid) {
      Alert.alert('Incorrect Safety Password', 'The safety password did not match. Please try again or update it from Settings.');
      return;
    }

    if (promptType === 'deviation') {
      const suppressionEndsAt = Date.now() + SAFE_REASON_SUPPRESSION_MS;

      lastSafeDeviationRef.current = {
        classification: deviationClassification.code,
        reason,
        suppressUntil: suppressionEndsAt,
        baselineDistance: deviationDistance,
      };

      setSafetyNotification({
        title: 'Deviation noted',
        message: `${deviationClassification.notification} We will ask again only if this continues after some time or becomes much larger.`,
        tone: deviationClassification.code === 'safe_shortcut' ? 'info' : 'success',
      });

      AccessibilityInfo.announceForAccessibility(deviationClassification.notification);
    } else {
      setSafetyNotification({
        title: 'Safety confirmed',
        message: 'Your reason and safety password were verified. Audio escalation has been stopped.',
        tone: 'success',
      });

      AccessibilityInfo.announceForAccessibility('Safety confirmed. Audio escalation has been stopped.');
    }

    await addJourneyLog({
      type: promptType === 'stationary' ? 'safe_stationary_reason' : 'safe_deviation_reason',
      message: `${
        promptType === 'stationary' ? 'Stationary alert' : 'Deviation'
      } marked safe: ${reason || 'No reason provided'}`,
      metadata: {
        classification:
          promptType === 'deviation' ? deviationClassification.code : 'safe_stationary_reason',
        reason: reason || null,
        promptType,
      },
    });

    await stopEmergencyAudioMonitoring();
    setSafeReasonPrompt(null);
    setSafeReasonText('');
    setSafeReasonPassword('');
    dismissSafetyPrompt();
  }, [
    addJourneyLog,
    deviationDistance,
    dismissSafetyPrompt,
    safeReasonPassword,
    safeReasonPrompt?.type,
    safeReasonText,
    stopEmergencyAudioMonitoring,
    user?.email,
  ]);

  const handleSafePress = useCallback(() => {
    const activePrompt = safetyPromptRef.current || safetyPrompt;
    setSafeReasonPrompt(activePrompt);
    setSafetyPrompt(null);
    setSafeReasonText('');
    setSafeReasonPassword('');
  }, [safetyPrompt]);

  useEffect(() => {
    if (!activeCrimeZone) {
      lastAnnouncedZoneRef.current = { id: null, at: 0 };
      return;
    }

    const now = Date.now();
    const shouldAnnounce =
      lastAnnouncedZoneRef.current.id !== activeCrimeZone.id ||
      now - lastAnnouncedZoneRef.current.at >= ZONE_ALERT_COOLDOWN_MS;

    if (!shouldAnnounce) {
      return;
    }

    lastAnnouncedZoneRef.current = {
      id: activeCrimeZone.id,
      at: now,
    };

    const warningMessage = `Safety alert. ${activeCrimeZone.name} is a ${getCrimeZoneStyle(activeCrimeZone.risk).label.toLowerCase()} area within 0.5 kilometers. ${activeCrimeZone.description || 'Stay alert.'}`;
    AccessibilityInfo.announceForAccessibility(warningMessage);

    addJourneyLog({
      type: 'crime_zone_alert',
      message: `Nearby ${activeCrimeZone.risk} risk zone within 0.5 km: ${activeCrimeZone.name}`,
      metadata: {
        zoneId: activeCrimeZone.id,
        zoneName: activeCrimeZone.name,
        risk: activeCrimeZone.risk,
        radius: activeCrimeZone.effectiveRadius,
        description: activeCrimeZone.description || null,
        crimeTypes: activeCrimeZone.crime_types || [],
      },
    });
  }, [activeCrimeZone, addJourneyLog]);

  useEffect(() => {
    dismissSafetyPromptRef.current = dismissSafetyPrompt;
    sendPromptSOSRef.current = sendPromptSOS;
  }, [dismissSafetyPrompt, sendPromptSOS]);

  const searchDestination = useCallback(async () => {
    if (!destinationQuery.trim()) {
      setJourneyError('Enter a destination to search.');
      return;
    }

    setJourneyError('');
    setIsSearching(true);
    setSearchResults([]);
    setRouteOptions([]);
    setSelectedRouteIndex(null);
    setRoute([]);
    setAlternatives([]);
    setEta(null);
    setDistanceKm(null);
    setSelectedDestination(null);
    setJourneyStart(null);
    await stopEmergencyAudioMonitoring();
    stopTracking();
    await clearSavedJourney();

    try {
      const results = await journeyAPI.geocodeDestination(destinationQuery.trim());

      if (!results.length) {
        setSearchResults([]);
        setJourneyError('No destination found in India. Try a more specific place.');
        return;
      }

      setSearchResults(results);
    } catch (error) {
      setJourneyError(error.message || 'Could not search for destination.');
    } finally {
      setIsSearching(false);
    }
  }, [clearSavedJourney, destinationQuery, stopEmergencyAudioMonitoring, stopTracking]);

  const checkRouteDeviation = useCallback(
    async ({ immediatePrompt = false } = {}) => {
      const position = latestPositionRef.current;
      const latestRoute = latestRouteRef.current;

      if (!position || latestRoute.length < 2) {
        setJourneyError('Select a route first, then test deviation.');
        return null;
      }

      if (isCheckingRef.current) {
        return null;
      }

      isCheckingRef.current = true;
      setIsCheckingDeviation(true);

      try {
        const result = await journeyAPI.checkDeviation({
          userLat: position.latitude,
          userLng: position.longitude,
          route: latestRoute,
        });

        setDeviationDistance(result.distance);
        setDeviationThreshold(result.threshold ?? null);
        setIsCurrentlyDeviated(Boolean(result.deviated));

        if (result.deviated) {
          setConsecutiveDeviationCount((previous) => {
            const next = previous + 1;

            if (immediatePrompt || next >= CONSECUTIVE_REQUIRED) {
              const suppression = lastSafeDeviationRef.current;
              const stillSuppressed =
                suppression.suppressUntil > Date.now() &&
                !immediatePrompt;
              const distanceEscalated =
                Number.isFinite(suppression.baselineDistance) &&
                result.distance >=
                  suppression.baselineDistance + SAFE_REASON_DISTANCE_ESCALATION_METRES;

              if (!stationaryAlertOpenRef.current && (!stillSuppressed || distanceEscalated)) {
                showSafetyPrompt({
                  type: 'deviation',
                  title: 'Are you safe?',
                  message: `You are ${result.distance} metres away from the selected route. Confirm you are safe or send SOS.`,
                });
                addJourneyLog({
                  type: 'deviation_detected',
                  message: `Deviation detected: ${result.distance} metres from route`,
                  metadata: {
                    distance: result.distance,
                    threshold: result.threshold,
                  },
                });
              }
            }

            return next;
          });
        } else {
          lastSafeDeviationRef.current = {
            classification: null,
            reason: '',
            suppressUntil: 0,
            baselineDistance: null,
          };
          setConsecutiveDeviationCount(0);

          if (activeAudioPromptTypeRef.current === 'deviation') {
            activeAudioPromptTypeRef.current = null;
            stopEmergencyAudioMonitoring().catch(() => {});
          }

          if (safetyPromptRef.current?.type === 'deviation') {
            stationaryAlertOpenRef.current = false;
            safetyPromptRef.current = null;
            setSafetyPrompt(null);
            setSafeReasonPrompt(null);
            setSafeReasonText('');
            setSafeReasonPassword('');
          }
        }
      } catch (error) {
        setJourneyError(error.message || 'Deviation check failed.');
      } finally {
        isCheckingRef.current = false;
        setIsCheckingDeviation(false);
      }
    },
    [addJourneyLog, showSafetyPrompt, stopEmergencyAudioMonitoring]
  );

  const startDeviationChecks = useCallback(() => {
    stopDeviationChecks();

    checkIntervalRef.current = setInterval(() => {
      checkRouteDeviation();
    }, CHECK_INTERVAL_MS);
  }, [checkRouteDeviation, stopDeviationChecks]);

  useEffect(() => {
    if (isTracking && route.length > 1) {
      startDeviationChecks();
      return stopDeviationChecks;
    }

    stopDeviationChecks();
    return undefined;
  }, [isTracking, route.length, startDeviationChecks, stopDeviationChecks]);

  useEffect(() => {
    if (!isTracking || !selectedDestination || !currentPosition) {
      return;
    }

    const arrivalTargets = [
      selectedDestination &&
      Number.isFinite(selectedDestination.lat) &&
      Number.isFinite(selectedDestination.lng)
        ? {
            latitude: selectedDestination.lat,
            longitude: selectedDestination.lng,
          }
        : null,
      Array.isArray(route) && route.length
        ? {
            latitude: route[route.length - 1][0],
            longitude: route[route.length - 1][1],
          }
        : null,
    ].filter(Boolean);

    const remainingDistance = arrivalTargets.length
      ? Math.min(
          ...arrivalTargets.map((target) =>
            haversineMetres(
              currentPosition.latitude,
              currentPosition.longitude,
              target.latitude,
              target.longitude
            )
          )
        )
      : Infinity;

    if (remainingDistance <= ARRIVAL_THRESHOLD_METRES) {
      completeJourney();
      Alert.alert(
        isWalkingMode ? 'Walk Complete' : 'Journey Complete',
        isWalkingMode
          ? 'You have reached your walking destination safely. Tracking has been stopped.'
          : 'You have reached your destination safely. Tracking has been stopped.'
      );
    }
  }, [completeJourney, currentPosition, isTracking, isWalkingMode, route, selectedDestination]);

  const saveWalkingCheckpoint = useCallback(async () => {
    const position = latestPositionRef.current;

    if (!position || !selectedDestination || !activeHistoryIdRef.current) {
      return;
    }

    const now = Date.now();
    if (now - lastWalkingLogAtRef.current < WALKING_LOCATION_LOG_INTERVAL_MS) {
      return;
    }

    lastWalkingLogAtRef.current = now;

    let resolvedAddress = '';

    try {
      const results = await Location.reverseGeocodeAsync({
        latitude: position.latitude,
        longitude: position.longitude,
      });
      resolvedAddress = formatResolvedAddress(Array.isArray(results) ? results[0] : null);
    } catch {
      resolvedAddress = '';
    }

    await addJourneyLog({
      type: 'walking_location_logged',
      message: `Near to ${resolvedAddress || 'current position'}`,
      metadata: {
        address: resolvedAddress || null,
        destinationName: selectedDestination.displayName || null,
        intervalSeconds: WALKING_LOCATION_LOG_INTERVAL_MS / 1000,
      },
    });
  }, [addJourneyLog, selectedDestination]);

  useEffect(() => {
    if (!isWalkingMode || !isTracking || route.length <= 1) {
      return undefined;
    }

    const intervalId = setInterval(saveWalkingCheckpoint, WALKING_LOCATION_LOG_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [isTracking, isWalkingMode, route.length, saveWalkingCheckpoint]);

  useEffect(() => {
    if (!isTracking || !currentPosition) {
      stationaryAnchorRef.current = null;
      return;
    }

    const anchor = stationaryAnchorRef.current;

    if (!anchor) {
      stationaryAnchorRef.current = {
        latitude: currentPosition.latitude,
        longitude: currentPosition.longitude,
        since: Date.now(),
      };
      return;
    }

    const movement = haversineMetres(
      anchor.latitude,
      anchor.longitude,
      currentPosition.latitude,
      currentPosition.longitude
    );

    if (movement > STATIONARY_RADIUS_METRES) {
      stationaryAnchorRef.current = {
        latitude: currentPosition.latitude,
        longitude: currentPosition.longitude,
        since: Date.now(),
      };
      return;
    }

    if (
      Date.now() - anchor.since >= STATIONARY_REMINDER_MS &&
      !stationaryAlertOpenRef.current
    ) {
      showSafetyPrompt({
        type: 'stationary',
        title: 'You have not moved for 5 minutes',
        message: 'Are you safe? If you are stuck or feel unsafe, send SOS now.',
      });
      addJourneyLog({
        type: 'stationary_detected',
        message: 'User stayed within the same 50 metre area for 5 minutes',
      });
    }
  }, [addJourneyLog, currentPosition, isTracking, showSafetyPrompt]);

  useEffect(() => {
    stopStationaryChecks();

    if (!isTracking || !currentPosition) {
      return undefined;
    }

    stationaryIntervalRef.current = setInterval(() => {
      const anchor = stationaryAnchorRef.current;
      const position = latestPositionRef.current;

      if (!anchor || !position || stationaryAlertOpenRef.current) {
        return;
      }

      const movement = haversineMetres(
        anchor.latitude,
        anchor.longitude,
        position.latitude,
        position.longitude
      );

      if (
        movement <= STATIONARY_RADIUS_METRES &&
        Date.now() - anchor.since >= STATIONARY_REMINDER_MS
      ) {
        showSafetyPrompt({
          type: 'stationary',
          title: 'You have not moved for 5 minutes',
          message: 'Are you safe? If you are stuck or feel unsafe, send SOS now.',
        });
        addJourneyLog({
          type: 'stationary_detected',
          message: 'User stayed within the same 50 metre area for 5 minutes',
        });
      }
    }, STATIONARY_CHECK_INTERVAL_MS);

    return stopStationaryChecks;
  }, [addJourneyLog, currentPosition, isTracking, showSafetyPrompt, stopStationaryChecks]);

  const fitMapToRoute = useCallback(
    (mainRoute, extraCoordinates = []) => {
      const coordinates = [...mainRoute.map(toMapCoordinate), ...extraCoordinates];

      if (!coordinates.length || !mapRef.current) {
        return;
      }

      mapRef.current.fitToCoordinates(coordinates, {
        edgePadding: {
          top: 70,
          right: 50,
          bottom: 70,
          left: 50,
        },
        animated: true,
      });
    },
    []
  );

  const applyRouteSelection = useCallback(
    async (routeData, destination, selectedIndex = 0, availableOptions = routeOptions) => {
      const otherRoutes = availableOptions.filter((_, index) => index !== selectedIndex);
      const startPoint = journeyStart || routeData.route[0] || null;

      setRoute(routeData.route);
      setAlternatives(otherRoutes);
      setEta(routeData.eta);
      setDistanceKm(routeData.distance_km);
      setSelectedDestination(destination);
      setJourneyStart(startPoint);
      setSelectedRouteIndex(selectedIndex);
      setSearchResults([]);
      setIsTracking(true);
      stationaryAnchorRef.current = null;
      resetDeviationState();

      const current = latestPositionRef.current;
      fitMapToRoute(routeData.route, current ? [current] : []);

      try {
        if (!activeHistoryIdRef.current && startPoint && destination) {
          const result = await journeyAPI.createHistory({
            event: isWalkingMode ? 'walking_started' : 'journey_started',
            message: isWalkingMode
              ? `Started walking monitor to ${destination.displayName}`
              : `Started auto/vehicle journey to ${destination.displayName}`,
            summary: {
              destinationName: destination.displayName,
              destinationLat: destination.lat,
              destinationLng: destination.lng,
              startLat: startPoint[0],
              startLng: startPoint[1],
              eta: routeData.eta,
              distanceKm: routeData.distance_km,
              selectedRouteIndex: selectedIndex,
              journeyMode,
              ...(vehicleHistorySummary || {}),
            },
          });

          if (result?.id) {
            activeHistoryIdRef.current = result.id;
            setActiveHistoryId(result.id);

            if (vehicleHistorySummary) {
              const scanLinkedMessage = vehicleHistorySummary.plateNumber
                ? `Linked scanned vehicle: ${vehicleHistorySummary.plateNumber}`
                : 'Linked scanned vehicle';

              await journeyAPI.addHistoryEvent({
                historyId: result.id,
                type: 'vehicle_scan_linked',
                message: scanLinkedMessage,
                metadata: vehicleHistorySummary,
              });
            }

            await journeyAPI.addHistoryEvent({
              historyId: result.id,
              type: 'route_selected',
              message: `Selected route ${selectedIndex + 1} to ${destination.displayName}`,
              metadata: {
                eta: routeData.eta,
                distanceKm: routeData.distance_km,
              },
            });
          }
        } else {
          await addJourneyLog({
            type: 'route_selected',
            message: `Selected route ${selectedIndex + 1} to ${destination?.displayName || 'destination'}`,
            metadata: {
              eta: routeData.eta,
              distanceKm: routeData.distance_km,
            },
          });
        }
      } catch {
        setJourneyError('Route selected, but journey history could not be saved.');
      }
    },
    [
      addJourneyLog,
      fitMapToRoute,
      isWalkingMode,
      journeyMode,
      journeyStart,
      resetDeviationState,
      routeOptions,
      vehicleHistorySummary,
    ]
  );

  const planRouteToDestination = useCallback(
    async (destination) => {
      let position = latestPositionRef.current;

      if (!position && !isTestLocationActiveRef.current) {
        try {
          position = await refreshLiveLocation();
        } catch {
          // Fall back to the last known live position if a fresh read times out.
        }
      }

      if (!position) {
        try {
          position = await refreshLiveLocation();
        } catch {
          setJourneyError('Waiting for GPS lock. Please try again in a moment.');
          return;
        }
      }

      if (!position || !isValidCoordinate(position)) {
        setJourneyError('Live GPS is not ready. Please enable location and try again.');
        return;
      }

      setIsPlanningRoute(true);
      setJourneyError('');

      try {
        const distanceToDestination = haversineMetres(
          position.latitude,
          position.longitude,
          destination.lat,
          destination.lng
        );

        if (distanceToDestination <= ARRIVAL_THRESHOLD_METRES) {
          await completeJourneyImmediately(destination, position);
          return;
        }

        const candidateDestinations = [
          destination,
          ...searchResults.filter(
            (item) =>
              item &&
              (item.displayName !== destination.displayName ||
                item.lat !== destination.lat ||
                item.lng !== destination.lng)
          ),
        ];

        let routeData = null;
        let resolvedDestination = destination;
        let lastRouteError = null;

        for (const candidate of candidateDestinations) {
          try {
            routeData = await journeyAPI.fetchRoute({
              originLat: position.latitude,
            originLng: position.longitude,
            destLat: candidate.lat,
            destLng: candidate.lng,
            mode: journeyMode,
            includeAlternatives: false,
          });
          resolvedDestination = candidate;
          break;
        } catch (error) {
          lastRouteError = error;
          }
        }

        if (!routeData) {
          throw lastRouteError || new Error('Could not plan the route.');
        }

        const snappedDestination =
          routeData.resolvedDestination &&
          Number.isFinite(routeData.resolvedDestination.lat) &&
          Number.isFinite(routeData.resolvedDestination.lng)
            ? {
                ...resolvedDestination,
                lat: routeData.resolvedDestination.lat,
                lng: routeData.resolvedDestination.lng,
              }
            : resolvedDestination;

        const suggestions = [
          {
            route: routeData.route,
            eta: routeData.eta,
            distance_km: routeData.distance_km,
            label: 'Recommended route',
          },
        ];

        setRoute([]);
        setAlternatives([]);
        setEta(null);
        setDistanceKm(null);
        setRouteOptions(suggestions);
        setSelectedRouteIndex(null);
        setSelectedDestination(snappedDestination);
        setJourneyStart(
          routeData.resolvedOrigin
            ? [routeData.resolvedOrigin.lat, routeData.resolvedOrigin.lng]
            : routeData.route[0] || null
        );
        resetDeviationState();
        stopDeviationChecks();
        fitMapToRoute(routeData.route, latestPositionRef.current ? [latestPositionRef.current] : []);
        await applyRouteSelection(suggestions[0], snappedDestination, 0, suggestions);
      } catch (error) {
        setJourneyError(error.message || 'Could not plan the route.');
      } finally {
        setIsPlanningRoute(false);
      }
    },
    [
      completeJourneyImmediately,
      fitMapToRoute,
      refreshLiveLocation,
      resetDeviationState,
      searchResults,
      stopDeviationChecks,
      applyRouteSelection,
      journeyMode,
    ]
  );

  const switchToAlternative = useCallback(
    (index) => {
      const selected = alternatives[index];
      if (!selected) {
        return;
      }

      const previousMain = {
        route,
        eta,
        distance_km: distanceKm,
      };

      const selectedOptionIndex = routeOptions.findIndex(
        (option) => option === selected || option.route === selected.route
      );
      const nextAlternatives =
        selectedOptionIndex >= 0
          ? routeOptions.filter((_, itemIndex) => itemIndex !== selectedOptionIndex)
          : alternatives.filter((_, itemIndex) => itemIndex !== index);

      if (selectedOptionIndex < 0) {
        nextAlternatives.push(previousMain);
      }

      setAlternatives(nextAlternatives);
      setRoute(selected.route);
      setEta(selected.eta);
      setDistanceKm(selected.distance_km);
      setSelectedRouteIndex(selectedOptionIndex >= 0 ? selectedOptionIndex : null);
      resetDeviationState();
      addJourneyLog({
        type: 'route_switched',
        message: `Switched to route ${index + 1}`,
        metadata: {
          eta: selected.eta,
          distanceKm: selected.distance_km,
        },
      });

      const current = latestPositionRef.current;
      fitMapToRoute(selected.route, current ? [current] : []);
    },
    [addJourneyLog, alternatives, distanceKm, eta, fitMapToRoute, resetDeviationState, route, routeOptions]
  );

  const applyTestLocation = useCallback(() => {
    const latitude = parseLatLngInput(testLatitude);
    const longitude = parseLatLngInput(testLongitude);

    if (
      latitude === null ||
      longitude === null ||
      !isValidCoordinate({ latitude, longitude })
    ) {
      Alert.alert('Invalid Test Location', 'Enter valid latitude and longitude values.');
      return false;
    }

    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      Alert.alert('Invalid Test Location', 'Latitude must be -90 to 90 and longitude must be -180 to 180.');
      return false;
    }

    const testPosition = {
      latitude,
      longitude,
      accuracy: 0,
    };

    setIsTestLocationActive(true);
    isTestLocationActiveRef.current = true;
    setCurrentPosition(testPosition);
    setAccuracy(0);
    latestPositionRef.current = testPosition;
    stationaryAnchorRef.current = null;
    return true;
  }, [testLatitude, testLongitude]);

  const useLiveLocationAgain = useCallback(async () => {
    setIsTestLocationActive(false);
    isTestLocationActiveRef.current = false;
    setTestLatitude('');
    setTestLongitude('');
    setCurrentPosition(null);
    latestPositionRef.current = null;
    stationaryAnchorRef.current = null;

    try {
      await refreshLiveLocation();
    } catch {
      setLocationError('Could not refresh live GPS. Please check location permission.');
    }
  }, [refreshLiveLocation]);

  const checkDeviationNow = useCallback(async () => {
    const applied = applyTestLocation();
    if (!applied) {
      return;
    }

    setTimeout(() => {
      checkRouteDeviation({ immediatePrompt: true });
    }, 0);
  }, [applyTestLocation, checkRouteDeviation]);

  const showTestReminder = useCallback(() => {
    if (!stationaryAlertOpenRef.current) {
      showSafetyPrompt({
        type: 'test',
        title: 'Test reminder',
        message: 'This is how the safety popup will look when deviation or no movement is detected.',
      });
    }
  }, [showSafetyPrompt]);

  const routeOptionCoordinates = useMemo(
    () =>
      routeOptions.map((option) => ({
        ...option,
        coordinates: option.route.map(toMapCoordinate),
      })),
    [routeOptions]
  );

  useEffect(() => {
    const visibleRoute = route.length > 1 ? route : routeOptions[0]?.route;

    if (!visibleRoute?.length) {
      return undefined;
    }

    const timer = setTimeout(() => {
      fitMapToRoute(visibleRoute, currentPosition ? [currentPosition] : []);
    }, 250);

    return () => clearTimeout(timer);
  }, [currentPosition, fitMapToRoute, route, routeOptions]);

  const currentRegion = useMemo(() => {
    if (routeCoordinates.length > 1) {
      return fitDelta(routeCoordinates);
    }

    if (currentPosition) {
      return {
        latitude: currentPosition.latitude,
        longitude: currentPosition.longitude,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      };
    }

    return DEFAULT_REGION;
  }, [currentPosition, routeCoordinates]);

  useEffect(() => {
    setMapRegion(currentRegion);
  }, [currentRegion]);

  const adjustMapZoom = useCallback((zoomIn) => {
    const baseRegion = mapRegion || currentRegion || DEFAULT_REGION;
    const multiplier = zoomIn ? 0.6 : 1.7;
    const nextRegion = {
      latitude: baseRegion.latitude,
      longitude: baseRegion.longitude,
      latitudeDelta: Math.min(
        MAX_MAP_DELTA,
        Math.max(MIN_MAP_DELTA, baseRegion.latitudeDelta * multiplier)
      ),
      longitudeDelta: Math.min(
        MAX_MAP_DELTA,
        Math.max(MIN_MAP_DELTA, baseRegion.longitudeDelta * multiplier)
      ),
    };

    setMapRegion(nextRegion);
    mapRef.current?.animateToRegion(nextRegion, 220);
  }, [currentRegion, mapRegion]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#f7f3ff" />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Home'))}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color="#111" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{trackerTitle}</Text>
        <TouchableOpacity onPress={shareLiveLocation} style={styles.shareButton}>
          <Ionicons name="share-social-outline" size={20} color="#7b57d1" />
        </TouchableOpacity>
      </View>

      <View style={styles.mapWrap}>
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={currentRegion}
          showsUserLocation={permissionStatus === 'granted'}
          showsMyLocationButton
          zoomEnabled
          zoomControlEnabled
          zoomTapEnabled
          toolbarEnabled={false}
          onRegionChangeComplete={setMapRegion}
        >
          {crimeZoneMarkers.map((zone) => {
            const isActiveZone = zone.id === activeCrimeZone?.id;
            const zoneStyle = getCrimeZoneStyle(zone.risk);

            if (!isValidCoordinate(zone.coordinate)) {
              return null;
            }

            return (
              <Circle
                key={`crime-zone-${zone.id}`}
                center={zone.coordinate}
                radius={MAP_CRIME_ZONE_RADIUS_METRES}
                fillColor={
                  isActiveZone
                    ? zoneStyle.fillColor.replace(/0\.\d+\)/, '0.28)')
                    : zoneStyle.fillColor
                }
                strokeColor={zoneStyle.strokeColor}
                strokeWidth={isActiveZone ? 2.5 : 1.5}
              />
            );
          })}

          {routeCoordinates.length > 1 ? (
            <Polyline
              coordinates={routeCoordinates}
              strokeWidth={6}
              strokeColor={safetyPrompt?.type === 'deviation' ? '#ef4444' : '#4b7bec'}
            />
          ) : null}

          {!route.length
            ? routeOptionCoordinates.map((option, index) => (
                <Polyline
                  key={`route-preview-${index}`}
                  coordinates={option.coordinates}
                  strokeWidth={index === 0 ? 5 : 4}
                  strokeColor={index === 0 ? '#4b7bec' : '#b8a7e8'}
                  lineDashPattern={index === 0 ? undefined : [10, 6]}
                />
              ))
            : null}

          {alternativeCoordinates.map((alternative, index) => (
            <Polyline
              key={`alternative-${index}`}
              coordinates={alternative.coordinates}
              strokeWidth={4}
              strokeColor="#c3b6e9"
              lineDashPattern={[10, 6]}
            />
          ))}

          {currentPosition && (
            <Marker
              coordinate={{
                latitude: currentPosition.latitude,
                longitude: currentPosition.longitude,
              }}
              title="You"
              description="Live location"
              pinColor={safetyPrompt?.type === 'deviation' ? '#ef4444' : '#4b7bec'}
            />
          )}

          {lockedStartCoordinate && (
            <Marker coordinate={lockedStartCoordinate} title="Start" pinColor="#49d160" />
          )}

          {routeCoordinates[routeCoordinates.length - 1] && (
            <Marker
              coordinate={routeCoordinates[routeCoordinates.length - 1]}
              title={selectedDestination?.displayName || 'Destination'}
              pinColor="#f13a35"
            />
          )}
        </MapView>

        <View style={styles.mapZoomControls}>
          <TouchableOpacity style={styles.mapZoomButton} onPress={() => adjustMapZoom(true)}>
            <Ionicons name="add" size={18} color="#22153f" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.mapZoomButton} onPress={() => adjustMapZoom(false)}>
            <Ionicons name="remove" size={18} color="#22153f" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {!isWalkingMode ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Scanned Vehicle Details</Text>
            <Text style={styles.cardSubtitle}>
              {selectedDestination
                ? 'This journey is linked with the scanned plate and will be saved in journey logs.'
                : 'This journey is linked with the scanned plate. Enter a destination to start vehicle tracking.'}
            </Text>

            {isLoadingLatestVehicleScan ? (
              <View style={styles.vehicleScanLoadingRow}>
                <ActivityIndicator size="small" color="#7b57d1" />
                <Text style={styles.vehicleScanLoadingText}>Loading scanned vehicle...</Text>
              </View>
            ) : linkedVehicleScan ? (
              <View style={styles.linkedVehicleCard}>
                <View style={styles.linkedVehicleHeader}>
                  <View>
                    <Text style={styles.linkedVehicleTitle}>{linkedVehicleDisplay?.title}</Text>
                    {linkedVehicleDisplay?.meta?.length ? (
                      <Text style={styles.linkedVehicleMeta}>
                        {linkedVehicleDisplay.meta.join(' | ')}
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.linkedVehicleBadge}>
                    <Ionicons name="shield-checkmark-outline" size={14} color="#7b57d1" />
                    <Text style={styles.linkedVehicleBadgeText}>Scanned</Text>
                  </View>
                </View>

                {linkedVehicleDisplay?.infoCards?.length ? (
                  <View style={styles.linkedVehicleInfoGrid}>
                    {linkedVehicleDisplay.infoCards.map(([label, value]) => (
                      <View key={label} style={styles.linkedVehicleInfoCard}>
                        <Text style={styles.linkedVehicleInfoLabel}>{label}</Text>
                        <Text style={styles.linkedVehicleInfoValue}>{value}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                {linkedVehicleScan.note ? (
                  <Text style={styles.linkedVehicleNote}>{linkedVehicleScan.note}</Text>
                ) : null}
              </View>
            ) : (
              <Text style={styles.locationMeta}>
                Scan a vehicle first from Vehicle Scan. Then choose a destination and the latest
                scanned vehicle details will appear here below the map.
              </Text>
            )}
          </View>
        ) : null}

        <View style={styles.statusRow}>
          <View style={styles.statusChip}>
            <Ionicons
              name={permissionStatus === 'granted' ? 'navigate' : 'warning-outline'}
              size={14}
              color={permissionStatus === 'granted' ? '#49d160' : '#f13a35'}
            />
            <Text style={styles.statusChipText}>
              {permissionStatus === 'granted'
                ? `GPS ${accuracy ? `+/-${accuracy}m` : 'active'}`
                : 'GPS required'}
            </Text>
          </View>

          <View style={[styles.statusChip, isTracking && styles.statusChipActive]}>
            <Ionicons name="pulse-outline" size={14} color={isTracking ? '#7b57d1' : '#8f8f96'} />
            <Text style={[styles.statusChipText, isTracking && styles.statusChipTextActive]}>
              {isTracking ? 'Tracking live' : 'Tracking paused'}
            </Text>
          </View>

          {deviationDistance !== null && (
            <View style={[styles.statusChip, isCurrentlyDeviated && styles.statusChipDanger]}>
              <Ionicons name="git-compare-outline" size={14} color={isCurrentlyDeviated ? '#ef4444' : '#2f9e44'} />
              <Text style={[styles.statusChipText, isCurrentlyDeviated && styles.statusChipDangerText]}>
                {isCurrentlyDeviated ? `${deviationDistance} m off route` : 'On route'}
              </Text>
            </View>
          )}
        </View>

        {safetyNotification ? (
          <View
            style={[
              styles.inlineNotification,
              safetyNotification.tone === 'info'
                ? styles.inlineNotificationInfo
                : styles.inlineNotificationSuccess,
            ]}
          >
            <Ionicons
              name={safetyNotification.tone === 'info' ? 'information-circle' : 'checkmark-circle'}
              size={18}
              color={safetyNotification.tone === 'info' ? '#1d4ed8' : '#166534'}
            />
            <View style={styles.inlineNotificationCopy}>
              <Text style={styles.inlineNotificationTitle}>{safetyNotification.title}</Text>
              <Text style={styles.inlineNotificationText}>{safetyNotification.message}</Text>
            </View>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{destinationCardTitle}</Text>
          <Text style={styles.cardSubtitle}>
            {destinationCardSubtitle}
          </Text>

          <View style={styles.searchRow}>
            <TextInput
              value={destinationQuery}
              onChangeText={setDestinationQuery}
              style={styles.input}
              placeholder="Search destination in India"
              placeholderTextColor="#9f9bb2"
            />
            <TouchableOpacity
              style={styles.searchButton}
              onPress={searchDestination}
              disabled={isSearching || isPlanningRoute}
            >
              {isSearching ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="search" size={18} color="#fff" />
              )}
            </TouchableOpacity>
          </View>

          {journeyError ? <Text style={styles.errorText}>{journeyError}</Text> : null}
          {locationError ? <Text style={styles.errorText}>{locationError}</Text> : null}

          {searchResults.map((result, index) => (
            <TouchableOpacity
              key={`${result.displayName}-${index}`}
              style={styles.resultCard}
              onPress={() => planRouteToDestination(result)}
              disabled={isPlanningRoute}
            >
              <Ionicons name="location-outline" size={18} color="#7b57d1" />
              <View style={styles.resultTextWrap}>
                <Text style={styles.resultName}>{result.displayName}</Text>
                <Text style={styles.resultMeta}>
                  {result.lat.toFixed(4)}, {result.lng.toFixed(4)}
                </Text>
              </View>
              {isPlanningRoute ? (
                <ActivityIndicator size="small" color="#7b57d1" />
              ) : (
                <Text style={styles.resultActionText}>{isWalkingMode ? 'Find walk route' : 'Find routes'}</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{isWalkingMode ? 'Live Walk' : 'Live Auto/Vehicle Journey'}</Text>

          {activeCrimeZone ? (
            <View
              style={[
                styles.crimeZoneAlertCard,
                { backgroundColor: getCrimeZoneStyle(activeCrimeZone.risk).cardTint },
              ]}
            >
              <View style={styles.crimeZoneAlertHeader}>
                <Ionicons name="warning" size={18} color="#dc2626" />
                <Text style={styles.crimeZoneAlertTitle}>Dangerous or intermediate area ahead</Text>
              </View>
              <Text style={styles.crimeZoneAlertName}>{activeCrimeZone.name}</Text>
              <Text
                style={[
                  styles.crimeZoneAlertRisk,
                  { color: getCrimeZoneStyle(activeCrimeZone.risk).textColor },
                ]}
              >
                {getCrimeZoneStyle(activeCrimeZone.risk).label} zone within 0.5 km
              </Text>
              <Text style={styles.crimeZoneAlertDescription}>{activeCrimeZone.description}</Text>
              <Text style={styles.crimeZoneAlertWhy}>
                Why this area is risky: {formatCrimeTypes(activeCrimeZone.crime_types)}
              </Text>

              {nearbyCrimeZones.slice(0, 3).map((zone) => (
                <View key={`nearby-zone-${zone.id}`} style={styles.nearbyCrimeZoneRow}>
                  <Text style={styles.nearbyCrimeZoneName}>{zone.name}</Text>
                  <Text
                    style={[
                      styles.nearbyCrimeZoneMeta,
                      { color: getCrimeZoneStyle(zone.risk).textColor },
                    ]}
                  >
                    {getCrimeZoneStyle(zone.risk).label} | {formatZoneDistance(zone.distance)}
                  </Text>
                  <Text style={styles.nearbyCrimeZoneReason}>
                    {zone.description || `Reported risks: ${formatCrimeTypes(zone.crime_types)}`}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.crimeZoneSafeCard}>
              <Ionicons name="shield-checkmark" size={18} color="#15803d" />
              <Text style={styles.crimeZoneSafeText}>
                No dangerous or intermediate Kolhapur crime zone detected within 0.5 km.
              </Text>
            </View>
          )}

          <View style={styles.metricGrid}>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>ETA</Text>
              <Text style={styles.metricValue}>{eta !== null ? `${eta} min` : '--'}</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>Distance</Text>
              <Text style={styles.metricValue}>
                {distanceKm !== null ? `${distanceKm} km` : '--'}
              </Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>Route Status</Text>
              <Text style={[styles.metricValue, isCurrentlyDeviated && styles.metricDanger]}>
                {deviationDistance === null
                  ? '--'
                  : isCurrentlyDeviated
                    ? `${deviationDistance} m`
                    : 'On route'}
              </Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>Status</Text>
              <Text style={styles.metricValue}>
                {isSosFinalized ? 'SOS Active' : isTracking ? 'Live' : routeOptions.length ? 'Choose' : '--'}
              </Text>
            </View>
          </View>

          {selectedDestination ? (
            <View style={styles.selectedDestinationCard}>
              <Ionicons name="flag-outline" size={18} color="#7b57d1" />
              <Text style={styles.selectedDestinationText}>{selectedDestination.displayName}</Text>
            </View>
          ) : null}

          {currentPosition ? (
            <Text style={styles.locationMeta}>
              Current: {currentPosition.latitude.toFixed(5)}, {currentPosition.longitude.toFixed(5)}
              {accuracy !== null ? ` (+/-${accuracy}m)` : ''}
              {isTestLocationActive ? ' | Mock GPS active' : ''}
            </Text>
          ) : (
            <Text style={styles.locationMeta}>Waiting for live GPS...</Text>
          )}

          <View style={styles.controlRow}>
            <TouchableOpacity
              style={[styles.primaryButton, (!route.length || isSosFinalized) && styles.buttonDisabled]}
              onPress={toggleJourneyMonitoring}
              disabled={!route.length || isSosFinalized}
            >
              <Ionicons
                name={isTracking ? 'pause-circle-outline' : 'play-circle-outline'}
                size={18}
                color="#fff"
              />
              <Text style={styles.primaryButtonText}>
                {isSosFinalized
                  ? isWalkingMode
                    ? 'Walk Paused After SOS'
                    : 'Journey Paused After SOS'
                  : isTracking
                    ? 'Pause Monitor'
                    : 'Resume Monitor'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onLongPress={() => triggerSOS('manual_sos')}
              delayLongPress={1400}
            >
              <Ionicons name="alert-circle-outline" size={18} color="#f13a35" />
              <Text style={styles.secondaryButtonText}>Hold SOS</Text>
            </TouchableOpacity>
          </View>

          {route.length > 0 || routeOptions.length > 0 ? (
            <TouchableOpacity style={styles.endJourneyButton} onPress={resetJourney}>
              <Ionicons name="close-circle-outline" size={18} color="#6f3440" />
              <Text style={styles.endJourneyText}>{isWalkingMode ? 'End Walk' : 'End Journey'}</Text>
            </TouchableOpacity>
          ) : null}

          {isCheckingDeviation ? (
            <Text style={styles.locationMeta}>Checking route deviation...</Text>
          ) : null}
        </View>

        <View style={styles.testCard}>
          <View style={styles.testHeader}>
            <View>
              <Text style={styles.cardTitle}>Deviation Test Mode</Text>
              <Text style={styles.cardSubtitle}>
                Enter fake current coordinates to test route deviation without moving.
              </Text>
            </View>
            {isTestLocationActive ? (
              <View style={styles.testBadge}>
                <Text style={styles.testBadgeText}>Mock GPS</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.testInputRow}>
            <TextInput
              value={testLatitude}
              onChangeText={setTestLatitude}
              style={styles.testInput}
              keyboardType="decimal-pad"
              placeholder="Latitude"
              placeholderTextColor="#9f9bb2"
            />
            <TextInput
              value={testLongitude}
              onChangeText={setTestLongitude}
              style={styles.testInput}
              keyboardType="decimal-pad"
              placeholder="Longitude"
              placeholderTextColor="#9f9bb2"
            />
          </View>

          <View style={styles.testButtonRow}>
            <TouchableOpacity style={styles.testPrimaryButton} onPress={checkDeviationNow}>
              <Ionicons name="git-compare-outline" size={17} color="#fff" />
              <Text style={styles.testPrimaryText}>Check Deviation Now</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.testSecondaryButton} onPress={applyTestLocation}>
              <Text style={styles.testSecondaryText}>Apply Mock</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.testButtonRow}>
            <TouchableOpacity style={styles.testSecondaryButton} onPress={showTestReminder}>
              <Text style={styles.testSecondaryText}>Test Popup</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.testSecondaryButton} onPress={useLiveLocationAgain}>
              <Text style={styles.testSecondaryText}>Use Live GPS</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.testHint}>
            Tip: choose a route first, then enter coordinates far from that route and tap Check Deviation Now.
          </Text>
        </View>

        {routeOptions.length > 0 ? (
          <View style={styles.card}>
              <Text style={styles.cardTitle}>{isWalkingMode ? 'Suggested Walking Routes' : 'Suggested Safe Routes'}</Text>
              <Text style={styles.cardSubtitle}>
                {isWalkingMode
                  ? 'Choose the walking route. Monitoring starts automatically after selection and saves a location log every 1 minute.'
                  : 'Choose the route she is taking. Monitoring starts automatically after selection.'}
              </Text>

            {routeOptions.map((option, index) => {
              const isSelectedRoute = selectedRouteIndex === index && route.length > 0;

              return (
                <TouchableOpacity
                  key={`suggested-route-${index}`}
                  style={[
                    styles.alternativeCard,
                    isSelectedRoute && styles.selectedRouteOption,
                  ]}
                  onPress={() => applyRouteSelection(option, selectedDestination, index)}
                  disabled={isPlanningRoute}
                >
                  <View style={styles.resultTextWrap}>
                    <Text style={styles.resultName}>{option.label || `Route ${index + 1}`}</Text>
                    <Text style={styles.resultMeta}>
                      {option.eta} min | {option.distance_km} km | Tap to monitor
                    </Text>
                  </View>
                  <Ionicons
                    name={isSelectedRoute ? 'shield-checkmark' : 'navigate-circle-outline'}
                    size={20}
                    color={isSelectedRoute ? '#2f9e44' : '#7b57d1'}
                  />
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}

        {alternativeCoordinates.length > 0 && route.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Switch Route</Text>
            <Text style={styles.cardSubtitle}>
              If she intentionally changes route, switch here so monitoring follows the new path.
            </Text>

            {alternativeCoordinates.map((alternative, index) => (
              <TouchableOpacity
                key={`route-option-${index}`}
                style={styles.alternativeCard}
                onPress={() => switchToAlternative(index)}
              >
                <View>
                  <Text style={styles.resultName}>Route {index + 1}</Text>
                  <Text style={styles.resultMeta}>
                    {alternative.eta} min | {alternative.distance_km} km
                  </Text>
                </View>
                <Ionicons name="swap-horizontal-outline" size={18} color="#7b57d1" />
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <Modal visible={Boolean(safetyPrompt)} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.alertIconWrap}>
              <Ionicons name="warning" size={30} color="#fff" />
            </View>
            <Text style={styles.modalTitle}>{safetyPrompt?.title || 'Are you safe?'}</Text>
            <Text style={styles.modalBody}>{safetyPrompt?.message}</Text>

            {safetyPrompt?.type === 'deviation' ? (
              <View style={styles.modalMicCard}>
                <View style={styles.modalMicHeader}>
                  <View style={styles.modalMicTitleRow}>
                    <Ionicons
                      name={audioDebugState.isAnalyzing ? 'mic' : 'mic-off'}
                      size={18}
                      color={audioDebugState.isAnalyzing ? '#7b57d1' : '#8f8f96'}
                    />
                    <Text style={styles.modalMicTitle}>Emergency microphone</Text>
                  </View>
                  <View
                    style={[
                      styles.modalMicBadge,
                      audioDebugState.isAnalyzing && styles.modalMicBadgeActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.modalMicBadgeText,
                        audioDebugState.isAnalyzing && styles.modalMicBadgeTextActive,
                      ]}
                    >
                      {audioDebugState.isAnalyzing ? 'Listening' : 'Stopped'}
                    </Text>
                  </View>
                </View>

                <Text style={styles.modalMicText}>
                  Audio monitoring stays on automatically during deviation until safety is confirmed or emergency audio is detected.
                </Text>

                <Text style={styles.modalMicMeta}>
                  Meter: {formatAudioMeterValue(audioDebugState.latestMetering)} | Avg: {formatAudioMeterValue(audioDebugState.averageMetering)}
                </Text>
              </View>
            ) : null}

            {isDeviationAudioUiVisible && safetyPrompt?.type === 'deviation' ? (
              <View style={styles.debugCard}>
                <View style={styles.debugHeader}>
                  <View>
                    <Text style={styles.cardTitle}>Emergency Audio Debug</Text>
                    <Text style={styles.cardSubtitle}>
                      Simulation is available only while route deviation escalation is active.
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.debugBadge,
                      audioDebugState.isAnalyzing && styles.debugBadgeActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.debugBadgeText,
                        audioDebugState.isAnalyzing && styles.debugBadgeTextActive,
                      ]}
                    >
                      {audioDebugState.isAnalyzing ? 'Listening' : 'Stopped'}
                    </Text>
                  </View>
                </View>

                <View style={styles.debugBlock}>
                  <Text style={styles.debugLabel}>Last Transcript</Text>
                  <Text style={styles.debugValue}>
                    {audioDebugState.lastTranscript || 'No transcript yet'}
                  </Text>
                </View>

                <View style={styles.debugBlock}>
                  <Text style={styles.debugLabel}>Matched Keywords</Text>
                  <Text style={styles.debugValue}>
                    {audioDebugState.matchedKeywords?.length
                      ? audioDebugState.matchedKeywords.join(', ')
                      : 'None'}
                  </Text>
                </View>

                <View style={styles.debugBlock}>
                  <Text style={styles.debugLabel}>Last Event</Text>
                  <Text style={styles.debugValue}>{audioDebugState.lastEvent || 'idle'}</Text>
                </View>

                <TextInput
                  value={audioSimulationInput}
                  onChangeText={setAudioSimulationInput}
                  placeholder="Simulate transcript"
                  placeholderTextColor="#9f9bb2"
                  style={styles.debugInput}
                />

                <View style={styles.debugActionRow}>
                  <TouchableOpacity
                    style={styles.debugActionButton}
                    onPress={() => {
                      AudioAnalysisService.simulateTranscript(audioSimulationInput);
                    }}
                  >
                    <Text style={styles.debugActionText}>Run Simulation</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.debugActionButton, styles.debugActionButtonSecondary]}
                    onPress={() => {
                      setAudioSimulationInput('');
                    }}
                  >
                    <Text style={styles.debugActionTextSecondary}>Clear</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            <TouchableOpacity
              style={styles.modalPrimary}
              onPress={sendPromptSOS}
            >
              <Text style={styles.modalPrimaryText}>Send SOS</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.modalSecondary}
              onPress={handleSafePress}
            >
              <Text style={styles.modalSecondaryText}>I am safe</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={Boolean(safeReasonPrompt)} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={[styles.alertIconWrap, styles.safeReasonIconWrap]}>
              <Ionicons name="create-outline" size={28} color="#fff" />
            </View>
            <Text style={styles.modalTitle}>{safeReasonModalContent.title}</Text>
            <Text style={styles.modalBody}>{safeReasonModalContent.body}</Text>
            <Text style={styles.securityCaption}>{SECURITY_PASSWORD_DESCRIPTION}</Text>

            {safeReasonPrompt?.type === 'deviation' ? (
              <View style={styles.modalMicCard}>
                <View style={styles.modalMicHeader}>
                  <View style={styles.modalMicTitleRow}>
                    <Ionicons
                      name={audioDebugState.isAnalyzing ? 'mic' : 'mic-off'}
                      size={18}
                      color={audioDebugState.isAnalyzing ? '#7b57d1' : '#8f8f96'}
                    />
                    <Text style={styles.modalMicTitle}>Emergency microphone</Text>
                  </View>
                  <View
                    style={[
                      styles.modalMicBadge,
                      audioDebugState.isAnalyzing && styles.modalMicBadgeActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.modalMicBadgeText,
                        audioDebugState.isAnalyzing && styles.modalMicBadgeTextActive,
                      ]}
                    >
                      {audioDebugState.isAnalyzing ? 'Listening' : 'Stopped'}
                    </Text>
                  </View>
                </View>

                <Text style={styles.modalMicMeta}>
                  Meter: {formatAudioMeterValue(audioDebugState.latestMetering)} | Avg: {formatAudioMeterValue(audioDebugState.averageMetering)}
                </Text>
              </View>
            ) : null}

            {isDeviationAudioUiVisible && safeReasonPrompt?.type === 'deviation' ? (
              <View style={styles.debugCard}>
                <View style={styles.debugHeader}>
                  <View>
                    <Text style={styles.cardTitle}>Emergency Audio Debug</Text>
                    <Text style={styles.cardSubtitle}>
                      Route deviation is active, so simulation is available here.
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.debugBadge,
                      audioDebugState.isAnalyzing && styles.debugBadgeActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.debugBadgeText,
                        audioDebugState.isAnalyzing && styles.debugBadgeTextActive,
                      ]}
                    >
                      {audioDebugState.isAnalyzing ? 'Listening' : 'Stopped'}
                    </Text>
                  </View>
                </View>

                <View style={styles.debugBlock}>
                  <Text style={styles.debugLabel}>Last Transcript</Text>
                  <Text style={styles.debugValue}>
                    {audioDebugState.lastTranscript || 'No transcript yet'}
                  </Text>
                </View>

                <View style={styles.debugBlock}>
                  <Text style={styles.debugLabel}>Matched Keywords</Text>
                  <Text style={styles.debugValue}>
                    {audioDebugState.matchedKeywords?.length
                      ? audioDebugState.matchedKeywords.join(', ')
                      : 'None'}
                  </Text>
                </View>

                <TextInput
                  value={audioSimulationInput}
                  onChangeText={setAudioSimulationInput}
                  placeholder="Simulate transcript"
                  placeholderTextColor="#9a93ad"
                  style={styles.debugInput}
                />

                <View style={styles.debugActionRow}>
                  <TouchableOpacity
                    style={styles.debugActionButton}
                    onPress={() => {
                      AudioAnalysisService.simulateTranscript(audioSimulationInput);
                    }}
                  >
                    <Text style={styles.debugActionText}>Run Simulation</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.debugActionButton, styles.debugActionButtonSecondary]}
                    onPress={() => {
                      setAudioSimulationInput('');
                    }}
                  >
                    <Text style={styles.debugActionTextSecondary}>Clear</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            <View style={styles.reasonChipRow}>
              {safeReasonModalContent.options.map((option) => (
                <TouchableOpacity
                  key={option}
                  style={styles.reasonChip}
                  onPress={() => setSafeReasonText(option)}
                >
                  <Text style={styles.reasonChipText}>{option}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              value={safeReasonText}
              onChangeText={setSafeReasonText}
              placeholder={safeReasonModalContent.placeholder}
              placeholderTextColor="#9a93ad"
              style={styles.reasonInput}
              multiline
            />

            <TextInput
              value={safeReasonPassword}
              onChangeText={setSafeReasonPassword}
              placeholder="Enter safety password"
              placeholderTextColor="#9a93ad"
              style={styles.passwordInput}
              secureTextEntry
            />

            <TouchableOpacity
              style={[
                styles.modalPrimary,
                (!safeReasonText.trim() || !safeReasonPassword.trim()) && styles.buttonDisabled,
              ]}
              onPress={submitSafeReason}
              disabled={!safeReasonText.trim() || !safeReasonPassword.trim()}
            >
              <Text style={styles.modalPrimaryText}>Submit reason</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.modalSecondary}
              onPress={() => {
                setSafeReasonPrompt(null);
                setSafeReasonText('');
                setSafeReasonPassword('');
                setSafetyPrompt(safeReasonPrompt);
              }}
            >
              <Text style={styles.modalSecondaryText}>Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f7f3ff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111',
  },
  shareButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#f0e9ff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mapWrap: {
    width: width - 24,
    alignSelf: 'center',
    marginBottom: 16,
    position: 'relative',
  },
  map: {
    width: '100%',
    height: 250,
    borderRadius: 28,
  },
  mapZoomControls: {
    position: 'absolute',
    right: 14,
    top: 14,
    gap: 10,
  },
  mapZoomButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#14092c',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 8,
    elevation: 4,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 18,
    backgroundColor: '#fff',
  },
  statusChipActive: {
    backgroundColor: '#f2ebff',
  },
  statusChipDanger: {
    backgroundColor: '#fff1f1',
  },
  statusChipText: {
    color: '#5c5b66',
    fontSize: 12,
    fontWeight: '600',
  },
  statusChipTextActive: {
    color: '#7b57d1',
  },
  statusChipDangerText: {
    color: '#ef4444',
  },
  inlineNotification: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: 18,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
  },
  inlineNotificationInfo: {
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
  },
  inlineNotificationSuccess: {
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
  },
  inlineNotificationCopy: {
    flex: 1,
  },
  inlineNotificationTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#111827',
  },
  inlineNotificationText: {
    marginTop: 3,
    color: '#475569',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  debugCard: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#d8d2e8',
  },
  debugHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  debugBadge: {
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  debugBadgeActive: {
    backgroundColor: '#efe8ff',
  },
  debugBadgeText: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '800',
  },
  debugBadgeTextActive: {
    color: '#7b57d1',
  },
  debugMetricGrid: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  debugMetricCard: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: '#f8fafc',
    padding: 12,
  },
  debugMetricLabel: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  debugMetricValue: {
    marginTop: 6,
    color: '#111827',
    fontSize: 14,
    fontWeight: '800',
  },
  debugBlock: {
    marginTop: 12,
  },
  debugLabel: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  debugValue: {
    marginTop: 5,
    color: '#1f2937',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  debugInput: {
    marginTop: 14,
    borderRadius: 16,
    backgroundColor: '#f8fafc',
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: '#111',
    fontSize: 13,
    fontWeight: '600',
  },
  debugActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  debugActionButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: '#7b57d1',
    paddingVertical: 13,
  },
  debugActionButtonSecondary: {
    backgroundColor: '#f2ebff',
  },
  debugActionText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
  },
  debugActionTextSecondary: {
    color: '#6a56a6',
    fontSize: 13,
    fontWeight: '800',
  },
  modalMicCard: {
    width: '100%',
    marginTop: 18,
    borderRadius: 18,
    backgroundColor: '#f8f5ff',
    padding: 14,
    borderWidth: 1,
    borderColor: '#e9e1ff',
  },
  modalMicHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  modalMicTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalMicTitle: {
    color: '#24153f',
    fontSize: 14,
    fontWeight: '800',
  },
  modalMicBadge: {
    borderRadius: 999,
    backgroundColor: '#edf2f7',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  modalMicBadgeActive: {
    backgroundColor: '#efe8ff',
  },
  modalMicBadgeText: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '800',
  },
  modalMicBadgeTextActive: {
    color: '#7b57d1',
  },
  modalMicText: {
    marginTop: 10,
    color: '#5c5b66',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  modalMicMeta: {
    marginTop: 10,
    color: '#6a56a6',
    fontSize: 12,
    fontWeight: '700',
  },
  vehicleScanLoadingRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  vehicleScanLoadingText: {
    color: '#6b6480',
    fontSize: 12,
    fontWeight: '700',
  },
  linkedVehicleCard: {
    marginTop: 14,
    borderRadius: 18,
    backgroundColor: '#f9f7ff',
    padding: 14,
    borderWidth: 1,
    borderColor: '#e9e1ff',
  },
  linkedVehicleHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  linkedVehicleTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#24153f',
  },
  linkedVehicleMeta: {
    marginTop: 5,
    fontSize: 12,
    color: '#6f6790',
    fontWeight: '700',
    lineHeight: 18,
  },
  linkedVehicleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: '#efe8ff',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  linkedVehicleBadgeText: {
    color: '#7b57d1',
    fontSize: 11,
    fontWeight: '800',
  },
  linkedVehicleInfoGrid: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  linkedVehicleInfoCard: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  linkedVehicleInfoLabel: {
    color: '#8f8f96',
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  linkedVehicleInfoValue: {
    marginTop: 5,
    color: '#1f1533',
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 17,
  },
  linkedVehicleNote: {
    marginTop: 10,
    color: '#5c5b66',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 18,
    marginBottom: 16,
    shadowColor: '#14092c',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.05,
    shadowRadius: 18,
    elevation: 4,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#111',
  },
  cardSubtitle: {
    marginTop: 6,
    color: '#8f8f96',
    fontSize: 13,
    lineHeight: 19,
  },
  testCard: {
    backgroundColor: '#fff8ed',
    borderRadius: 24,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#ffd8a8',
  },
  testHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  testBadge: {
    borderRadius: 999,
    backgroundColor: '#f97316',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  testBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
  },
  testInputRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  testInput: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: '#111',
    fontSize: 13,
    fontWeight: '600',
    borderWidth: 1,
    borderColor: '#ffe0ba',
  },
  testButtonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  testPrimaryButton: {
    flex: 1.4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 16,
    backgroundColor: '#f97316',
    paddingVertical: 13,
  },
  testPrimaryText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
  },
  testSecondaryButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: '#fff',
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: '#ffd8a8',
  },
  testSecondaryText: {
    color: '#9a4b00',
    fontSize: 13,
    fontWeight: '800',
  },
  testHint: {
    marginTop: 12,
    color: '#9a6a35',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
  },
  vehicleInputGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 16,
  },
  vehicleInput: {
    width: '48%',
    borderRadius: 16,
    backgroundColor: '#f7f3ff',
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: '#111',
    fontSize: 13,
    fontWeight: '600',
  },
  vehicleNoteInput: {
    marginTop: 12,
    borderRadius: 18,
    backgroundColor: '#f7f3ff',
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: '#111',
    fontSize: 13,
    minHeight: 88,
    textAlignVertical: 'top',
  },
  vehicleObservationList: {
    marginTop: 14,
    gap: 10,
  },
  vehicleObservationCard: {
    borderRadius: 18,
    backgroundColor: '#f9f7ff',
    padding: 14,
    borderWidth: 1,
    borderColor: '#e9e1ff',
  },
  vehicleObservationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  vehicleObservationTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#2d2150',
  },
  vehicleObservationTime: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8f8f96',
  },
  vehicleObservationMeta: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '700',
    color: '#5b4f83',
    lineHeight: 18,
  },
  vehicleObservationNote: {
    marginTop: 8,
    fontSize: 12,
    color: '#5c5b66',
    lineHeight: 18,
    fontWeight: '600',
  },
  input: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: '#f7f3ff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#111',
    fontSize: 14,
    fontWeight: '500',
  },
  searchButton: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#7b57d1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    marginTop: 10,
    color: '#ef4444',
    fontSize: 13,
    fontWeight: '600',
  },
  resultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#f9f7ff',
    borderRadius: 18,
    padding: 14,
    marginTop: 12,
  },
  resultTextWrap: {
    flex: 1,
  },
  resultName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1e1c26',
  },
  resultMeta: {
    marginTop: 4,
    fontSize: 12,
    color: '#8f8f96',
  },
  resultActionText: {
    color: '#7b57d1',
    fontSize: 12,
    fontWeight: '800',
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
    marginTop: 16,
  },
  metricCard: {
    width: '48%',
    borderRadius: 18,
    backgroundColor: '#f8f5ff',
    padding: 14,
  },
  metricLabel: {
    fontSize: 12,
    color: '#8f8f96',
    fontWeight: '600',
  },
  metricValue: {
    marginTop: 6,
    fontSize: 20,
    fontWeight: '800',
    color: '#1a0533',
  },
  metricDanger: {
    color: '#ef4444',
  },
  selectedDestinationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 18,
    backgroundColor: '#f3edff',
    padding: 12,
    marginTop: 14,
  },
  selectedDestinationText: {
    flex: 1,
    fontSize: 13,
    color: '#463b68',
    fontWeight: '600',
  },
  crimeZoneAlertCard: {
    marginTop: 16,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  crimeZoneAlertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  crimeZoneAlertTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#b91c1c',
  },
  crimeZoneAlertName: {
    marginTop: 8,
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
  },
  crimeZoneAlertRisk: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '700',
  },
  crimeZoneAlertDescription: {
    marginTop: 8,
    color: '#5b5563',
    fontSize: 12,
    lineHeight: 18,
  },
  crimeZoneAlertWhy: {
    marginTop: 8,
    color: '#7f1d1d',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  nearbyCrimeZoneRow: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#f3d4d4',
  },
  nearbyCrimeZoneName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1f2937',
  },
  nearbyCrimeZoneMeta: {
    marginTop: 3,
    fontSize: 11,
    fontWeight: '700',
  },
  nearbyCrimeZoneReason: {
    marginTop: 4,
    color: '#5b5563',
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
  },
  crimeZoneSafeCard: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 18,
    padding: 14,
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  crimeZoneSafeText: {
    flex: 1,
    color: '#166534',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  locationMeta: {
    marginTop: 12,
    color: '#8f8f96',
    fontSize: 12,
    lineHeight: 18,
  },
  controlRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  primaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 18,
    backgroundColor: '#7b57d1',
    paddingVertical: 14,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 18,
    backgroundColor: '#fff2f2',
    paddingHorizontal: 16,
  },
  secondaryButtonText: {
    color: '#f13a35',
    fontSize: 14,
    fontWeight: '700',
  },
  endJourneyButton: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 18,
    backgroundColor: '#fff1f3',
    paddingVertical: 13,
  },
  endJourneyText: {
    color: '#6f3440',
    fontSize: 14,
    fontWeight: '800',
  },
  alternativeCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 18,
    backgroundColor: '#f9f7ff',
    padding: 14,
    marginTop: 12,
  },
  selectedRouteOption: {
    borderWidth: 1.5,
    borderColor: '#49d160',
    backgroundColor: '#f1fff4',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(23, 15, 37, 0.55)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 28,
    padding: 24,
    alignItems: 'center',
  },
  alertIconWrap: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#ef4444',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  safeReasonIconWrap: {
    backgroundColor: '#7b57d1',
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111',
  },
  modalBody: {
    marginTop: 10,
    textAlign: 'center',
    color: '#676473',
    fontSize: 14,
    lineHeight: 21,
  },
  securityCaption: {
    marginTop: 10,
    textAlign: 'center',
    color: '#6a56a6',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  modalPrimary: {
    marginTop: 22,
    width: '100%',
    borderRadius: 18,
    backgroundColor: '#ef4444',
    paddingVertical: 14,
    alignItems: 'center',
  },
  modalPrimaryText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
  modalSecondary: {
    marginTop: 12,
    width: '100%',
    borderRadius: 18,
    backgroundColor: '#f6f3ff',
    paddingVertical: 14,
    alignItems: 'center',
  },
  modalSecondaryText: {
    color: '#6a56a6',
    fontSize: 15,
    fontWeight: '700',
  },
  reasonChipRow: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 18,
  },
  reasonChip: {
    borderRadius: 999,
    backgroundColor: '#f3edff',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  reasonChipText: {
    color: '#6a56a6',
    fontSize: 12,
    fontWeight: '700',
  },
  reasonInput: {
    width: '100%',
    minHeight: 100,
    marginTop: 14,
    borderRadius: 18,
    backgroundColor: '#f7f3ff',
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: '#111',
    fontSize: 14,
    textAlignVertical: 'top',
  },
  passwordInput: {
    width: '100%',
    marginTop: 14,
    borderRadius: 18,
    backgroundColor: '#f7f3ff',
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: '#111',
    fontSize: 14,
  },
});
