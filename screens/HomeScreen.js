import React, { useCallback, useState, useEffect } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../context/AuthContext';
import notificationsAPI from '../services/notifications';
import { getLatestIncidentReport } from '../services/reportStorage';
import { calculateRiskPercentage, getSafetyRecommendations } from '../services/riskAssessment';

const { width } = Dimensions.get('window');
const HOME_SOS_TAP_REQUIRED = 3;
const HOME_SOS_TAP_WINDOW_MS = 2000;

const actionCards = [
  {
    key: 'scan',
    icon: 'camera-outline',
    title: 'Vehicle Scan',
    subtitle: 'Scan number plate quickly',
    tint: '#7b57d1',
    background: '#f3edff',
  },
  {
    key: 'journey',
    icon: 'map-outline',
    title: 'Journey Track',
    subtitle: 'Enter destination and track walking safely',
    tint: '#0f9d7a',
    background: '#e9fbf4',
  },
  {
    key: 'contacts',
    icon: 'people-outline',
    title: 'Emergency Help',
    subtitle: 'Reach trusted contacts faster',
    tint: '#ea580c',
    background: '#fff1e8',
  },
  {
    key: 'reports',
    icon: 'document-text-outline',
    title: 'Reports',
    subtitle: 'Save incidents and evidence',
    tint: '#2563eb',
    background: '#ebf3ff',
  },
];

const navItems = [
  { key: 'Home', icon: 'home', label: 'Home' },
  { key: 'Journey', icon: 'location-outline', label: 'Journey' },
  { key: 'EmergencyContacts', icon: 'people-outline', label: 'Contacts' },
  { key: 'IncidentReport', icon: 'document-text-outline', label: 'Reports' },
  { key: 'Settings', icon: 'settings-outline', label: 'Settings' },
];

const formatActivityTime = (value) => {
  if (!value) return 'Recent';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Recent';
  }

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(1, Math.round(diffMs / 60000));

  if (diffMinutes < 60) {
    return `${diffMinutes} min ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} hr ago`;
  }

  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
  }).format(date);
};

