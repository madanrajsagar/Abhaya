import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
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

import journeyAPI from '../services/journey';

const formatDate = (value) => {
  if (!value) return 'Recent';

  try {
    return new Intl.DateTimeFormat('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return 'Recent';
  }
};

const statusColor = {
  active: '#7b57d1',
  completed: '#2f9e44',
  ended: '#f97316',
};

const getModeLabel = (item) =>
  item?.journeyMode === 'walking' ? 'Walking' : 'Auto/Vehicle';

const getVehicleLine = (item) => {
  if (item?.journeyMode === 'walking') {
    return 'Destination-only walking tracking';
  }

  return [
    item?.plateNumber ? `Plate ${item.plateNumber}` : null,
    [item?.vehicleType, item?.vehicleBrand, item?.vehicleModel, item?.vehicleColor]
      .filter(Boolean)
      .join(' '),
  ]
    .filter(Boolean)
    .join(' | ');
};

export default function JourneyHistoryScreen({ navigation, route }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const showWalkingOnly = route?.params?.mode === 'walking';

  const loadHistory = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
    }

    setError('');

    try {
      const records = await journeyAPI.listHistory({ limit: 12, eventLimit: 'all' });
      setHistory(records || []);
    } catch (loadError) {
      setError(loadError.message || 'Could not load journey history.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadHistory();
    }, [loadHistory])
  );

  const refreshHistory = () => {
    setRefreshing(true);
    loadHistory({ silent: true });
  };

  const filteredHistory = useMemo(() => {
    if (!showWalkingOnly) {
      return history;
    }

    return history.filter((item) => {
      const events = Array.isArray(item.events) ? item.events : [];
      return item.journeyMode === 'walking' || events.some((event) => String(event.type || '').startsWith('walking_'));
    });
  }, [history, showWalkingOnly]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#fbf9ff" />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Home'))}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color="#111" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{showWalkingOnly ? 'Walked Logs' : 'Journey History'}</Text>
        <TouchableOpacity onPress={refreshHistory} style={styles.refreshButton}>
          <Ionicons name="refresh" size={19} color="#7b57d1" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refreshHistory} />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Recent route logs</Text>
          <Text style={styles.summaryText}>
            {showWalkingOnly
              ? 'Every walking session saves destination, 1 minute location logs, deviations, stops, and final completion.'
              : 'Every monitored journey saves destination, start point, route status, SOS, deviation, stationary alerts, and route switch logs.'}
          </Text>
        </View>

        {loading ? (
          <View style={styles.centerCard}>
            <ActivityIndicator size="large" color="#7b57d1" />
            <Text style={styles.centerText}>Loading journey logs...</Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorCard}>
            <Ionicons name="warning-outline" size={20} color="#ef4444" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {!loading && !error && filteredHistory.length === 0 ? (
          <View style={styles.centerCard}>
            <Ionicons name="map-outline" size={34} color="#c0afd9" />
            <Text style={styles.centerTitle}>{showWalkingOnly ? 'No walked logs yet' : 'No journeys yet'}</Text>
            <Text style={styles.centerText}>
              {showWalkingOnly
                ? 'Start a walking route and the completed walking logs will appear here.'
                : 'Start monitoring a route from Journey Guardian and it will appear here.'}
            </Text>
          </View>
        ) : null}

        {filteredHistory.map((item) => {
          const events = Array.isArray(item.events) ? item.events : [];
          const visibleEvents = [...events].reverse();
          const color = statusColor[item.status] || '#7b57d1';

          return (
            <View key={item.id} style={styles.historyCard}>
              <View style={styles.cardTopRow}>
                <View style={styles.iconCircle}>
                  <Ionicons name="navigate" size={18} color="#fff" />
                </View>
                <View style={styles.cardTitleWrap}>
                  <Text style={styles.destination} numberOfLines={2}>
                    {item.destinationName || 'Saved journey'}
                  </Text>
                  <Text style={styles.modeText}>
                    {getModeLabel(item)}{getVehicleLine(item) ? ` | ${getVehicleLine(item)}` : ''}
                  </Text>
                  <Text style={styles.timestamp}>{formatDate(item.updatedAt || item.createdAt)}</Text>
                </View>
                <View style={[styles.statusPill, { backgroundColor: `${color}18` }]}>
                  <Text style={[styles.statusText, { color }]}>{item.status || 'active'}</Text>
                </View>
              </View>

              <View style={styles.metricsRow}>
                <View style={styles.metric}>
                  <Text style={styles.metricLabel}>Distance</Text>
                  <Text style={styles.metricValue}>
                    {item.distanceKm !== null && item.distanceKm !== undefined
                      ? `${item.distanceKm} km`
                      : '--'}
                  </Text>
                </View>
                <View style={styles.metric}>
                  <Text style={styles.metricLabel}>ETA</Text>
                  <Text style={styles.metricValue}>
                    {item.eta !== null && item.eta !== undefined ? `${item.eta} min` : '--'}
                  </Text>
                </View>
                <View style={styles.metric}>
                  <Text style={styles.metricLabel}>Logs</Text>
                  <Text style={styles.metricValue}>{events.length}</Text>
                </View>
              </View>

              <Text style={styles.coordText}>
                Start: {item.startLat?.toFixed?.(5) || '--'}, {item.startLng?.toFixed?.(5) || '--'}
              </Text>

              <View style={styles.logsContainer}>
                <View style={styles.logsHeader}>
                  <Text style={styles.logsTitle}>Tracking Logs</Text>
                  <Text style={styles.logsCount}>{item.eventCount || events.length} total</Text>
                </View>

                {events.length > 0 ? (
                  <View style={styles.logList}>
                    {visibleEvents.map((event, index) => (
                      <View key={`${event.createdAt}-${index}`} style={styles.logRow}>
                        <View style={styles.logRail}>
                          <View style={styles.logDot} />
                          {index < visibleEvents.length - 1 ? <View style={styles.logLine} /> : null}
                        </View>
                        <View style={styles.logTextWrap}>
                          <Text style={styles.logType}>{String(event.type || 'event').replace(/_/g, ' ')}</Text>
                          <Text style={styles.logMessage}>{event.message || event.type}</Text>
                          <Text style={styles.logTime}>{formatDate(event.createdAt)}</Text>
                          {event.location ? (
                            <Text style={styles.logLocation}>
                              Lat {event.location.lat?.toFixed?.(5) || '--'}, Lng {event.location.lng?.toFixed?.(5) || '--'}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.emptyLogText}>No tracking logs saved for this journey.</Text>
                )}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fbf9ff',
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
  refreshButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#f0e9ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  summaryCard: {
    backgroundColor: '#1f1533',
    borderRadius: 24,
    padding: 20,
    marginBottom: 16,
  },
  summaryTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
  },
  summaryText: {
    marginTop: 8,
    color: '#d8cff0',
    lineHeight: 20,
    fontSize: 13,
  },
  centerCard: {
    backgroundColor: '#fff',
    borderRadius: 22,
    padding: 24,
    alignItems: 'center',
    marginTop: 12,
  },
  centerTitle: {
    marginTop: 10,
    fontSize: 16,
    fontWeight: '800',
    color: '#111',
  },
  centerText: {
    marginTop: 8,
    color: '#8f8f96',
    textAlign: 'center',
    lineHeight: 19,
  },
  errorCard: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#fff1f1',
    borderRadius: 18,
    padding: 14,
    marginBottom: 14,
  },
  errorText: {
    flex: 1,
    color: '#ef4444',
    fontWeight: '700',
  },
  historyCard: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 16,
    marginBottom: 14,
    shadowColor: '#14092c',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.04,
    shadowRadius: 14,
    elevation: 3,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#7b57d1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitleWrap: {
    flex: 1,
  },
  destination: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '800',
  },
  modeText: {
    marginTop: 4,
    color: '#5b4f83',
    fontSize: 11,
    fontWeight: '700',
  },
  timestamp: {
    marginTop: 4,
    color: '#8f8f96',
    fontSize: 12,
    fontWeight: '600',
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'capitalize',
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  metric: {
    flex: 1,
    backgroundColor: '#f8f5ff',
    borderRadius: 16,
    padding: 12,
  },
  metricLabel: {
    color: '#8f8f96',
    fontSize: 11,
    fontWeight: '700',
  },
  metricValue: {
    marginTop: 5,
    color: '#1a0533',
    fontSize: 15,
    fontWeight: '800',
  },
  coordText: {
    marginTop: 12,
    color: '#777383',
    fontSize: 12,
    fontWeight: '600',
  },
  logsContainer: {
    marginTop: 12,
    borderRadius: 18,
    backgroundColor: '#fbf9ff',
    borderWidth: 1,
    borderColor: '#eee8fb',
    padding: 14,
  },
  logsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  logsTitle: {
    color: '#1a0533',
    fontSize: 14,
    fontWeight: '800',
  },
  logsCount: {
    color: '#7b57d1',
    fontSize: 12,
    fontWeight: '800',
  },
  logList: {
    gap: 10,
  },
  logRow: {
    flexDirection: 'row',
    gap: 10,
  },
  logRail: {
    alignItems: 'center',
    width: 12,
  },
  logDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#7b57d1',
    marginTop: 6,
  },
  logLine: {
    flex: 1,
    width: 2,
    backgroundColor: '#ded4f2',
    marginTop: 4,
  },
  logTextWrap: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: '#fff',
    padding: 12,
  },
  logType: {
    color: '#7b57d1',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'capitalize',
  },
  logMessage: {
    marginTop: 4,
    color: '#2d2738',
    fontSize: 13,
    fontWeight: '700',
  },
  logTime: {
    marginTop: 3,
    color: '#9a98a3',
    fontSize: 11,
  },
  logLocation: {
    marginTop: 4,
    color: '#777383',
    fontSize: 11,
    fontWeight: '600',
  },
  emptyLogText: {
    color: '#8f8f96',
    fontSize: 12,
    fontWeight: '600',
  },
  moreLogsText: {
    color: '#7b57d1',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 4,
  },
});
