import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useReport } from '../context/ReportContext';
import { getIncidentReportById, getLatestIncidentReport } from '../services/reportStorage';
import vehicleObservationAPI from '../services/vehicleObservations';

const formatTimestamp = (isoString) => {
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString();
  } catch {
    return '-';
  }
};

const formatCoordinate = (value) =>
  Number.isFinite(Number(value)) ? Number(value).toFixed(6) : '-';

const formatTimelineType = (value) =>
  String(value || 'event')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const unavailableValuePattern = /^(unknown\b.*|not available|plate not readable|plate not detected|-|n\/a)$/i;
const isDisplayableValue = (value) => {
  const text = String(value || '').trim();
  return Boolean(text) && !unavailableValuePattern.test(text);
};

const firstAvailable = (...values) =>
  values.find(isDisplayableValue) || '';

const normalizePhone = (value) => String(value || '').replace(/[^\d+]/g, '');

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

const getMapLink = (location) => {
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return '';
  }

  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
};

const hasVehicleContent = (vehicleDetails) =>
  Boolean(
    isDisplayableValue(vehicleDetails?.plateNumber) ||
      isDisplayableValue(vehicleDetails?.vehicleSummary) ||
      isDisplayableValue(vehicleDetails?.identificationMark)
  );

const buildReportMessage = ({
  report,
  vehicleDetails,
  mapLink,
  includeVehicleDetails,
  resolvedLocationAddress,
}) => {
  const lines = ['ABHAYA INCIDENT REPORT'];
  const addLine = (label, value) => {
    if (isDisplayableValue(value)) {
      lines.push(`${label}: ${String(value).trim()}`);
    }
  };

  addLine('Incident ID', report?.incidentId);
  addLine('Reported At', formatTimestamp(report?.createdAt));
  addLine('Status', report?.status || 'ACTIVE');
  addLine('Triggered By', report?.trigger?.type || 'SOS');
  addLine('Risk Score', report?.trigger?.riskScore || 'HIGH');
  addLine('User Name', report?.user?.name);
  addLine('User Phone', report?.user?.phone);
  addLine('User Email', report?.user?.email);
  addLine('Location Address', resolvedLocationAddress || report?.location?.address);
  addLine('Latitude', formatCoordinate(report?.location?.lat));
  addLine('Longitude', formatCoordinate(report?.location?.lng));
  addLine('Journey Mode', report?.journey?.mode);
  addLine('Destination', report?.journey?.destinationName || report?.destination?.name);
  addLine('ETA', report?.journey?.etaMinutes ? `${report.journey.etaMinutes} min` : '');
  addLine('Distance', report?.journey?.distanceKm ? `${report.journey.distanceKm} km` : '');
  addLine('Nearby Risk Zone', report?.zone?.name);

  if (includeVehicleDetails) {
    addLine('Plate Number', vehicleDetails.plateNumber);
    addLine('Vehicle', vehicleDetails.vehicleSummary);
    addLine('Visible Mark', vehicleDetails.identificationMark);
  }

  if (mapLink) {
    lines.push(`Map Link: ${mapLink}`);
  }

  return lines.join('\n');
};

const ReportMetricRow = ({ label, value, valueStyle }) => {
  if (!isDisplayableValue(value)) {
    return null;
  }

  return (
    <View style={styles.metricRow}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, valueStyle]}>{value}</Text>
    </View>
  );
};

const SectionCard = ({ iconName, iconColor, title, subtitle, children }) => (
  <View style={styles.card}>
    <View style={styles.cardHeader}>
      <View style={[styles.iconCircle, { backgroundColor: iconColor }]}>
        <Ionicons name={iconName} size={18} color="#fff" />
      </View>
      <View style={styles.cardHeaderCopy}>
        <Text style={styles.cardTitle}>{title}</Text>
        {subtitle ? <Text style={styles.cardSubtitle}>{subtitle}</Text> : null}
      </View>
    </View>
    {children}
  </View>
);