export default function HomeScreen({ navigation }) {
  const { user } = useAuth();
  const displayName = user?.displayName || user?.name || 'User';
  const avatarLetter = displayName.trim().charAt(0).toUpperCase() || 'U';
  const [recentActivity, setRecentActivity] = useState([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [riskData, setRiskData] = useState(null);
  const [riskLoading, setRiskLoading] = useState(true);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [journeyData, setJourneyData] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [sosTapCount, setSosTapCount] = useState(0);
  const locationTrackerRef = React.useRef(null);
  const sosTapResetTimerRef = React.useRef(null);

  const loadRecentActivity = useCallback(async () => {
    setActivityLoading(true);

    try {
      const data = await notificationsAPI.list();
      setRecentActivity((data || []).slice(0, 3));
    } catch {
      setRecentActivity([]);
    } finally {
      setActivityLoading(false);
    }
  }, []);

  // Load journey data if active
  const loadJourneyData = useCallback(async () => {
    try {
      const journeyJSON = await AsyncStorage.getItem('@abhaya_active_journey');
      if (journeyJSON) {
        const journey = JSON.parse(journeyJSON);
        
        // Journey is active if it has a route with points
        const isActive = Array.isArray(journey.route) && journey.route.length > 0;
        
        // Prepare the journey data with proper structure for risk calculation
        const journeyData = {
          isActive,
          plannedRoute: isActive ? journey.route : [],
          destination: journey.selectedDestination || null,
          historyId: journey.activeHistoryId || null,
          eta: journey.eta,
          distanceKm: journey.distanceKm,
        };
        
        setJourneyData(journeyData);
      } else {
        setJourneyData(null);
      }
    } catch (error) {
      console.log('Error loading journey:', error);
      setJourneyData(null);
    }
  }, []);

  // Start location tracking
  const startLocationTracking = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        console.log('Location permission denied');
        // Set default Kolhapur location for testing
        setCurrentLocation({
          latitude: 16.7050,
          longitude: 74.2433,
        });
        return;
      }

      // Get initial location
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const newLocation = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      };

      setCurrentLocation(newLocation);

      // Watch location updates every 5 seconds for better updates
      locationTrackerRef.current = 'location-tracker-home';
      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 5000,
          distanceInterval: 10,
        },
        (location) => {
          const updatedLocation = {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
          };
          setCurrentLocation(updatedLocation);
        }
      );

      return subscription;
    } catch (error) {
      console.log('Location tracking error:', error);
      // Fallback to Kolhapur center for testing
      setCurrentLocation({
        latitude: 16.7050,
        longitude: 74.2433,
      });
    }
  }, []);

  // Calculate risk whenever location or journey changes
  useEffect(() => {
    if (currentLocation) {
      const risk = calculateRiskPercentage(currentLocation, journeyData);
      setRiskData(risk);
      setRiskLoading(false);

      // Generate recommendations
      const recs = getSafetyRecommendations(risk);
      setRecommendations(recs);
    }
  }, [currentLocation, journeyData]);

  // Refresh risk every minute to account for time changes
  useEffect(() => {
    const interval = setInterval(() => {
      if (currentLocation) {
        const risk = calculateRiskPercentage(currentLocation, journeyData);
        setRiskData(risk);

        // Generate recommendations
        const recs = getSafetyRecommendations(risk);
        setRecommendations(recs);
      }
    }, 60000); // Refresh every 60 seconds

    return () => clearInterval(interval);
  }, [currentLocation, journeyData]);

  // Setup location tracking on mount
  useEffect(() => {
    let subscription;

    const setup = async () => {
      subscription = await startLocationTracking();
      await loadJourneyData();
    };

    setup();

    return () => {
      if (subscription && subscription.remove) {
        subscription.remove();
      }
    };
  }, [startLocationTracking, loadJourneyData]);

  useFocusEffect(
    useCallback(() => {
      loadRecentActivity();
      loadJourneyData();
    }, [loadRecentActivity, loadJourneyData])
  );

  useEffect(() => () => {
    if (sosTapResetTimerRef.current) {
      clearTimeout(sosTapResetTimerRef.current);
      sosTapResetTimerRef.current = null;
    }
  }, []);

  const launchHomeSosFlow = useCallback(() => {
    Alert.alert('SOS Activated', 'Emergency detected. Recording started.', [
      {
        text: 'OK',
        onPress: () =>
          navigation.navigate('IncidentReport', {
            autoStartEvidence: true,
            triggerType: 'SOS',
          }),
      },
    ]);
  }, [navigation]);

  const handleSosPress = useCallback(() => {
    const nextCount = sosTapCount + 1;

    if (sosTapResetTimerRef.current) {
      clearTimeout(sosTapResetTimerRef.current);
      sosTapResetTimerRef.current = null;
    }

    if (nextCount >= HOME_SOS_TAP_REQUIRED) {
      setSosTapCount(0);
      launchHomeSosFlow();
      return;
    }

    setSosTapCount(nextCount);
    sosTapResetTimerRef.current = setTimeout(() => {
      setSosTapCount(0);
      sosTapResetTimerRef.current = null;
    }, HOME_SOS_TAP_WINDOW_MS);
  }, [launchHomeSosFlow, sosTapCount]);

  const openReportsSection = useCallback(async () => {
    try {
      const latest = await getLatestIncidentReport();
      const latestReport = latest?.data || null;

      if (latestReport?.incidentId) {
        navigation.navigate('ReportDetails', {
          incidentId: latestReport.incidentId,
          report: latestReport,
        });
        return;
      }

      navigation.navigate('IncidentReport');
    } catch {
      navigation.navigate('IncidentReport');
    }
  }, [navigation]);

  const handleActionPress = (key) => {
    if (key === 'scan') {
      navigation.navigate('VehicleScan');
      return;
    }

    if (key === 'contacts') {
      navigation.navigate('EmergencyContacts');
      return;
    }

    if (key === 'journey') {
      navigation.navigate('Journey', { mode: 'walking', linkedVehicleScan: null });
      return;
    }

    if (key === 'reports') {
      openReportsSection();
      return;
    }

    Alert.alert('Coming Soon', 'This feature is part of the frontend layout and can be wired next.');
  };

  const handleNavPress = (key) => {
    if (key === 'Home') {
      return;
    }

    if (key === 'IncidentReport') {
      openReportsSection();
      return;
    }

    if (key === 'EmergencyContacts' || key === 'Settings') {
      navigation.navigate(key);
      return;
    }

    if (key === 'Journey') {
      navigation.navigate('Journey', { mode: 'walking', linkedVehicleScan: null });
      return;
    }

    Alert.alert('Coming Soon', 'This section is not wired yet.');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#f7f3ff" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.greeting}>Hi {displayName.split(' ')[0]}</Text>
            <Text style={styles.subGreeting}>Everything important is one tap away</Text>
          </View>

          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.headerIconButton}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('Notifications')}
            >
              <Ionicons name="notifications-outline" size={22} color="#1f1f1f" />
              <View style={styles.notificationDot} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.avatar}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('Settings')}
            >
              <Text style={styles.avatarText}>{avatarLetter}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Ionicons name="location" size={14} color="#ff5d4d" />
            <Text style={styles.metaText}>Safety dashboard ready</Text>
          </View>
          <View style={styles.metaItem}>
            <Ionicons name="cloud-outline" size={14} color="#7b57d1" />
            <Text style={styles.metaText}>Abhaya</Text>
          </View>
        </View>

        <View style={styles.quickStatusRow}>
          <View style={styles.quickStatusCard}>
            <Text style={styles.quickStatusLabel}>Quick access</Text>
            <Text style={styles.quickStatusValue}>4 actions ready</Text>
          </View>
          <TouchableOpacity
            activeOpacity={0.88}
            style={styles.historyShortcut}
            onPress={() => navigation.navigate('JourneyHistory')}
          >
            <Ionicons name="time-outline" size={18} color="#7b57d1" />
            <Text style={styles.historyShortcutText}>Journey history</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.safetyCard}>
          <View style={styles.safetyHeader}>
            <View style={styles.safeTitleWrap}>
              <View
                style={[
                  styles.safeDot,
                  {
                    backgroundColor:
                      riskData && riskData.percentage > 50 ? '#ef4444' : '#49d160',
                  },
                ]}
              />
              <Text style={styles.safetyTitle}>
                {riskData ? (riskData.percentage > 50 ? 'Stay Alert' : 'You are Safe') : 'Assessing...'}
              </Text>
            </View>

            <View
              style={[
                styles.darkChip,
                {
                  backgroundColor:
                    riskData && riskData.percentage > 50
                      ? 'rgba(239, 68, 68, 0.2)'
                      : 'rgba(255,255,255,0.14)',
                },
              ]}
            >
              <Ionicons
                name={
                  riskData && riskData.percentage > 50
                    ? 'warning-outline'
                    : 'moon'
                }
                size={12}
                color={riskData && riskData.percentage > 50 ? '#fca5a5' : '#f8d664'}
              />
              <Text style={styles.darkChipText}>{riskData?.timeOfDay || 'Loading'}</Text>
            </View>
          </View>

          <View style={styles.safetyBody}>
            <View
              style={[
                styles.riskRing,
                {
                  borderColor: riskData?.color || '#49d160',
                  borderRightColor: riskData?.color
                    ? `${riskData.color}40`
                    : 'rgba(255,255,255,0.18)',
                  borderBottomColor: riskData?.color
                    ? `${riskData.color}40`
                    : 'rgba(255,255,255,0.18)',
                },
              ]}
            >
              <Text style={styles.riskValue}>
                {riskLoading ? '...' : `${riskData?.percentage || 0}%`}
              </Text>
              <Text style={styles.riskLabel}>{riskData?.level || 'Risk'}</Text>
            </View>

            <View style={styles.riskDetails}>
              <Text style={styles.riskHeading}>Risk Indicators</Text>

              <View style={styles.riskBulletRow}>
                <View
                  style={[
                    styles.riskBullet,
                    { backgroundColor: riskData?.locationRisk > 50 ? '#fca5a5' : '#49d160' },
                  ]}
                />
                <Text style={styles.riskBulletText}>
                  Location: {riskData?.locationRisk || 0}% risk
                </Text>
              </View>

              {riskData?.insideDangerZone ? (
                <View style={styles.riskBulletRow}>
                  <View style={[styles.riskBullet, { backgroundColor: '#fca5a5' }]} />
                  <Text style={styles.riskBulletText}>
                    Danger zone: Inside {riskData?.activeZone?.name || 'high-risk area'}
                  </Text>
                </View>
              ) : null}

              <View style={styles.riskBulletRow}>
                <View style={[styles.riskBullet, { backgroundColor: riskData?.timeRisk > 50 ? '#fca5a5' : '#49d160' }]} />
                <Text style={styles.riskBulletText}>
                  Time: {riskData?.timeOfDay} ({riskData?.timeRisk || 0}% risk)
                </Text>
              </View>

              <View style={styles.riskBulletRow}>
                <View
                  style={[
                    styles.riskBullet,
                    {
                      backgroundColor: riskData?.activityRisk > 50 ? '#fca5a5' : '#49d160',
                    },
                  ]}
                />
                <Text style={styles.riskBulletText}>
                  Activity: {riskData?.activityRisk || 0}% risk
                </Text>
              </View>
            </View>
          </View>

          {/* Nearby Zones */}
          {riskData?.nearbyZones && riskData.nearbyZones.length > 0 && (
            <View style={styles.nearbyZonesContainer}>
              <Text style={styles.nearbyZonesTitle}>⚠️ Nearby High-Risk Zones</Text>
              {riskData.nearbyZones.map((zone, idx) => (
                <View key={idx} style={styles.zoneItem}>
                  <Text style={styles.zoneName}>{zone.name}</Text>
                  <Text style={styles.zoneDistance}>{zone.distance}m away</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Safety Recommendations */}
        {recommendations.length > 0 && (
          <View style={styles.recommendationsCard}>
            <Text style={styles.recommendationsTitle}>Safety Tips</Text>
            {recommendations.slice(0, 2).map((rec, idx) => (
              <Text key={idx} style={styles.recommendationText}>
                {rec}
              </Text>
            ))}
          </View>
        )}

        <View style={styles.grid}>
          {actionCards.map((card) => (
            <TouchableOpacity
              key={card.key}
              activeOpacity={0.88}
              style={styles.actionCard}
              onPress={() => handleActionPress(card.key)}
            >
              <View style={styles.actionCardTop}>
                <View
                  style={[
                    styles.actionIconWrap,
                    { backgroundColor: card.background },
                  ]}
                >
                  <Ionicons name={card.icon} size={24} color={card.tint} />
                </View>
                <View style={styles.actionArrow}>
                  <Ionicons name="arrow-forward" size={16} color="#9f96b5" />
                </View>
              </View>
              <Text style={styles.actionTitle}>{card.title}</Text>
              <Text style={styles.actionSubtitle}>{card.subtitle}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          activeOpacity={0.9}
          style={styles.sosWrap}
          onPress={handleSosPress}
        >
          <View style={styles.sosButton}>
            <Ionicons name="alert-circle-outline" size={52} color="#fff" />
            <Text style={styles.sosText}>SOS</Text>
          </View>
        </TouchableOpacity>

        <Text style={styles.sosHint}>
          {sosTapCount > 0
            ? `Tap ${HOME_SOS_TAP_REQUIRED - sosTapCount} more time${HOME_SOS_TAP_REQUIRED - sosTapCount === 1 ? '' : 's'} to activate emergency`
            : 'Tap SOS 3 times to activate emergency'}
        </Text>

        <View style={styles.activityCard}>
          <View style={styles.activityHeader}>
            <Text style={styles.activityTitle}>Recent Activity</Text>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => navigation.navigate('Notifications')}
            >
              <Ionicons name="chevron-forward" size={18} color="#9d9d9d" />
            </TouchableOpacity>
          </View>

          {activityLoading ? (
            <View style={styles.activityLoadingRow}>
              <ActivityIndicator size="small" color="#7b57d1" />
              <Text style={styles.activityLoadingText}>Loading recent updates...</Text>
            </View>
          ) : null}

          {!activityLoading && recentActivity.length === 0 ? (
            <Text style={styles.activityText}>
              No recent activity yet. Start a journey or scan a vehicle to see updates here.
            </Text>
          ) : null}

          {!activityLoading &&
            recentActivity.map((item) => (
              <View key={item.id} style={styles.activityRow}>
                <View style={[styles.activityIconWrap, { backgroundColor: item.background }]}>
                  <Ionicons name={item.icon} size={18} color={item.tint} />
                </View>
                <View style={styles.activityCopy}>
                  <View style={styles.activityTopRow}>
                    <Text style={styles.activityItemTitle}>{item.title}</Text>
                    <Text style={styles.activityTime}>{formatActivityTime(item.createdAt)}</Text>
                  </View>
                  <Text style={styles.activityItemText}>{item.message}</Text>
                </View>
              </View>
            ))}
        </View>
      </ScrollView>

      <View style={styles.bottomNav}>
        {navItems.map((item) => {
          const active = item.key === 'Home';

          return (
            <TouchableOpacity
              key={item.key}
              activeOpacity={0.85}
              style={[styles.navItem, active && styles.navItemActive]}
              onPress={() => handleNavPress(item.key)}
            >
              <Ionicons
                name={item.icon}
                size={22}
                color={active ? '#6e44cf' : '#7f7f7f'}
              />
              <Text style={[styles.navText, active && styles.navTextActive]}>{item.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f7f3ff',
  },
  content: {
    paddingHorizontal: 24,
    paddingBottom: 130,
  },
  headerRow: {
    marginTop: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  greeting: {
    fontSize: 24,
    fontWeight: '800',
    color: '#111827',
  },
  subGreeting: {
    marginTop: 6,
    fontSize: 15,
    color: '#8f8f96',
    fontWeight: '500',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerIconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#14092c',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 3,
  },
  notificationDot: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ff5d4d',
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#8c63db',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#8c63db',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 5,
  },
  avatarText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  metaRow: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaText: {
    fontSize: 13,
    color: '#515463',
    fontWeight: '500',
  },
  quickStatusRow: {
    marginTop: 18,
    flexDirection: 'row',
    gap: 12,
  },
  quickStatusCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    shadowColor: '#14092c',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.05,
    shadowRadius: 18,
    elevation: 3,
  },
  quickStatusLabel: {
    color: '#8f8f96',
    fontSize: 12,
    fontWeight: '700',
  },
  quickStatusValue: {
    marginTop: 6,
    color: '#1f1533',
    fontSize: 16,
    fontWeight: '800',
  },
  historyShortcut: {
    width: 140,
    borderRadius: 18,
    backgroundColor: '#f3edff',
    paddingHorizontal: 14,
    paddingVertical: 14,
    justifyContent: 'center',
  },
  historyShortcutText: {
    marginTop: 8,
    color: '#6e44cf',
    fontSize: 13,
    fontWeight: '800',
  },
  safetyCard: {
    marginTop: 26,
    borderRadius: 26,
    backgroundColor: '#8a5ce4',
    padding: 20,
    shadowColor: '#8a5ce4',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.22,
    shadowRadius: 22,
    elevation: 8,
  },
  safetyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  safeTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  safeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#49d160',
  },
  safetyTitle: {
    color: '#fff',
    fontSize: width < 380 ? 18 : 20,
    fontWeight: '800',
  },
  darkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  darkChipText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  safetyBody: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  riskRing: {
    width: 116,
    height: 116,
    borderRadius: 58,
    borderWidth: 8,
    borderColor: '#49d160',
    borderRightColor: 'rgba(255,255,255,0.18)',
    borderBottomColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  riskValue: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '800',
  },
  riskLabel: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 13,
    marginTop: 2,
  },
  riskDetails: {
    flex: 1,
  },
  riskHeading: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 14,
  },
  riskBulletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 9,
  },
  riskBullet: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#49d160',
  },
  riskBulletText: {
    color: 'rgba(255,255,255,0.84)',
    fontSize: 13,
    fontWeight: '500',
  },
  nearbyZonesContainer: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.2)',
  },
  nearbyZonesTitle: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 10,
  },
  zoneItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
  },
  zoneName: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  zoneDistance: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    fontWeight: '500',
  },
  recommendationsCard: {
    marginTop: 16,
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 14,
    shadowColor: '#14092c',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  recommendationsTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1f1533',
    marginBottom: 10,
  },
  recommendationText: {
    fontSize: 12,
    color: '#7f7b8d',
    fontWeight: '500',
    lineHeight: 18,
    marginBottom: 8,
  },
  grid: {
    marginTop: 18,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 14,
  },
  actionCard: {
    width: (width - 62) / 2,
    minHeight: 144,
    backgroundColor: '#fff',
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 20,
    shadowColor: '#14092c',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 4,
  },
  actionCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  actionIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionArrow: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#f8f6fc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#26242d',
  },
  actionSubtitle: {
    marginTop: 6,
    fontSize: 12,
    color: '#7f7b8d',
    fontWeight: '600',
    lineHeight: 18,
  },
  sosWrap: {
    alignSelf: 'center',
    marginTop: 26,
  },
  sosButton: {
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: '#f13a35',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#f13a35',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.32,
    shadowRadius: 28,
    elevation: 9,
  },
  sosText: {
    marginTop: 6,
    fontSize: 34,
    fontWeight: '800',
    color: '#fff',
  },
  sosHint: {
    marginTop: 14,
    textAlign: 'center',
    color: '#9b99a4',
    fontSize: 12,
    fontWeight: '500',
  },
  activityCard: {
    marginTop: 24,
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 16,
    shadowColor: '#14092c',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.07,
    shadowRadius: 24,
    elevation: 4,
  },
  activityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  activityTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#34313c',
  },
  activityText: {
    marginTop: 12,
    color: '#9a97a2',
    fontSize: 13,
    lineHeight: 18,
  },
  activityLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
  },
  activityLoadingText: {
    color: '#8f8f96',
    fontSize: 12,
    fontWeight: '700',
  },
  activityRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#f1edf8',
  },
  activityIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityCopy: {
    flex: 1,
  },
  activityTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  activityItemTitle: {
    flex: 1,
    color: '#2c2538',
    fontSize: 13,
    fontWeight: '800',
  },
  activityTime: {
    color: '#9a97a2',
    fontSize: 11,
    fontWeight: '700',
  },
  activityItemText: {
    marginTop: 5,
    color: '#7a7686',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  bottomNav: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 28,
    paddingHorizontal: 10,
    paddingVertical: 10,
    shadowColor: '#14092c',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 9,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 18,
  },
  navItemActive: {
    backgroundColor: '#f2ebff',
  },
  navText: {
    marginTop: 6,
    fontSize: 11,
    color: '#7f7f7f',
    fontWeight: '500',
  },
  navTextActive: {
    color: '#6e44cf',
    fontWeight: '700',
  },
});
