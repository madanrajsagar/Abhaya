import { Audio } from 'expo-av';

import journeyAPI from './journey';

const AUDIO_SEGMENT_MS = 7000;
const METERING_INTERVAL_MS = 250;
const MAX_RECENT_SAMPLES = 12;
const SCREAM_SUSTAINED_DB_THRESHOLD = -12;
const SCREAM_PEAK_DB_THRESHOLD = -6;
const SCREAM_SPIKE_DB_DELTA = 24;
const DEFAULT_AUDIO_TYPE = 'audio/mp4';
const DEFAULT_AUDIO_EXTENSION = '.m4a';

const PANIC_KEYWORD_GROUPS = {
  help: ['help', 'help me', 'emergency', 'save me'],
  vachva: ['vachva', 'vaachva', 'vachava', 'wachva', 'vachao'],
  madat: ['madat', 'madad', 'madat kara', 'mala madat kara'],
  soda: ['soda', 'sodha', 'sod', 'mala soda', 'chhoda', 'chhodo', 'chhod do', 'chod do'],
  bachao: ['bachao', 'bachav', 'bachao bachao'],
};

const KEYWORD_VARIANTS = Object.values(PANIC_KEYWORD_GROUPS).flat();

const RECORDING_OPTIONS = {
  isMeteringEnabled: true,
  android: {
    extension: '.m4a',
    outputFormat:
      Audio.AndroidOutputFormat?.MPEG_4 || Audio.RECORDING_OPTION_ANDROID_OUTPUT_FORMAT_MPEG_4,
    audioEncoder:
      Audio.AndroidAudioEncoder?.AAC || Audio.RECORDING_OPTION_ANDROID_AUDIO_ENCODER_AAC,
    sampleRate: 44100,
    numberOfChannels: 1,
    bitRate: 128000,
  },
  ios: {
    extension: '.m4a',
    outputFormat:
      Audio.IOSOutputFormat?.MPEG4AAC || Audio.RECORDING_OPTION_IOS_OUTPUT_FORMAT_MPEG4AAC,
    audioQuality:
      Audio.IOSAudioQuality?.MAX || Audio.RECORDING_OPTION_IOS_AUDIO_QUALITY_MAX,
    sampleRate: 44100,
    numberOfChannels: 1,
    bitRate: 128000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 128000,
  },
};

const stripAccents = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const normalizeTranscript = (value) =>
  stripAccents(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const levenshteinDistance = (left, right) => {
  const a = String(left || '');
  const b = String(right || '');

  if (!a.length) {
    return b.length;
  }

  if (!b.length) {
    return a.length;
  }

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let row = 1; row <= a.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;

    for (let column = 1; column <= b.length; column += 1) {
      const current = previous[column];
      const substitutionCost = a[row - 1] === b[column - 1] ? 0 : 1;

      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + substitutionCost
      );
      diagonal = current;
    }
  }

  return previous[b.length];
};

const getMaxDistance = (keyword) => (String(keyword || '').length <= 4 ? 1 : 2);

const collectMatchedKeywords = (input) => {
  const normalizedTranscript = normalizeTranscript(input);
  if (!normalizedTranscript) {
    return [];
  }

  const transcriptTokens = normalizedTranscript.split(' ').filter(Boolean);
  const matches = [];
  const seen = new Set();

  const addMatch = (keyword) => {
    if (!keyword || seen.has(keyword)) {
      return;
    }

    seen.add(keyword);
    matches.push(keyword);
  };

  KEYWORD_VARIANTS.forEach((keyword) => {
    const normalizedKeyword = normalizeTranscript(keyword);
    if (!normalizedKeyword) {
      return;
    }

    if (normalizedTranscript.includes(normalizedKeyword)) {
      addMatch(normalizedKeyword);
      return;
    }

    const keywordTokens = normalizedKeyword.split(' ').filter(Boolean);
    if (!keywordTokens.length || keywordTokens.length > transcriptTokens.length) {
      return;
    }

    for (let index = 0; index <= transcriptTokens.length - keywordTokens.length; index += 1) {
      const windowPhrase = transcriptTokens.slice(index, index + keywordTokens.length).join(' ');
      if (levenshteinDistance(windowPhrase, normalizedKeyword) <= getMaxDistance(normalizedKeyword)) {
        addMatch(normalizedKeyword);
        break;
      }
    }
  });

  return matches;
};

