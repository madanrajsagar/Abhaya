const express = require('express');
const multer = require('multer');

const logger = require('../utils/logger');

const router = express.Router();

const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const GROQ_TRANSCRIPTION_MODEL =
  process.env.GROQ_TRANSCRIPTION_MODEL || 'whisper-large-v3-turbo';
const GROQ_TIMEOUT_MS = Number(process.env.GROQ_TIMEOUT_MS || 15000);
const GROQ_API_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

const PANIC_KEYWORD_GROUPS = {
  help: ['help', 'help me', 'emergency', 'save me'],
  vachva: ['vachva', 'vaachva', 'vachava', 'wachva', 'vachao'],
  madat: ['madat', 'madad', 'madat kara', 'mala madat kara'],
  soda: ['soda', 'sodha', 'sod', 'mala soda', 'chhoda', 'chhodo', 'chhod do', 'chod do'],
  bachao: ['bachao', 'bachav', 'bachao bachao'],
};

const KEYWORD_VARIANTS = Object.values(PANIC_KEYWORD_GROUPS).flat();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_AUDIO_BYTES,
  },
});

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

const buildPrompt = () =>
  [
    'This is emergency monitoring audio from India.',
    'Listen carefully for short panic words and transliterations.',
    `Possible panic words: ${KEYWORD_VARIANTS.join(', ')}.`,
    'Transcribe the speech exactly, even if it is only one or two words.',
  ].join(' ');

const transcribeWithGroq = async ({ file, language }) => {
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) {
    const error = new Error('Backend is missing GROQ_API_KEY. Add it to backend/.env and restart the server.');
    error.statusCode = 503;
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);

  try {
    const form = new FormData();
    const audioBlob = new Blob([file.buffer], {
      type: file.mimetype || 'audio/mp4',
    });

    form.append('file', audioBlob, file.originalname || 'emergency-audio.m4a');
    form.append('model', GROQ_TRANSCRIPTION_MODEL);
    form.append('prompt', buildPrompt());
    form.append('temperature', '0');
    form.append('response_format', 'json');

    if (language) {
      form.append('language', language);
    }

    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
      },
      body: form,
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = new Error(payload?.error?.message || 'Groq transcription failed.');
      error.statusCode = response.status;
      throw error;
    }

    const transcript = String(payload?.text || payload?.transcript || '').trim();
    return {
      transcript,
      matchedKeywords: collectMatchedKeywords(transcript),
      language,
    };
  } finally {
    clearTimeout(timeout);
  }
};

router.post('/transcribe', (req, res) => {
  upload.single('audio')(req, res, async (error) => {
    if (error) {
      const statusCode = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(statusCode).json({
        success: false,
        error:
          error.code === 'LIMIT_FILE_SIZE'
            ? 'Audio upload exceeds the 12 MB limit.'
            : error.message || 'Audio upload failed.',
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Audio file is required in the "audio" field.',
      });
    }

    try {
      const primaryResult = await transcribeWithGroq({ file: req.file });
      if (primaryResult.matchedKeywords.length) {
        return res.json({
          success: true,
          data: {
            transcript: primaryResult.transcript,
            matchedKeywords: primaryResult.matchedKeywords,
            languageRetry: null,
          },
        });
      }

      let bestResult = primaryResult;

      for (const language of ['mr', 'hi']) {
        // eslint-disable-next-line no-await-in-loop
        const retryResult = await transcribeWithGroq({ file: req.file, language });
        if (retryResult.transcript.length > bestResult.transcript.length) {
          bestResult = retryResult;
        }

        if (retryResult.matchedKeywords.length) {
          logger.warn('Emergency audio keywords detected after language retry', {
            language,
            matchedKeywords: retryResult.matchedKeywords,
          });

          return res.json({
            success: true,
            data: {
              transcript: retryResult.transcript,
              matchedKeywords: retryResult.matchedKeywords,
              languageRetry: language,
            },
          });
        }
      }

      return res.json({
        success: true,
        data: {
          transcript: bestResult.transcript,
          matchedKeywords: bestResult.matchedKeywords,
          languageRetry: null,
        },
      });
    } catch (transcriptionError) {
      logger.error('Emergency audio transcription failed', {
        error: transcriptionError.message,
        statusCode: transcriptionError.statusCode || 500,
      });

      return res.status(transcriptionError.statusCode || 500).json({
        success: false,
        error: transcriptionError.message || 'Audio transcription failed.',
      });
    }
  });
});

module.exports = router;
