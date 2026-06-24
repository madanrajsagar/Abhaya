import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { useAuth } from '../context/AuthContext';
import { useReport } from '../context/ReportContext';
import { incidentAPI, videoAPI } from '../services/api';
import AudioAnalysisService from '../services/AudioAnalysisService';
import { getEmergencyEmailAddresses } from '../services/emergencyEmailContacts';
import { getJourneySettings } from '../services/journeySettings';
import { saveIncidentReport } from '../services/reportStorage';
import { formatResolvedAddress } from '../services/addressUtils';

const RECORD_SECONDS = 7;
const CAMERA_READY_DELAY_MS = 120;
const MAX_VIDEO_BYTES = 3 * 1024 * 1024;
const EMAIL_FAILURE_MESSAGE =
  'Report saved, but emergency delivery could not be completed. Check email and Twilio settings in backend/.env.';

const createIncidentId = () =>
  `inc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const getUserDisplayName = (user) =>
  String(user?.displayName || user?.name || 'Abhaya User').trim() || 'Abhaya User';

const getUserPhone = (user) =>
  String(user?.phone || user?.phoneNumber || user?.mobile || user?.contact || '').trim();

const isFiniteCoordinate = (value) => Number.isFinite(Number(value));

const mergeIncidentReportSeed = ({
  generatedIncidentId,
  createdAt,
  triggerType,
  triggerReason,
  displayName,
  phone,
  email,
  seed,
}) => {
  const baseReport = {
    incidentId: generatedIncidentId,
    createdAt,
    status: 'ACTIVE',
    user: {
      name: displayName || 'Abhaya User',
      phone: phone || null,
      email: email || null,
    },
    location: {
      lat: null,
      lng: null,
      address: '',
      source: 'device_capture',
    },
    trigger: {
      type: triggerType,
      riskScore: 'HIGH',
      reason: triggerReason || null,
    },
    vehicle: null,
    journey: null,
    zone: null,
    evidence: [],
    timeline: [
      'SOS triggered',
      triggerReason ? `Trigger reason: ${triggerReason}` : '',
    ].filter(Boolean),
    notification: {
      sent: false,
    },
  };

  const merged = {
    ...baseReport,
    ...(seed || {}),
    incidentId: seed?.incidentId || generatedIncidentId,
    createdAt: seed?.createdAt || createdAt,
    status: seed?.status || 'ACTIVE',
    user: {
      ...baseReport.user,
      ...(seed?.user || {}),
      name: seed?.user?.name || baseReport.user.name,
      phone: seed?.user?.phone || baseReport.user.phone,
      email: seed?.user?.email || baseReport.user.email,
    },
    location: {
      ...baseReport.location,
      ...(seed?.location || {}),
      lat: isFiniteCoordinate(seed?.location?.lat) ? Number(seed.location.lat) : baseReport.location.lat,
      lng: isFiniteCoordinate(seed?.location?.lng) ? Number(seed.location.lng) : baseReport.location.lng,
      address: seed?.location?.address || baseReport.location.address,
    },
    trigger: {
      ...baseReport.trigger,
      ...(seed?.trigger || {}),
      type: seed?.trigger?.type || baseReport.trigger.type,
      riskScore: seed?.trigger?.riskScore || baseReport.trigger.riskScore,
      reason: seed?.trigger?.reason || baseReport.trigger.reason,
    },
    vehicle:
      seed?.vehicle || seed?.vehicleDetails
        ? {
            ...(seed?.vehicle || seed?.vehicleDetails || {}),
          }
        : null,
    journey: seed?.journey ? { ...seed.journey } : null,
    zone: seed?.zone ? { ...seed.zone } : null,
    destination: seed?.destination ? { ...seed.destination } : null,
    evidence: Array.isArray(seed?.evidence) ? [...seed.evidence] : [],
    timeline:
      Array.isArray(seed?.timeline) && seed.timeline.length
        ? seed.timeline.filter(Boolean)
        : baseReport.timeline,
    notification: {
      ...baseReport.notification,
      ...(seed?.notification || {}),
    },
  };

  return merged;
};

export default function IncidentReportScreen({ navigation, route }) {
  const { user } = useAuth();
  const { setLatestReport } = useReport();
  const displayName = getUserDisplayName(user);
  const phone = getUserPhone(user);
  const email = String(user?.email || '').trim() || null;
  const reportSeed = route?.params?.reportSeed || null;

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const cameraRef = useRef(null);
  const autoStartedRef = useRef(false);
  const reportRef = useRef(null);

  const [incidentId, setIncidentId] = useState('');
  const [recorderVisible, setRecorderVisible] = useState(false);
  const [phase, setPhase] = useState('idle'); // idle | preparing | recording | uploading | success
  const [flowError, setFlowError] = useState('');
  const [currentReport, setCurrentReport] = useState(null);
  const isAutoEvidenceFlow = Boolean(route?.params?.autoStartEvidence);
  const isRecorderActive =
    recorderVisible || ['preparing', 'recording', 'uploading', 'success'].includes(phase);
  const shouldHideReportContent = isAutoEvidenceFlow && isRecorderActive;

  const closeRecorder = () => {
    try {
      cameraRef.current?.stopRecording?.();
    } catch {}
    AudioAnalysisService.stopAnalysis().catch(() => {});
    setRecorderVisible(false);
    setPhase('idle');
  };

  const triggerEvidence = async ({ triggerType = 'SOS', triggerReason = '' } = {}) => {
    setFlowError('');

    const cameraGranted =
      cameraPermission?.granted || (await requestCameraPermission())?.granted;

    if (!cameraGranted) {
      Alert.alert('Camera Permission Needed', 'Allow camera access to record evidence video.');
      return;
    }

    const micGranted =
      micPermission?.granted || (await requestMicPermission())?.granted;

    if (!micGranted) {
      Alert.alert(
        'Microphone Permission Needed',
        'Allow microphone access to record video with audio.'
      );
      return;
    }

    const createdAt = new Date().toISOString();
    const generatedIncidentId = createIncidentId();

    reportRef.current = mergeIncidentReportSeed({
      generatedIncidentId,
      createdAt,
      triggerType,
      triggerReason,
      displayName,
      phone,
      email,
      seed: reportSeed,
    });

    setCurrentReport(reportRef.current);
    setIncidentId(reportRef.current.incidentId);
    setRecorderVisible(true);
    setPhase('preparing');

    Promise.resolve()
      .then(async () => {
        const currentLat = Number(reportRef.current?.location?.lat);
        const currentLng = Number(reportRef.current?.location?.lng);
        const hasSeedCoordinates =
          Number.isFinite(currentLat) && Number.isFinite(currentLng);

        if (hasSeedCoordinates) {
          const results = await Location.reverseGeocodeAsync({
            latitude: currentLat,
            longitude: currentLng,
          });

          reportRef.current = {
            ...(reportRef.current || {}),
            location: {
              ...(reportRef.current?.location || {}),
              address:
                formatResolvedAddress(Array.isArray(results) ? results[0] : null) ||
                reportRef.current?.location?.address ||
                'Live journey location captured',
            },
          };
          setCurrentReport({ ...(reportRef.current || {}) });
          return;
        }

        const permission = await Location.requestForegroundPermissionsAsync();
        if (!permission?.granted) {
          return;
        }

        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const results = await Location.reverseGeocodeAsync({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });

        reportRef.current = {
          ...(reportRef.current || {}),
          location: {
            ...(reportRef.current?.location || {}),
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            address:
              formatResolvedAddress(Array.isArray(results) ? results[0] : null) ||
              reportRef.current?.location?.address ||
              'Live location captured',
            source: reportRef.current?.location?.source || 'device_capture',
          },
        };
        setCurrentReport({ ...(reportRef.current || {}) });
      })
      .catch(() => {});
  };

  useEffect(() => {
    AudioAnalysisService.stopAnalysis().catch(() => {});
  }, []);

  useEffect(() => {
    const shouldAutoStart = Boolean(route?.params?.autoStartEvidence);
    const triggerType = route?.params?.triggerType || 'SOS';
    const triggerReason = route?.params?.triggerReason || '';

    if (!shouldAutoStart || autoStartedRef.current) return;
    autoStartedRef.current = true;
    triggerEvidence({ triggerType, triggerReason });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params?.autoStartEvidence, route?.params?.triggerReason, route?.params?.triggerType]);

  useEffect(() => {
    const run = async () => {
      if (!recorderVisible || phase !== 'preparing') return;

      try {
        setPhase('recording');

        // Give the camera view a short moment to mount before recording.
        await new Promise((resolve) => setTimeout(resolve, CAMERA_READY_DELAY_MS));

        const camera = cameraRef.current;
        if (!camera?.recordAsync) {
          throw new Error('Camera is not ready. Please try again.');
        }

        reportRef.current = {
          ...(reportRef.current || {}),
          timeline: [...(reportRef.current?.timeline || []), 'Recording started'],
        };

        const stopTimer = setTimeout(() => {
          try {
            camera.stopRecording?.();
          } catch {}
        }, RECORD_SECONDS * 1000);

        const recordPromise = camera.recordAsync({
          maxDuration: RECORD_SECONDS,
          maxFileSize: MAX_VIDEO_BYTES,
        });
        const videoResult = await recordPromise;
        clearTimeout(stopTimer);

        const uri = videoResult?.uri;
        if (!uri) {
          throw new Error('Recording failed (no video uri).');
        }

        reportRef.current = {
          ...(reportRef.current || {}),
          timeline: [...(reportRef.current?.timeline || []), 'Recording stopped'],
        };

        setPhase('uploading');

        const upload = await incidentAPI.uploadVideoToCloudinary(uri);
        if (!upload?.success || !upload?.data?.url) {
          throw new Error(upload?.error || 'Failed to upload video.');
        }

        // Persist the uploaded Cloudinary video against the logged-in user.
        try {
          await videoAPI.saveVideo({
            videoUrl: upload.data.url,
            incidentId: reportRef.current?.incidentId,
          });
        } catch {
          // Do not block the SOS/report flow if metadata persistence fails.
        }

        const evidenceTimestamp = new Date().toISOString();
        const updatedReport = {
          ...(reportRef.current || {}),
          evidence: [
            ...(reportRef.current?.evidence || []),
            {
              type: 'video',
              url: upload.data.url,
              timestamp: evidenceTimestamp,
            },
          ],
          timeline: [...(reportRef.current?.timeline || []), 'Video uploaded'],
        };

        const emailRecipients = await getEmergencyEmailAddresses();
        const journeySettings = await getJourneySettings();
        const emailResult = await incidentAPI.sendEmergencyEmail(updatedReport, emailRecipients, {
          smsEnabled: journeySettings?.smsAlertsEnabled !== false,
          callEnabled: journeySettings?.callAlertsEnabled !== false,
        });
        const finalReport = {
          ...updatedReport,
          notification: {
            sent: Boolean(emailResult?.success),
            channels: emailResult?.channels || null,
          },
        };

        await saveIncidentReport(finalReport);
        await setLatestReport(finalReport);
        setCurrentReport(finalReport);

        setPhase('success');
        await new Promise((resolve) => setTimeout(resolve, 400));

        closeRecorder();
        navigation.replace('ReportDetails', {
          incidentId: finalReport.incidentId,
          report: finalReport,
        });

        setTimeout(() => {
          if (emailResult?.success) {
            Alert.alert(
              'Emergency Alert Sent',
              emailResult?.message || 'Emergency alert sent across available channels.'
            );
          } else {
            Alert.alert(
              'Emergency Alert Failed',
              emailResult?.error || EMAIL_FAILURE_MESSAGE
            );
          }
        }, 350);
      } catch (e) {
        setFlowError(e?.message || 'Evidence generation failed.');
        setPhase('idle');
      }
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorderVisible, phase]);

  const reportDateText = useMemo(() => {
    try {
      const date = currentReport?.createdAt ? new Date(currentReport.createdAt) : new Date();
      return `Date: ${date.toLocaleDateString()} | ${date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })}`;
    } catch {
      return 'Date unavailable';
    }
  }, [currentReport?.createdAt]);

  const locationSummary = useMemo(() => {
    const lat = Number(currentReport?.location?.lat);
    const lng = Number(currentReport?.location?.lng);

    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return `Lat: ${lat.toFixed(2)} | Long: ${lng.toFixed(2)}`;
    }

    return 'Current location unavailable';
  }, [currentReport?.location?.lat, currentReport?.location?.lng]);

  const riskScore = currentReport?.trigger?.riskScore || 'HIGH';
  const videoEvidenceAvailable = Array.isArray(currentReport?.evidence)
    ? currentReport.evidence.some((item) => item?.type === 'video' && item?.url)
    : false;
  const currentVehicle = currentReport?.vehicle || null;
  const vehicleSummary = [
    currentVehicle?.vehicleType,
    currentVehicle?.vehicleBrand,
    currentVehicle?.vehicleModel,
  ]
    .filter(Boolean)
    .join(' | ');
  const currentUserName = currentReport?.user?.name || displayName;
  const currentUserPhone = currentReport?.user?.phone || phone || 'Phone unavailable';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#fbf9ff" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Home'))}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color="#111" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Incident Report</Text>
        <View style={{ width: 24 }} />
      </View>

      {!shouldHideReportContent ? (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.reportCard}>
          {/* Title Section */}
          <View style={styles.sectionHeader}>
            <View style={styles.iconCircleRed}>
              <Ionicons name="clipboard" size={18} color="#fff" />
            </View>
            <View>
              <Text style={styles.reportTitle}>ABHAYA INCIDENT REPORT</Text>
              <Text style={styles.reportDate}>{reportDateText}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          {/* User Info */}
          <View style={styles.section}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="person" size={16} color="#4da6ff" />
              <Text style={styles.sectionTitle}>User Information</Text>
            </View>
            <Text style={styles.dataPrimary}>{currentUserName}</Text>
            <Text style={styles.dataSecondary}>Mobile: {currentUserPhone}</Text>
            {currentReport?.user?.email ? (
              <Text style={styles.dataSecondary}>Email: {currentReport.user.email}</Text>
            ) : null}
          </View>

          <View style={styles.dividerLight} />

          {/* Vehicle Info */}
          <View style={styles.section}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="car" size={16} color="#ed5565" />
              <Text style={styles.sectionTitle}>Vehicle Details</Text>
            </View>
            <Text style={styles.dataPrimary}>
              {currentVehicle?.plateNumber || vehicleSummary || 'No linked vehicle scan'}
            </Text>
            {vehicleSummary ? (
              <Text style={styles.dataSecondary}>Vehicle: {vehicleSummary}</Text>
            ) : null}
            <Text style={styles.dataSecondary}>License: Valid ✅</Text>
          </View>

          <View style={styles.dividerLight} />

          {/* Location */}
          <View style={styles.section}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="location" size={16} color="#ed5565" />
              <Text style={styles.sectionTitle}>Last Known Location</Text>
            </View>
            <Text style={styles.dataPrimary}>{locationSummary}</Text>
            <TouchableOpacity style={styles.mapLink}>
              <Ionicons name="map" size={14} color="#7b57d1" />
              <Text style={styles.mapLinkText}>
                {currentReport?.location?.address || 'View on Map'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.dividerLight} />

          {/* Evidence */}
          <View style={styles.section}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="folder" size={16} color="#f8d664" />
              <Text style={styles.sectionTitle}>Evidence Files</Text>
            </View>
            
            <TouchableOpacity
              style={styles.evidenceFile}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('VideoEvidence', { incidentId, showAll: true })}
            >
              <View style={styles.evidenceIconWrap}>
                <Ionicons name="eye" size={14} color="#7b57d1" />
              </View>
              <Text style={styles.evidenceName}>Video Evidence</Text>
              <Text style={styles.evidenceMeta}>{videoEvidenceAvailable ? 'View' : 'Pending'}</Text>
            </TouchableOpacity>

            <View style={styles.evidenceFile}>
              <View style={styles.evidenceIconWrap}>
                <Ionicons name="map-outline" size={14} color="#7b57d1" />
              </View>
              <Text style={styles.evidenceName}>Route Timeline</Text>
              <Text style={styles.evidenceMeta}>View</Text>
            </View>
          </View>

          {/* Risk Score */}
          <View style={styles.riskBadge}>
            <Text style={styles.riskBadgeText}>Risk Score</Text>
            <View style={styles.riskBadgeValueWrap}>
              <Text style={styles.riskBadgeValue}>{riskScore}</Text>
              <View style={styles.riskDot} />
            </View>
          </View>
        </View>

        {/* Action Buttons */}
        <TouchableOpacity style={[styles.actionBtn, styles.btnRed]}>
          <Ionicons name="share-social" size={18} color="#fff" />
          <Text style={styles.btnText}>Share with Police</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.actionBtn, styles.btnGreen]}>
          <Ionicons name="checkmark" size={18} color="#fff" />
          <Text style={styles.btnText}>Saved to Cloud ✅</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.actionBtn, styles.btnPurple]}>
          <Ionicons name="download-outline" size={18} color="#fff" />
          <Text style={styles.btnText}>Download Report</Text>
        </TouchableOpacity>
        </ScrollView>
      ) : (
        <View style={styles.recorderScreenPlaceholder} />
      )}

      <Modal visible={recorderVisible} transparent animationType="fade" onRequestClose={closeRecorder}>
        <View style={styles.recorderBackdrop}>
          <View style={styles.recorderCard}>
            <View style={styles.recorderHeader}>
              <View style={styles.recorderTitleRow}>
                <Ionicons name="radio-button-on" size={14} color="#ea5455" />
                <Text style={styles.recorderTitle}>Recording Evidence</Text>
              </View>
              <TouchableOpacity onPress={closeRecorder} style={styles.recorderClose} activeOpacity={0.85}>
                <Ionicons name="close" size={18} color="#111" />
              </TouchableOpacity>
            </View>

            <View style={styles.cameraWrap}>
              <CameraView
                ref={cameraRef}
                style={StyleSheet.absoluteFill}
                facing="back"
                mode="video"
                videoQuality="480p"
              />
              <View style={styles.cameraOverlay}>
                <View style={styles.cameraOverlayPill}>
                  <Text style={styles.cameraOverlayText}>
                    {phase === 'recording'
                      ? `Recording… (${RECORD_SECONDS}s)`
                      : phase === 'uploading'
                        ? 'Uploading to cloud…'
                        : phase === 'success'
                          ? 'Report generated'
                          : 'Preparing camera…'}
                  </Text>
                  {phase === 'uploading' ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : null}
                </View>
              </View>
            </View>

            {flowError ? <Text style={styles.flowError}>{flowError}</Text> : null}
            {!flowError ? (
              <Text style={styles.recorderHint}>
                Auto-stops after {RECORD_SECONDS} seconds. Keep the app in foreground.
              </Text>
            ) : null}
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
  recorderScreenPlaceholder: { flex: 1 },
  
  reportCard: { backgroundColor: '#fff', borderRadius: 24, padding: 24, shadowColor: '#14092c', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.05, shadowRadius: 20, elevation: 4, marginBottom: 24, marginTop: 8 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  iconCircleRed: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#ea4335', justifyContent: 'center', alignItems: 'center' },
  reportTitle: { fontSize: 15, fontWeight: '800', color: '#111' },
  reportDate: { fontSize: 12, color: '#8f8f96', marginTop: 2 },
  
  divider: { height: 1, backgroundColor: '#eee', marginVertical: 20 },
  dividerLight: { height: 1, backgroundColor: '#f5f5f5', marginVertical: 16 },
  
  section: {},
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  sectionTitle: { fontSize: 13, color: '#8f8f96', fontWeight: '500' },
  dataPrimary: { fontSize: 15, fontWeight: '700', color: '#111', marginBottom: 4 },
  dataSecondary: { fontSize: 13, color: '#666', marginBottom: 2 },
  
  mapLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  mapLinkText: { fontSize: 13, color: '#7b57d1', fontWeight: '700' },
  
  evidenceFile: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f7f4fb', padding: 14, borderRadius: 16, marginBottom: 10 },
  evidenceIconWrap: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#eaddff', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  evidenceName: { flex: 1, fontSize: 13, fontWeight: '600', color: '#111' },
  evidenceMeta: { fontSize: 12, color: '#8f8f96' },
  
  riskBadge: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#ffeaea', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 16, marginTop: 10 },
  riskBadgeText: { fontSize: 13, color: '#666' },
  riskBadgeValueWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  riskBadgeValue: { fontSize: 14, fontWeight: '800', color: '#ea4335' },
  riskDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#ea4335' },
  
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 18, borderRadius: 16, marginBottom: 12 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  btnRed: { backgroundColor: '#ea5455' },
  btnGreen: { backgroundColor: '#4caf50' },
  btnPurple: { backgroundColor: '#7b57d1' },
  btnGhost: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#eaddff' },
  btnGhostText: { color: '#7b57d1', fontSize: 15, fontWeight: '800' },

  recorderBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  recorderCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 22,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  recorderHeader: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#f2f2f2',
  },
  recorderTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  recorderTitle: { fontSize: 14, fontWeight: '900', color: '#111' },
  recorderClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f2ebff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraWrap: { height: 360, backgroundColor: '#000' },
  cameraOverlay: { position: 'absolute', left: 0, right: 0, bottom: 14, alignItems: 'center' },
  cameraOverlayPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.62)',
  },
  cameraOverlayText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  recorderHint: { paddingHorizontal: 16, paddingVertical: 12, color: '#8f8f96', fontSize: 12, fontWeight: '700' },
  flowError: { paddingHorizontal: 16, paddingVertical: 12, color: '#ea5455', fontSize: 12, fontWeight: '800' },
});
