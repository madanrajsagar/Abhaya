import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Switch,
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import authAPI from '../services/api';
import {
  DEFAULT_SECURITY_PASSWORD,
  SECURITY_PASSWORD_DESCRIPTION,
  getSecurityPassword,
  updateSecurityPassword,
  verifySecurityPassword,
} from '../services/securityPassword';
import {
  getJourneySettings,
  updateJourneySettings,
  IDLE_THRESHOLD_OPTIONS,
  AUTO_SOS_SENSITIVITY_OPTIONS,
  EMERGENCY_ALERT_DELAY_OPTIONS,
  LOCATION_TRACKING_INTERVAL_OPTIONS,
  CRIME_ZONE_ALERT_RADIUS_OPTIONS,
} from '../services/journeySettings';

export default function SettingsScreen({ navigation }) {
  const { logout, refreshProfile, user } = useAuth();
  const [profileModalVisible, setProfileModalVisible] = useState(false);
  const [displayNameInput, setDisplayNameInput] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [securityModalVisible, setSecurityModalVisible] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSavingSecurityPassword, setIsSavingSecurityPassword] = useState(false);
  const [securityStatus, setSecurityStatus] = useState('Tap to manage your safety password');
  
  // Journey Settings States
  const [journeySettings, setJourneySettings] = useState(null);
  const [idleThresholdModal, setIdleThresholdModal] = useState(false);
  const [autoSOSModal, setAutoSOSModal] = useState(false);
  const [emergencyAlertModal, setEmergencyAlertModal] = useState(false);
  const [locationTrackingModal, setLocationTrackingModal] = useState(false);
  const [crimeZoneRadiusModal, setCrimeZoneRadiusModal] = useState(false);
  const profileName = user?.displayName?.trim() || user?.name?.trim() || 'Abhaya User';
  const profileEmail = user?.email?.trim() || 'No email available';
  const profileAvatarLetter = profileName.charAt(0).toUpperCase() || 'A';

  useEffect(() => {
    const loadSecurityStatus = async () => {
      const current = await getSecurityPassword(user?.email);
      if (current === DEFAULT_SECURITY_PASSWORD) {
        setSecurityStatus('Tap to manage your safety password');
      } else {
        setSecurityStatus('Custom safety password configured');
      }
    };

    loadSecurityStatus();
  }, [user?.email]);

  useEffect(() => {
    setDisplayNameInput(profileName);
  }, [profileName]);

  // Load journey settings when screen comes to focus
  useFocusEffect(
    useCallback(() => {
      const loadJourneySettings = async () => {
        try {
          const settings = await getJourneySettings();
          setJourneySettings(settings);
        } catch (error) {
          console.error('Error loading journey settings:', error);
        }
      };

      loadJourneySettings();
    }, [])
  );

  // Handle journey setting update
  const handleJourneySettingUpdate = async (key, value, modalSetter) => {
    try {
      await updateJourneySettings(key, value);
      const updated = await getJourneySettings();
      setJourneySettings(updated);
      modalSetter(false);
    } catch (error) {
      Alert.alert('Error', 'Failed to update journey setting. Please try again.');
    }
  };

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: async () => await logout() },
    ]);
  };

  const closeProfileModal = () => {
    setProfileModalVisible(false);
    setDisplayNameInput(profileName);
    setIsSavingProfile(false);
  };

  const handleUpdateProfile = async () => {
    const trimmedName = displayNameInput.trim();

    if (!trimmedName) {
      Alert.alert('Missing Name', 'Enter your name before saving your profile.');
      return;
    }

    if (trimmedName === profileName) {
      closeProfileModal();
      return;
    }

    setIsSavingProfile(true);
    const result = await authAPI.updateProfile({
      displayName: trimmedName,
    });
    setIsSavingProfile(false);

    if (!result?.success) {
      Alert.alert('Update Failed', result?.error || 'Could not update profile information.');
      return;
    }

    await refreshProfile();
    closeProfileModal();
    Alert.alert('Updated', 'Your profile information has been updated.');
  };

  const closeSecurityModal = () => {
    setSecurityModalVisible(false);
    setCurrentPassword('');
    setNextPassword('');
    setConfirmPassword('');
    setIsSavingSecurityPassword(false);
  };

  const handleUpdateSecurityPassword = async () => {
    if (!currentPassword.trim() || !nextPassword.trim() || !confirmPassword.trim()) {
      Alert.alert('Missing Details', 'Fill current, new, and confirm safety password fields.');
      return;
    }

    const currentMatches = await verifySecurityPassword({
      email: user?.email,
      input: currentPassword,
    });
    if (!currentMatches) {
      Alert.alert('Incorrect Current Password', 'The current safety password is not correct.');
      return;
    }

    if (nextPassword.trim().length < 8) {
      Alert.alert('Weak Safety Password', 'Your new safety password must be at least 8 characters long.');
      return;
    }

    if (nextPassword.trim() !== confirmPassword.trim()) {
      Alert.alert('Password Mismatch', 'New safety password and confirm password must match.');
      return;
    }

    setIsSavingSecurityPassword(true);
    const result = await updateSecurityPassword({
      email: user?.email,
      nextPassword,
    });
    setIsSavingSecurityPassword(false);

    if (!result.success) {
      Alert.alert('Update Failed', result.error || 'Could not update safety password.');
      return;
    }

    setSecurityStatus('Custom safety password configured');
    closeSecurityModal();
    Alert.alert('Updated', 'Your safety password has been updated successfully.');
  };

  const renderItem = (icon, iconColor, title, subtitle, rightElement, onPress) => (
    <TouchableOpacity
      style={styles.item}
      activeOpacity={0.7}
      disabled={!!rightElement && !onPress}
      onPress={onPress}
    >
      <View style={[styles.iconWrap, { backgroundColor: iconColor + '15' }]}>
        <Ionicons name={icon} size={18} color={iconColor} />
      </View>
      <View style={styles.itemTextWrap}>
        <Text style={styles.itemTitle}>{title}</Text>
        {subtitle && <Text style={styles.itemSubtitle}>{subtitle}</Text>}
      </View>
      {rightElement || <Ionicons name="chevron-forward" size={20} color="#ccc" />}
    </TouchableOpacity>
  );

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
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerCard}>
          <View style={styles.headerCardAvatar}>
            <Text style={styles.headerCardAvatarText}>{profileAvatarLetter}</Text>
          </View>
          <View style={styles.headerCardTextWrap}>
            <Text style={styles.headerCardTitle}>{profileName}</Text>
            <Text style={styles.headerCardSubtitle}>{profileEmail}</Text>
            <TouchableOpacity
              style={styles.headerCardAction}
              activeOpacity={0.85}
              onPress={() => setProfileModalVisible(true)}
            >
              <Text style={styles.headerCardActionText}>Edit profile</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.sectionHeading}>Account</Text>
        <View style={styles.card}>
          {renderItem(
            'person-outline',
            '#8c63db',
            'Profile Information',
            profileName,
            null,
            () => setProfileModalVisible(true)
          )}
          <View style={styles.divider} />
          {renderItem(
            'time-outline',
            '#8c63db',
            'Journey History',
            'Recent routes and safety logs',
            null,
            () => navigation.navigate('JourneyHistory')
          )}
          <View style={styles.divider} />
          {renderItem(
            'people-outline',
            '#8c63db',
            'Emergency Contacts',
            'Manage trusted people for emergency alerts',
            null,
            () => navigation.navigate('EmergencyContacts')
          )}
          <View style={styles.divider} />
          {renderItem(
            'lock-closed-outline',
            '#8c63db',
            'Safety Password',
            securityStatus,
            null,
            () => setSecurityModalVisible(true)
          )}
        </View>

        <Text style={styles.sectionHeading}>Preferences</Text>
        <View style={styles.card}>
          {renderItem('notifications-outline', '#8c63db', 'Notifications', null, (
            <Switch value={true} trackColor={{ true: '#8c63db', false: '#e0e0e0' }} />
          ))}
          <View style={styles.divider} />
          {renderItem('moon-outline', '#8c63db', 'Dark Mode', null, (
            <Switch value={false} trackColor={{ true: '#8c63db', false: '#e0e0e0' }} />
          ))}
        </View>

        <Text style={styles.sectionHeading}>Journey Settings</Text>
        <View style={styles.card}>
          {renderItem(
            'location-outline',
            '#8c63db',
            'Idle Threshold',
            journeySettings ? `${journeySettings.idleThreshold} minutes` : 'Loading...',
            null,
            () => setIdleThresholdModal(true)
          )}
          <View style={styles.divider} />
          {renderItem(
            'notifications-circle-outline',
            '#8c63db',
            'Auto SOS Sensitivity',
            journeySettings ? journeySettings.autoSOSSensitivity.charAt(0).toUpperCase() + journeySettings.autoSOSSensitivity.slice(1) : 'Loading...',
            null,
            () => setAutoSOSModal(true)
          )}
          <View style={styles.divider} />
          {renderItem(
            'timer-outline',
            '#8c63db',
            'Emergency Alert Delay',
            journeySettings ? `${journeySettings.emergencyAlertDelay} seconds` : 'Loading...',
            null,
            () => setEmergencyAlertModal(true)
          )}
          <View style={styles.divider} />
          {renderItem(
            'radio-outline',
            '#8c63db',
            'Location Tracking Interval',
            journeySettings ? `${journeySettings.locationTrackingInterval} seconds` : 'Loading...',
            null,
            () => setLocationTrackingModal(true)
          )}
          <View style={styles.divider} />
          {renderItem(
            'radius-outline',
            '#8c63db',
            'Crime Zone Alert Radius',
            journeySettings ? `${journeySettings.crimeZoneAlertRadius} meters` : 'Loading...',
            null,
            () => setCrimeZoneRadiusModal(true)
          )}
          <View style={styles.divider} />
          {renderItem(
            'mic-outline',
            '#8c63db',
            'Audio Monitoring',
            null,
            (
              <Switch
                value={journeySettings?.audioMonitoring || false}
                trackColor={{ true: '#8c63db', false: '#e0e0e0' }}
                onValueChange={(value) => handleJourneySettingUpdate('audioMonitoring', value, () => {})}
              />
            )
          )}
          <View style={styles.divider} />
          {renderItem(
            'chatbubble-ellipses-outline',
            '#8c63db',
            'Emergency SMS Alerts',
            'Disable to send only email alerts during SOS',
            (
              <Switch
                value={journeySettings?.smsAlertsEnabled ?? true}
                trackColor={{ true: '#8c63db', false: '#e0e0e0' }}
                onValueChange={(value) => handleJourneySettingUpdate('smsAlertsEnabled', value, () => {})}
              />
            )
          )}
          <View style={styles.divider} />
          {renderItem(
            'call-outline',
            '#8c63db',
            'Emergency Auto Call',
            'Disable to avoid Twilio call credits during testing',
            (
              <Switch
                value={journeySettings?.callAlertsEnabled ?? true}
                trackColor={{ true: '#8c63db', false: '#e0e0e0' }}
                onValueChange={(value) => handleJourneySettingUpdate('callAlertsEnabled', value, () => {})}
              />
            )
          )}
        </View>

        <Text style={styles.sectionHeading}>Vehicle Safety</Text>
        <View style={styles.card}>
          {renderItem(
            'camera-outline',
            '#8c63db',
            'No Plate Vehicle Scan',
            'Scan, upload, and save to Firebase',
            null,
            () => navigation.navigate('VehicleScan')
          )}
        </View>

        <Text style={styles.sectionHeading}>About</Text>
        <View style={styles.card}>
          {renderItem('information-circle-outline', '#8c63db', 'About Abhaya', 'Version 1.0.0')}
        </View>

        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={20} color="#ea5455" />
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>

      </ScrollView>

      <Modal visible={profileModalVisible} transparent animationType="fade" onRequestClose={closeProfileModal}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Profile Information</Text>
            <Text style={styles.modalDescription}>
              Update the name shown across your safety dashboard.
            </Text>

            <View style={styles.profileSummary}>
              <View style={styles.profileSummaryAvatar}>
                <Text style={styles.profileSummaryAvatarText}>{profileAvatarLetter}</Text>
              </View>
              <View style={styles.profileSummaryTextWrap}>
                <Text style={styles.profileSummaryLabel}>Email</Text>
                <Text style={styles.profileSummaryValue}>{profileEmail}</Text>
              </View>
            </View>

            <TextInput
              style={styles.modalInput}
              placeholder="Your full name"
              placeholderTextColor="#9a93ad"
              value={displayNameInput}
              onChangeText={setDisplayNameInput}
              autoCapitalize="words"
            />

            <TouchableOpacity
              style={[
                styles.modalPrimaryButton,
                isSavingProfile && styles.modalButtonDisabled,
              ]}
              onPress={handleUpdateProfile}
              disabled={isSavingProfile}
            >
              <Text style={styles.modalPrimaryButtonText}>
                {isSavingProfile ? 'Saving...' : 'Save Profile'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.modalSecondaryButton} onPress={closeProfileModal}>
              <Text style={styles.modalSecondaryButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={securityModalVisible} transparent animationType="fade" onRequestClose={closeSecurityModal}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Update Safety Password</Text>
            <Text style={styles.modalDescription}>{SECURITY_PASSWORD_DESCRIPTION}</Text>

            <TextInput
              style={styles.modalInput}
              placeholder="Current safety password"
              placeholderTextColor="#9a93ad"
              value={currentPassword}
              onChangeText={setCurrentPassword}
              secureTextEntry
            />
            <TextInput
              style={styles.modalInput}
              placeholder="New safety password"
              placeholderTextColor="#9a93ad"
              value={nextPassword}
              onChangeText={setNextPassword}
              secureTextEntry
            />
            <TextInput
              style={styles.modalInput}
              placeholder="Confirm new safety password"
              placeholderTextColor="#9a93ad"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
            />

            <TouchableOpacity
              style={[
                styles.modalPrimaryButton,
                isSavingSecurityPassword && styles.modalButtonDisabled,
              ]}
              onPress={handleUpdateSecurityPassword}
              disabled={isSavingSecurityPassword}
            >
              <Text style={styles.modalPrimaryButtonText}>
                {isSavingSecurityPassword ? 'Saving...' : 'Save Safety Password'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.modalSecondaryButton} onPress={closeSecurityModal}>
              <Text style={styles.modalSecondaryButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Idle Threshold Modal */}
      <Modal visible={idleThresholdModal} transparent animationType="slide" onRequestClose={() => setIdleThresholdModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.optionsModalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Idle Threshold</Text>
              <TouchableOpacity onPress={() => setIdleThresholdModal(false)}>
                <Ionicons name="close" size={24} color="#111" />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalDescription}>Select how long you can be stationary before an alert</Text>
            <ScrollView style={styles.optionsScroll}>
              {IDLE_THRESHOLD_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.optionItem,
                    journeySettings?.idleThreshold === option.value && styles.optionItemSelected,
                  ]}
                  onPress={() => handleJourneySettingUpdate('idleThreshold', option.value, setIdleThresholdModal)}
                >
                  <View style={styles.optionRadio}>
                    {journeySettings?.idleThreshold === option.value && (
                      <View style={styles.optionRadioSelected} />
                    )}
                  </View>
                  <Text style={styles.optionLabel}>{option.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Auto SOS Sensitivity Modal */}
      <Modal visible={autoSOSModal} transparent animationType="slide" onRequestClose={() => setAutoSOSModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.optionsModalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Auto SOS Sensitivity</Text>
              <TouchableOpacity onPress={() => setAutoSOSModal(false)}>
                <Ionicons name="close" size={24} color="#111" />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalDescription}>Choose how quickly the app responds to danger</Text>
            <ScrollView style={styles.optionsScroll}>
              {AUTO_SOS_SENSITIVITY_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.optionItem,
                    journeySettings?.autoSOSSensitivity === option.value && styles.optionItemSelected,
                  ]}
                  onPress={() => handleJourneySettingUpdate('autoSOSSensitivity', option.value, setAutoSOSModal)}
                >
                  <View style={styles.optionRadio}>
                    {journeySettings?.autoSOSSensitivity === option.value && (
                      <View style={styles.optionRadioSelected} />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.optionLabel}>{option.label}</Text>
                    <Text style={styles.optionDescription}>{option.description}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Emergency Alert Delay Modal */}
      <Modal visible={emergencyAlertModal} transparent animationType="slide" onRequestClose={() => setEmergencyAlertModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.optionsModalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Emergency Alert Delay</Text>
              <TouchableOpacity onPress={() => setEmergencyAlertModal(false)}>
                <Ionicons name="close" size={24} color="#111" />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalDescription}>How many seconds before emergency contacts are notified</Text>
            <ScrollView style={styles.optionsScroll}>
              {EMERGENCY_ALERT_DELAY_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.optionItem,
                    journeySettings?.emergencyAlertDelay === option.value && styles.optionItemSelected,
                  ]}
                  onPress={() => handleJourneySettingUpdate('emergencyAlertDelay', option.value, setEmergencyAlertModal)}
                >
                  <View style={styles.optionRadio}>
                    {journeySettings?.emergencyAlertDelay === option.value && (
                      <View style={styles.optionRadioSelected} />
                    )}
                  </View>
                  <Text style={styles.optionLabel}>{option.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Location Tracking Interval Modal */}
      <Modal visible={locationTrackingModal} transparent animationType="slide" onRequestClose={() => setLocationTrackingModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.optionsModalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Location Tracking Interval</Text>
              <TouchableOpacity onPress={() => setLocationTrackingModal(false)}>
                <Ionicons name="close" size={24} color="#111" />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalDescription}>How frequently your location is updated</Text>
            <ScrollView style={styles.optionsScroll}>
              {LOCATION_TRACKING_INTERVAL_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.optionItem,
                    journeySettings?.locationTrackingInterval === option.value && styles.optionItemSelected,
                  ]}
                  onPress={() => handleJourneySettingUpdate('locationTrackingInterval', option.value, setLocationTrackingModal)}
                >
                  <View style={styles.optionRadio}>
                    {journeySettings?.locationTrackingInterval === option.value && (
                      <View style={styles.optionRadioSelected} />
                    )}
                  </View>
                  <Text style={styles.optionLabel}>{option.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Crime Zone Alert Radius Modal */}
      <Modal visible={crimeZoneRadiusModal} transparent animationType="slide" onRequestClose={() => setCrimeZoneRadiusModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.optionsModalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Crime Zone Alert Radius</Text>
              <TouchableOpacity onPress={() => setCrimeZoneRadiusModal(false)}>
                <Ionicons name="close" size={24} color="#111" />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalDescription}>How far around you to monitor for high-risk zones</Text>
            <ScrollView style={styles.optionsScroll}>
              {CRIME_ZONE_ALERT_RADIUS_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.optionItem,
                    journeySettings?.crimeZoneAlertRadius === option.value && styles.optionItemSelected,
                  ]}
                  onPress={() => handleJourneySettingUpdate('crimeZoneAlertRadius', option.value, setCrimeZoneRadiusModal)}
                >
                  <View style={styles.optionRadio}>
                    {journeySettings?.crimeZoneAlertRadius === option.value && (
                      <View style={styles.optionRadioSelected} />
                    )}
                  </View>
                  <Text style={styles.optionLabel}>{option.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fbf9ff' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  backButton: { padding: 4 },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#111' },
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  
  headerCard: { backgroundColor: '#fff', borderRadius: 20, marginBottom: 24, marginTop: 8, padding: 18, shadowColor: '#14092c', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.04, shadowRadius: 16, elevation: 3, flexDirection: 'row', alignItems: 'center' },
  headerCardAvatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#8c63db', justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  headerCardAvatarText: { color: '#fff', fontSize: 22, fontWeight: '800' },
  headerCardTextWrap: { flex: 1 },
  headerCardTitle: { fontSize: 18, fontWeight: '800', color: '#111' },
  headerCardSubtitle: { marginTop: 4, fontSize: 13, color: '#7f7993', fontWeight: '500' },
  headerCardAction: { alignSelf: 'flex-start', marginTop: 12, backgroundColor: '#f3edff', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
  headerCardActionText: { color: '#6a56a6', fontSize: 12, fontWeight: '800' },
  
  sectionHeading: { fontSize: 13, fontWeight: '700', color: '#8f8f96', marginLeft: 4, marginBottom: 10 },
  card: { backgroundColor: '#fff', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, marginBottom: 24, shadowColor: '#14092c', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.03, shadowRadius: 12, elevation: 2 },
  
  item: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  iconWrap: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  itemTextWrap: { flex: 1 },
  itemTitle: { fontSize: 15, fontWeight: '600', color: '#111' },
  itemSubtitle: { fontSize: 12, color: '#8f8f96', marginTop: 2 },
  
  divider: { height: 1, backgroundColor: '#f2f2f2', marginLeft: 50 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(19, 11, 38, 0.52)', justifyContent: 'center', paddingHorizontal: 22 },
  modalCard: { backgroundColor: '#fff', borderRadius: 24, padding: 22 },
  modalTitle: { fontSize: 21, fontWeight: '800', color: '#111' },
  modalDescription: { marginTop: 10, color: '#6f6790', fontSize: 13, lineHeight: 20, fontWeight: '600' },
  modalInput: { marginTop: 14, borderRadius: 16, backgroundColor: '#f7f3ff', paddingHorizontal: 14, paddingVertical: 14, color: '#111', fontSize: 14 },
  modalPrimaryButton: { marginTop: 18, borderRadius: 16, backgroundColor: '#8c63db', paddingVertical: 14, alignItems: 'center' },
  modalPrimaryButtonText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  modalSecondaryButton: { marginTop: 10, borderRadius: 16, backgroundColor: '#f4f1fb', paddingVertical: 14, alignItems: 'center' },
  modalSecondaryButtonText: { color: '#6a56a6', fontSize: 14, fontWeight: '800' },
  modalButtonDisabled: { opacity: 0.55 },
  profileSummary: { marginTop: 18, flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 18, backgroundColor: '#f7f3ff' },
  profileSummaryAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#8c63db', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  profileSummaryAvatarText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  profileSummaryTextWrap: { flex: 1 },
  profileSummaryLabel: { fontSize: 11, color: '#8f8f96', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  profileSummaryValue: { marginTop: 4, color: '#22153f', fontSize: 14, fontWeight: '600' },
  
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16, backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#ffeaea', shadowColor: '#ea5455', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2, marginTop: 10 },
  logoutText: { color: '#ea5455', fontSize: 15, fontWeight: '700' },

  // Journey Settings Modal Styles
  optionsModalCard: { backgroundColor: '#fff', borderRadius: 28, padding: 24, maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  optionsScroll: { marginTop: 16, maxHeight: 350 },
  optionItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 12, borderRadius: 14, marginBottom: 10, backgroundColor: '#f9f8fb' },
  optionItemSelected: { backgroundColor: '#f3edff', borderWidth: 1, borderColor: '#d4b3ff' },
  optionRadio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#8c63db', marginRight: 14, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  optionRadioSelected: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#8c63db' },
  optionLabel: { fontSize: 14, fontWeight: '600', color: '#111', flex: 1 },
  optionDescription: { fontSize: 11, color: '#8f8f96', marginTop: 4, fontWeight: '500' },
});
