import React, { useCallback, useState } from 'react';
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

import notificationsAPI from '../services/notifications';

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

export default function NotificationsScreen({ navigation }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadNotifications = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      const cached = await notificationsAPI.getCached();
      if (cached.length) {
        setNotifications(cached);
        setLoading(false);
      } else {
        setLoading(true);
      }
    }

    try {
      const data = await notificationsAPI.list();
      setNotifications(data || []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadNotifications();
    }, [loadNotifications])
  );

  const refreshNotifications = () => {
    setRefreshing(true);
    loadNotifications({ silent: true });
  };

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
        <Text style={styles.headerTitle}>Notifications</Text>
        <TouchableOpacity onPress={refreshNotifications} style={styles.refreshButton}>
          <Ionicons name="refresh" size={19} color="#7b57d1" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refreshNotifications} />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroCard}>
          <Text style={styles.heroTitle}>Important updates in one place</Text>
          <Text style={styles.heroText}>
            Track vehicle no plate scans, journey starts, danger-area entries, SOS events,
            and safety updates from a single notification feed.
          </Text>
        </View>

        {loading ? (
          <View style={styles.centerCard}>
            <ActivityIndicator size="large" color="#7b57d1" />
            <Text style={styles.centerText}>Loading notifications...</Text>
          </View>
        ) : null}

        {!loading && notifications.length === 0 ? (
          <View style={styles.centerCard}>
            <Ionicons name="notifications-off-outline" size={32} color="#b8acd7" />
            <Text style={styles.centerTitle}>No notifications yet</Text>
            <Text style={styles.centerText}>
              New vehicle scans, journey updates, and danger-area alerts will appear here.
            </Text>
          </View>
        ) : null}

        {!loading &&
          notifications.map((item) => (
            <View key={item.id} style={styles.notificationCard}>
              <View style={[styles.iconWrap, { backgroundColor: item.background }]}>
                <Ionicons name={item.icon} size={20} color={item.tint} />
              </View>
              <View style={styles.notificationCopy}>
                <View style={styles.notificationTopRow}>
                  <Text style={styles.notificationTitle}>{item.title}</Text>
                  <Text style={styles.notificationTime}>{formatDate(item.createdAt)}</Text>
                </View>
                <Text style={styles.notificationMessage}>{item.message}</Text>
              </View>
            </View>
          ))}
      </ScrollView>
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
  heroCard: {
    backgroundColor: '#1f1533',
    borderRadius: 24,
    padding: 20,
    marginBottom: 16,
  },
  heroTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
  },
  heroText: {
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
  notificationCard: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 14,
    marginBottom: 12,
    shadowColor: '#14092c',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.04,
    shadowRadius: 14,
    elevation: 3,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationCopy: {
    flex: 1,
  },
  notificationTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  notificationTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
    color: '#22153f',
  },
  notificationTime: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8f8f96',
  },
  notificationMessage: {
    marginTop: 6,
    color: '#655f75',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
});