export default function ReportDetailsScreen({ navigation, route }) {
  const passedReport = route?.params?.report || null;
  const passedIncidentId = route?.params?.incidentId || passedReport?.incidentId || '';
  const { latestReport, setLatestReport } = useReport();

  const initialReport = useMemo(() => {
    if (passedReport) return passedReport;
    if (passedIncidentId && latestReport?.incidentId === passedIncidentId) return latestReport;
    return latestReport || null;
  }, [passedReport, passedIncidentId, latestReport]);

  const [report, setReport] = useState(initialReport);
  const [linkedVehicle, setLinkedVehicle] = useState(null);
  const [loading, setLoading] = useState(!initialReport);
  const [error, setError] = useState('');
  const [resolvedAddress, setResolvedAddress] = useState('');

  const incidentId = report?.incidentId || passedIncidentId || '';

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      let nextReport = null;

      if (passedIncidentId) {
        const stored = await getIncidentReportById(passedIncidentId);
        nextReport = stored?.data || null;
      } else {
        const latest = await getLatestIncidentReport();
        nextReport = latest?.data || latestReport || null;
      }

      if (!nextReport) {
        throw new Error('No report found yet. Trigger SOS to generate one.');
      }

      setReport(nextReport);
      await setLatestReport(nextReport);
    } catch (e) {
      setError(e?.message || 'Failed to load report.');
    } finally {
      setLoading(false);
    }
  }, [latestReport, passedIncidentId, setLatestReport]);

  const loadLinkedVehicle = useCallback(async () => {
    try {
      const records = await vehicleObservationAPI.list({ limit: 1 });
      const latestVehicle = Array.isArray(records) && records.length ? records[0] : null;
      setLinkedVehicle(latestVehicle);
    } catch {
      setLinkedVehicle(null);
    }
  }, []);

  useEffect(() => {
    if (!report) {
      loadReport();
    } else if (passedIncidentId && report?.incidentId !== passedIncidentId) {
      loadReport();
    }
  }, [loadReport, passedIncidentId, report]);

  const isJourneyLinkedReport = useMemo(() => {
    const triggerType = String(report?.trigger?.type || '').toLowerCase();
    const incidentKey = String(report?.incidentId || '').toLowerCase();

    return (
      incidentKey.startsWith('journey_inc_') ||
      triggerType.includes('journey') ||
      triggerType.includes('stationary')
    );
  }, [report?.incidentId, report?.trigger?.type]);

  const reportHasOwnVehicleDetails = useMemo(() => {
    const vehicle = report?.vehicle || report?.vehicleDetails || null;
    return hasVehicleContent(vehicle);
  }, [report]);

  const vehicleDetails = useMemo(() => {
    const vehicle = report?.vehicle || report?.vehicleDetails || {};
    const observation =
      isJourneyLinkedReport || reportHasOwnVehicleDetails
        ? linkedVehicle?.vehicleDetails || linkedVehicle || {}
        : {};

    const vehicleType = firstAvailable(
      vehicle.vehicleType,
      observation.vehicleType
    );
    const vehicleBrand = firstAvailable(
      vehicle.vehicleBrand,
      observation.vehicleBrand
    );
    const vehicleModel = firstAvailable(
      vehicle.vehicleModel,
      observation.vehicleModel
    );
    const vehicleColor = firstAvailable(
      vehicle.vehicleColor,
      observation.vehicleColor
    );

    return {
      plateNumber: firstAvailable(vehicle.plateNumber, observation.plateNumber),
      identificationMark: firstAvailable(
        vehicle.identificationMark,
        observation.identificationMark
      ),
      vehicleSummary: [vehicleType, vehicleBrand, vehicleModel, vehicleColor]
        .filter(Boolean)
        .join(' | '),
    };
  }, [isJourneyLinkedReport, linkedVehicle, report, reportHasOwnVehicleDetails]);

  const shouldShowVehicleSection = useMemo(
    () => reportHasOwnVehicleDetails || (isJourneyLinkedReport && hasVehicleContent(vehicleDetails)),
    [isJourneyLinkedReport, reportHasOwnVehicleDetails, vehicleDetails]
  );

  useEffect(() => {
    if (!isJourneyLinkedReport && !reportHasOwnVehicleDetails) {
      setLinkedVehicle(null);
      return;
    }

    loadLinkedVehicle();
  }, [isJourneyLinkedReport, loadLinkedVehicle, reportHasOwnVehicleDetails]);

  useEffect(() => {
    let active = true;

    const lat = Number(report?.location?.lat);
    const lng = Number(report?.location?.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setResolvedAddress('');
      return () => {
        active = false;
      };
    }

    setResolvedAddress('');

    Location.reverseGeocodeAsync({
      latitude: lat,
      longitude: lng,
    })
      .then((results) => {
        if (!active) {
          return;
        }

        const nextAddress = formatResolvedAddress(Array.isArray(results) ? results[0] : null);
        setResolvedAddress(nextAddress);
      })
      .catch(() => {
        if (active) {
          setResolvedAddress('');
        }
      });

    return () => {
      active = false;
    };
  }, [report?.location?.lat, report?.location?.lng]);

  const resolvedLocationAddress = useMemo(
    () => resolvedAddress || report?.location?.address || '',
    [report?.location?.address, resolvedAddress]
  );

  const openVideo = () => {
    navigation.navigate('VideoEvidence', { incidentId, showAll: true });
  };

  const mapLink = useMemo(() => getMapLink(report?.location), [report?.location]);

  const videoEvidenceCount = useMemo(() => {
    if (!Array.isArray(report?.evidence)) return 0;
    return report.evidence.filter((item) => item?.type === 'video' && item?.url).length;
  }, [report]);

  const timelineItems = useMemo(() => {
    if (!report) {
      return [];
    }

    const items = [];

    items.push({
      key: `created-${report.incidentId || 'report'}`,
      type: 'report_created',
      message: `Incident report prepared with ${report.trigger?.type || 'SOS'} status`,
      createdAt: report.createdAt || null,
      location: report.location || null,
    });

    if (report?.trigger?.reason) {
      items.push({
        key: `trigger-${report.incidentId || 'report'}`,
        type: 'trigger_reason',
        message: `Trigger reason: ${report.trigger.reason}`,
        createdAt: report.createdAt || null,
        location: null,
      });
    }

    const timeline = Array.isArray(report?.timeline) ? report.timeline : [];
    timeline.forEach((label, index) => {
      items.push({
        key: `timeline-${index}-${label}`,
        type: 'timeline_event',
        message: label,
        createdAt: report.createdAt || null,
        location: null,
      });
    });

    const evidence = Array.isArray(report?.evidence) ? report.evidence : [];
    evidence.forEach((item, index) => {
      items.push({
        key: `evidence-${index}-${item?.url || item?.timestamp || 'item'}`,
        type: `${item?.type || 'evidence'}_attached`,
        message:
          item?.type === 'video'
            ? 'Video evidence attached to the report'
            : `${formatTimelineType(item?.type || 'evidence')} attached to the report`,
        createdAt: item?.timestamp || report.createdAt || null,
        location: null,
      });
    });

    return items.sort((left, right) => {
      const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
      const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;
      return rightTime - leftTime;
    });
  }, [report]);

  const reportMessage = useMemo(
    () =>
      buildReportMessage({
        report,
        vehicleDetails,
        mapLink,
        includeVehicleDetails: shouldShowVehicleSection,
        resolvedLocationAddress,
      }),
    [mapLink, report, resolvedLocationAddress, shouldShowVehicleSection, vehicleDetails]
  );

  const targetPhone = useMemo(
    () => normalizePhone(report?.user?.phone),
    [report?.user?.phone]
  );

  const handleOpenMap = useCallback(async () => {
    if (!mapLink) {
      Alert.alert('Location Unavailable', 'No valid location coordinates were found in this report.');
      return;
    }

    const supported = await Linking.canOpenURL(mapLink);
    if (!supported) {
      Alert.alert('Map Unavailable', 'Could not open the map link on this device.');
      return;
    }

    await Linking.openURL(mapLink);
  }, [mapLink]);

  const handleSendReport = useCallback(async () => {
    if (!targetPhone) {
      Alert.alert('Phone Not Available', 'No target phone number is available in this report yet.');
      return;
    }

    const smsUrl = `sms:${targetPhone}?body=${encodeURIComponent(reportMessage)}`;
    const canOpenSms = await Linking.canOpenURL(smsUrl);

    if (canOpenSms) {
      await Linking.openURL(smsUrl);
      return;
    }

    await Share.share({
      message: reportMessage,
      title: 'Abhaya Incident Report',
    });
  }, [reportMessage, targetPhone]);

  const headerSubtitle = useMemo(() => {
    if (!incidentId) return '';
    return `Report tag: ${incidentId.slice(0, 8)}...`;
  }, [incidentId]);

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
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>Report Details</Text>
          {headerSubtitle ? <Text style={styles.headerSubtitle}>{headerSubtitle}</Text> : null}
        </View>
        <TouchableOpacity onPress={loadReport} style={styles.refreshButton} activeOpacity={0.8}>
          <Ionicons name="refresh" size={20} color="#7b57d1" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#7b57d1" />
          <Text style={styles.centerText}>Loading report...</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={26} color="#ea5455" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : !report ? (
        <View style={styles.center}>
          <Text style={styles.centerText}>No report available.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.reportHero}>
            <View style={styles.reportHeroTag}>
              <Ionicons name="shield-checkmark-outline" size={15} color="#7b57d1" />
              <Text style={styles.reportHeroTagText}>ABHAYA REPORT TAG</Text>
            </View>
            <Text style={styles.reportHeroTitle}>Emergency Incident Summary</Text>
            <Text style={styles.reportHeroSubtitle}>
              Structured report containing user, vehicle, location, evidence, and send-ready details.
            </Text>

            <View style={styles.heroActionRow}>
              <TouchableOpacity style={styles.heroPrimaryAction} onPress={handleSendReport}>
                <Ionicons name="send-outline" size={18} color="#fff" />
                <Text style={styles.heroPrimaryActionText}>Send Report</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.heroSecondaryAction} onPress={handleOpenMap}>
                <Ionicons name="location-outline" size={18} color="#7b57d1" />
                <Text style={styles.heroSecondaryActionText}>Open Map</Text>
              </TouchableOpacity>
            </View>
          </View>

          <SectionCard
            iconName="document-text-outline"
            iconColor="#7b57d1"
            title="Report Tag"
            subtitle="Core incident identifiers and report status"
          >
            <ReportMetricRow label="Incident ID" value={report.incidentId} />
            <ReportMetricRow label="Reported At" value={formatTimestamp(report.createdAt)} />
            <ReportMetricRow label="Status" value={report.status || 'ACTIVE'} valueStyle={styles.statusValue} />
            <ReportMetricRow label="Trigger Type" value={report.trigger?.type || 'SOS'} />
            <ReportMetricRow label="Risk Score" value={report.trigger?.riskScore || 'HIGH'} valueStyle={styles.riskValue} />
          </SectionCard>

          <SectionCard
            iconName="person-outline"
            iconColor="#4da6ff"
            title="User Information"
            subtitle="Primary details of the person who triggered the report"
          >
            <ReportMetricRow label="User Name" value={report.user?.name} />
            <ReportMetricRow label="User Phone" value={report.user?.phone} />
            <ReportMetricRow label="User Email" value={report.user?.email} />
          </SectionCard>

          {shouldShowVehicleSection ? (
            <SectionCard
              iconName="car-outline"
              iconColor="#ea5455"
              title="Vehicle Information"
              subtitle={
                isJourneyLinkedReport
                  ? 'Pulled from journey-linked report data and latest saved vehicle scan when available'
                  : 'Shown only when this report already includes vehicle details'
              }
            >
              <ReportMetricRow label="Plate Number" value={vehicleDetails.plateNumber} />
              <ReportMetricRow label="Vehicle" value={vehicleDetails.vehicleSummary} />
              <ReportMetricRow label="Visible Mark" value={vehicleDetails.identificationMark} />
            </SectionCard>
          ) : null}

          <SectionCard
            iconName="location-outline"
            iconColor="#ff9f43"
            title="Location Information"
            subtitle="Exact coordinates and mapped incident area"
          >
            <ReportMetricRow label="Address" value={resolvedLocationAddress} />
            <ReportMetricRow label="Latitude" value={formatCoordinate(report.location?.lat)} />
            <ReportMetricRow label="Longitude" value={formatCoordinate(report.location?.lng)} />
            <TouchableOpacity style={styles.inlineMapButton} onPress={handleOpenMap}>
              <Ionicons name="map-outline" size={16} color="#7b57d1" />
              <Text style={styles.inlineMapButtonText}>View Incident Location</Text>
            </TouchableOpacity>
          </SectionCard>

          {report?.journey || report?.zone ? (
            <SectionCard
              iconName="navigate-outline"
              iconColor="#2ecc71"
              title="Journey Snapshot"
              subtitle="Live runtime journey data captured when SOS was triggered"
            >
              <ReportMetricRow label="Journey Mode" value={report?.journey?.mode} />
              <ReportMetricRow label="Destination" value={report?.journey?.destinationName || report?.destination?.name} />
              <ReportMetricRow
                label="ETA"
                value={
                  Number.isFinite(Number(report?.journey?.etaMinutes))
                    ? `${Number(report.journey.etaMinutes).toFixed(1)} min`
                    : ''
                }
              />
              <ReportMetricRow
                label="Distance"
                value={
                  Number.isFinite(Number(report?.journey?.distanceKm))
                    ? `${Number(report.journey.distanceKm).toFixed(2)} km`
                    : ''
                }
              />
              <ReportMetricRow label="Monitoring" value={report?.journey?.monitoringStatus} />
              <ReportMetricRow label="Nearby Risk Zone" value={report?.zone?.name} />
            </SectionCard>
          ) : null}

          <SectionCard
            iconName="time-outline"
            iconColor="#2ecc71"
            title="Timeline"
            subtitle="Chronological actions captured during the incident flow"
          >
            {timelineItems.length === 0 ? (
              <Text style={styles.emptyTimelineText}>No timeline available yet.</Text>
            ) : (
              <View style={styles.timelineList}>
                {timelineItems.map((item, index) => (
                  <View key={item.key} style={styles.timelineRow}>
                    <View style={styles.timelineRail}>
                      <View style={styles.timelineDot} />
                      {index < timelineItems.length - 1 ? <View style={styles.timelineLine} /> : null}
                    </View>
                    <View style={styles.timelineTextWrap}>
                      <Text style={styles.timelineType}>{formatTimelineType(item.type)}</Text>
                      <Text style={styles.timelineLabel}>{item.message}</Text>
                      <Text style={styles.timelineTime}>{formatTimestamp(item.createdAt)}</Text>
                      {item.location ? (
                        <Text style={styles.timelineLocation}>
                          Lat {formatCoordinate(item.location.lat)}, Lng {formatCoordinate(item.location.lng)}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            )}
          </SectionCard>

          <SectionCard
            iconName="folder-open-outline"
            iconColor="#f8d664"
            title="Evidence & Sharing"
            subtitle="Available files and communication-ready action"
          >
            <View style={styles.evidenceRow}>
              <View style={styles.evidenceIconWrap}>
                <Ionicons name="videocam-outline" size={18} color="#7b57d1" />
              </View>
              <View style={styles.evidenceCopy}>
                <Text style={styles.evidenceTitle}>Video Evidence</Text>
                <Text style={styles.evidenceMeta}>
                  {videoEvidenceCount > 0
                    ? `${videoEvidenceCount} video file(s) available`
                    : 'No video evidence attached yet'}
                </Text>
              </View>
              <TouchableOpacity style={styles.viewButton} onPress={openVideo}>
                <Text style={styles.viewButtonText}>Open</Text>
              </TouchableOpacity>
            </View>

            {targetPhone ? (
              <View style={styles.reportReadyBox}>
                <Text style={styles.reportReadyTitle}>Send-ready report target</Text>
                <Text style={styles.reportReadyValue}>{targetPhone}</Text>
                <Text style={styles.reportReadyText}>
                  The Send Report button opens SMS for the user phone and falls back to share if SMS is unavailable.
                </Text>
              </View>
            ) : null}
          </SectionCard>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fbf9ff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  backButton: { padding: 4 },
  refreshButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f2ebff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, marginLeft: 12, marginRight: 12 },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#111' },
  headerSubtitle: { marginTop: 3, fontSize: 12, color: '#8f8f96', fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 10 },
  centerText: { color: '#8f8f96', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  errorText: { color: '#ea5455', fontSize: 13, fontWeight: '700', textAlign: 'center' },
  content: { paddingHorizontal: 20, paddingBottom: 30 },
  reportHero: {
    backgroundColor: '#1f1533',
    borderRadius: 24,
    padding: 20,
    marginBottom: 16,
  },
  reportHeroTag: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: '#f1e9ff',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  reportHeroTagText: { color: '#7b57d1', fontSize: 11, fontWeight: '900' },
  reportHeroTitle: { marginTop: 14, color: '#fff', fontSize: 25, fontWeight: '900' },
  reportHeroSubtitle: { marginTop: 8, color: '#d8cff0', fontSize: 13, lineHeight: 20, fontWeight: '600' },
  heroActionRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
  heroPrimaryAction: {
    flex: 1.2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 18,
    backgroundColor: '#ea5455',
    paddingVertical: 14,
  },
  heroPrimaryActionText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  heroSecondaryAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 18,
    backgroundColor: '#f1e9ff',
    paddingVertical: 14,
  },
  heroSecondaryActionText: { color: '#7b57d1', fontSize: 13, fontWeight: '900' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 22,
    padding: 18,
    shadowColor: '#14092c',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.03,
    shadowRadius: 12,
    elevation: 2,
    marginBottom: 14,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  iconCircle: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  cardHeaderCopy: { flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: '900', color: '#111' },
  cardSubtitle: { marginTop: 3, fontSize: 12, color: '#8f8f96', lineHeight: 18, fontWeight: '600' },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#f4f2fb',
  },
  metricLabel: { flex: 0.9, fontSize: 12, fontWeight: '800', color: '#8f8f96', textTransform: 'uppercase' },
  metricValue: { flex: 1.1, fontSize: 13, fontWeight: '800', color: '#111', textAlign: 'right', lineHeight: 18 },
  statusValue: { color: '#1f9d55' },
  riskValue: { color: '#ea5455' },
  inlineMapButton: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 16,
    backgroundColor: '#f2ebff',
    paddingVertical: 12,
  },
  inlineMapButtonText: { color: '#7b57d1', fontSize: 13, fontWeight: '900' },
  emptyTimelineText: { color: '#8f8f96', fontSize: 13, fontWeight: '600' },
  timelineList: { gap: 0 },
  timelineRow: { flexDirection: 'row', alignItems: 'stretch', gap: 12, paddingVertical: 8 },
  timelineRail: { width: 14, alignItems: 'center' },
  timelineDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#7b57d1', marginTop: 4 },
  timelineLine: { flex: 1, width: 2, backgroundColor: '#e2dbf7', marginTop: 4 },
  timelineTextWrap: { flex: 1 },
  timelineType: {
    fontSize: 12,
    fontWeight: '800',
    color: '#7b57d1',
    textTransform: 'uppercase',
    letterSpacing: 0.2,
  },
  timelineLabel: { marginTop: 3, fontSize: 13, fontWeight: '800', color: '#111', lineHeight: 18 },
  timelineTime: { marginTop: 4, fontSize: 12, fontWeight: '600', color: '#8f8f96' },
  timelineLocation: { marginTop: 4, fontSize: 12, fontWeight: '600', color: '#5c5b66', lineHeight: 18 },
  evidenceRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 14 },
  evidenceIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f2ebff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  evidenceCopy: { flex: 1 },
  evidenceTitle: { fontSize: 13, fontWeight: '900', color: '#111' },
  evidenceMeta: { marginTop: 4, fontSize: 12, fontWeight: '600', color: '#8f8f96' },
  viewButton: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 14,
    backgroundColor: '#7b57d1',
  },
  viewButtonText: { fontSize: 12, fontWeight: '900', color: '#fff' },
  reportReadyBox: {
    borderTopWidth: 1,
    borderTopColor: '#f4f2fb',
    paddingTop: 14,
  },
  reportReadyTitle: { fontSize: 12, fontWeight: '800', color: '#8f8f96', textTransform: 'uppercase' },
  reportReadyValue: { marginTop: 6, fontSize: 18, fontWeight: '900', color: '#22153f' },
  reportReadyText: { marginTop: 8, color: '#5c5b66', fontSize: 12, lineHeight: 18, fontWeight: '600' },
});