const average = (values) => {
  if (!Array.isArray(values) || !values.length) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const inferAudioType = (uri) => {
  const normalized = String(uri || '').toLowerCase();

  if (normalized.endsWith('.wav')) {
    return 'audio/wav';
  }

  if (normalized.endsWith('.webm')) {
    return 'audio/webm';
  }

  return DEFAULT_AUDIO_TYPE;
};

const inferAudioName = (uri) => {
  const normalized = String(uri || '').trim();
  if (!normalized) {
    return `audio-segment-${Date.now()}${DEFAULT_AUDIO_EXTENSION}`;
  }

  const parts = normalized.split('/');
  return parts[parts.length - 1] || `audio-segment-${Date.now()}${DEFAULT_AUDIO_EXTENSION}`;
};

class AudioAnalysisService {
  constructor() {
    this.isAnalyzing = false;
    this.currentRecording = null;
    this.onPanicDetected = null;
    this.panicTriggered = false;
    this.analysisPromise = null;
    this.statusListeners = new Set();
    this.debugListeners = new Set();
    this.meteringSamples = [];
    this.debugState = this.createDebugState();
  }

  createDebugState() {
    return {
      isAnalyzing: false,
      latestMetering: null,
      averageMetering: null,
      lastTranscript: '',
      matchedKeywords: [],
      lastEvent: 'idle',
      lastPanicReason: '',
      updatedAt: new Date().toISOString(),
    };
  }

  getStatusSnapshot() {
    return {
      isAnalyzing: this.isAnalyzing,
      updatedAt: this.debugState.updatedAt,
      lastEvent: this.debugState.lastEvent,
    };
  }

  getDebugSnapshot() {
    return {
      ...this.debugState,
      isAnalyzing: this.isAnalyzing,
      matchedKeywords: Array.isArray(this.debugState.matchedKeywords)
        ? [...this.debugState.matchedKeywords]
        : [],
    };
  }

  emitStatus() {
    const snapshot = this.getStatusSnapshot();
    this.statusListeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch {}
    });
  }

  emitDebug() {
    const snapshot = this.getDebugSnapshot();
    this.debugListeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch {}
    });
  }

  setDebugState(partialState) {
    this.debugState = {
      ...this.debugState,
      ...partialState,
      isAnalyzing: this.isAnalyzing,
      updatedAt: new Date().toISOString(),
    };
    this.emitDebug();
  }

  addStatusListener(listener) {
    if (typeof listener !== 'function') {
      return () => {};
    }

    this.statusListeners.add(listener);
    listener(this.getStatusSnapshot());

    return () => {
      this.statusListeners.delete(listener);
    };
  }

  addDebugListener(listener) {
    if (typeof listener !== 'function') {
      return () => {};
    }

    this.debugListeners.add(listener);
    listener(this.getDebugSnapshot());

    return () => {
      this.debugListeners.delete(listener);
    };
  }

  async configureAudioMode() {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
      staysActiveInBackground: false,
    });
  }

  async resetAudioMode() {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
      });
    } catch {}
  }

  async startAnalysis(onPanicDetected) {
    if (typeof onPanicDetected === 'function') {
      this.onPanicDetected = onPanicDetected;
    }

    if (this.isAnalyzing) {
      this.setDebugState({
        lastEvent: 'analysis_already_running',
      });
      return true;
    }

    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission?.granted) {
        this.setDebugState({
          lastEvent: 'microphone_permission_denied',
        });
        return false;
      }

      await this.configureAudioMode();

      this.isAnalyzing = true;
      this.panicTriggered = false;
      this.meteringSamples = [];
      this.setDebugState({
        isAnalyzing: true,
        latestMetering: null,
        averageMetering: null,
        lastTranscript: '',
        matchedKeywords: [],
        lastEvent: 'analysis_started',
        lastPanicReason: '',
      });
      this.emitStatus();

      this.analysisPromise = this.runAnalysisLoop();
      return true;
    } catch (error) {
      this.isAnalyzing = false;
      this.setDebugState({
        isAnalyzing: false,
        lastEvent: `analysis_start_failed: ${error?.message || 'unknown_error'}`,
      });
      this.emitStatus();
      return false;
    }
  }

  async stopAnalysis() {
    const wasAnalyzing = this.isAnalyzing;
    this.isAnalyzing = false;
    this.panicTriggered = false;

    await this.safeStopRecording(this.currentRecording);
    this.currentRecording = null;
    await this.resetAudioMode();

    this.setDebugState({
      isAnalyzing: false,
      latestMetering: null,
      averageMetering: null,
      lastEvent: wasAnalyzing ? 'analysis_stopped' : 'analysis_stop_requested',
    });
    this.emitStatus();
  }

  async runAnalysisLoop() {
    try {
      while (this.isAnalyzing) {
        let segment = null;

        try {
          segment = await this.recordSegment();
        } catch (error) {
          this.setDebugState({
            lastEvent: `recording_failed: ${error?.message || 'unknown_error'}`,
          });
        }

        if (!this.isAnalyzing) {
          break;
        }

        if (segment?.uri && !this.panicTriggered) {
          await this.processSegment(segment);
        }
      }
    } finally {
      this.analysisPromise = null;
    }
  }

  async recordSegment() {
    const recording = new Audio.Recording();
    this.currentRecording = recording;
    this.meteringSamples = [];

    recording.setProgressUpdateInterval(METERING_INTERVAL_MS);
    recording.setOnRecordingStatusUpdate((status) => {
      this.handleRecordingStatus(status);
    });

    await recording.prepareToRecordAsync(RECORDING_OPTIONS);
    await recording.startAsync();

    this.setDebugState({
      latestMetering: null,
      averageMetering: null,
      matchedKeywords: [],
      lastTranscript: '',
      lastEvent: 'segment_recording',
    });

    const startedAt = Date.now();
    while (this.isAnalyzing && Date.now() - startedAt < AUDIO_SEGMENT_MS) {
      // Polling keeps stopAnalysis responsive without racing long timers.
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, METERING_INTERVAL_MS));
    }

    await this.safeStopRecording(recording);
    const uri = recording.getURI();

    this.currentRecording = null;

    if (!uri) {
      this.setDebugState({
        lastEvent: 'segment_missing_uri',
      });
      return null;
    }

    this.setDebugState({
      lastEvent: 'segment_ready_for_transcription',
    });

    return {
      uri,
      type: inferAudioType(uri),
      name: inferAudioName(uri),
    };
  }

  handleRecordingStatus(status) {
    if (!this.isAnalyzing || !status || typeof status.metering !== 'number') {
      return;
    }

    const currentMetering = Number(status.metering);
    const previousAverage = average(this.meteringSamples);
    this.meteringSamples.push(currentMetering);

    if (this.meteringSamples.length > MAX_RECENT_SAMPLES) {
      this.meteringSamples = this.meteringSamples.slice(-MAX_RECENT_SAMPLES);
    }

    const averageMetering = average(this.meteringSamples);

    this.setDebugState({
      latestMetering: currentMetering,
      averageMetering,
      lastEvent: 'metering_update',
    });

    if (this.shouldTriggerScream({ currentMetering, previousAverage })) {
      this.triggerPanic('Scream detected from audio stream');
    }
  }

  shouldTriggerScream({ currentMetering, previousAverage }) {
    if (this.panicTriggered) {
      return false;
    }

    const sustainedCount = this.meteringSamples.filter(
      (sample) => sample >= SCREAM_SUSTAINED_DB_THRESHOLD
    ).length;

    if (sustainedCount >= 4) {
      return true;
    }

    if (
      Number.isFinite(previousAverage) &&
      currentMetering >= SCREAM_PEAK_DB_THRESHOLD &&
      currentMetering - previousAverage >= SCREAM_SPIKE_DB_DELTA
    ) {
      return true;
    }

    return false;
  }

  async processSegment(segment) {
    this.setDebugState({
      lastEvent: 'segment_uploading',
    });

    try {
      const result = await journeyAPI.transcribeAudio({
        uri: segment.uri,
        type: segment.type,
        name: segment.name,
      });

      const transcript = String(result?.transcript || '').trim();
      const backendMatches = Array.isArray(result?.matchedKeywords)
        ? result.matchedKeywords
        : [];
      const matchedKeywords = backendMatches.length
        ? backendMatches
        : collectMatchedKeywords(transcript);

      this.setDebugState({
        lastTranscript: transcript,
        matchedKeywords,
        lastEvent: transcript ? 'segment_transcribed' : 'segment_transcribed_empty',
      });

      if (matchedKeywords.length) {
        this.triggerPanic(`Panic keyword detected in audio: ${matchedKeywords.join(', ')}`);
      }
    } catch (error) {
      this.setDebugState({
        lastEvent: `transcription_failed: ${error?.message || 'unknown_error'}`,
      });
    }
  }

  async safeStopRecording(recording) {
    if (!recording) {
      return;
    }

    try {
      const status = await recording.getStatusAsync().catch(() => null);
      if (status?.isRecording) {
        await recording.stopAndUnloadAsync();
      } else if (status?.canRecord) {
        await recording.stopAndUnloadAsync();
      } else {
        await recording.stopAndUnloadAsync().catch(() => {});
      }
    } catch {}
  }

  triggerPanic(reason) {
    if (this.panicTriggered) {
      return;
    }

    this.panicTriggered = true;
    this.setDebugState({
      lastEvent: 'panic_detected',
      lastPanicReason: reason,
    });

    Promise.resolve()
      .then(async () => {
        await this.stopAnalysis();
      })
      .catch(() => {});

    Promise.resolve()
      .then(() => this.onPanicDetected?.(reason))
      .catch(() => {});
  }

  simulateTranscript(text) {
    const transcript = String(text || '').trim();
    const matchedKeywords = collectMatchedKeywords(transcript);

    this.setDebugState({
      lastTranscript: transcript,
      matchedKeywords,
      lastEvent: 'simulated_transcript_processed',
    });

    if (matchedKeywords.length) {
      this.triggerPanic(`Panic keyword detected in audio: ${matchedKeywords.join(', ')}`);
    }

    return {
      transcript,
      matchedKeywords,
    };
  }
}

const audioAnalysisService = new AudioAnalysisService();

export {
  AUDIO_SEGMENT_MS,
  SCREAM_PEAK_DB_THRESHOLD,
  SCREAM_SPIKE_DB_DELTA,
  SCREAM_SUSTAINED_DB_THRESHOLD,
  PANIC_KEYWORD_GROUPS,
  normalizeTranscript,
  collectMatchedKeywords,
};

export default audioAnalysisService;
