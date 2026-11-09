const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const express = require('express');
const sharp = require('sharp');

const { admin, adminInitialized } = require('../config/firebase');
const { verifyToken } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

const uploadsDir = path.join(__dirname, '..', 'uploads', 'vehicle-observations');
fs.mkdirSync(uploadsDir, { recursive: true });

const getObservationCollection = (uid) =>
  admin.firestore().collection('users').doc(uid).collection('vehicleObservations');

const ensureFirestore = (res) => {
  if (!adminInitialized) {
    res.status(503).json({
      success: false,
      error:
        'Vehicle observations require Firebase Admin SDK. Add backend/config/serviceAccountKey.json and enable Firestore.',
    });
    return false;
  }

  return true;
};

const sanitizeNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const clampLimit = (value, fallback, max) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }

  return Math.min(Math.floor(numeric), max);
};

const toClientRecord = (doc) => {
  const data = doc.data();

  return {
    id: doc.id,
    ...data,
    createdAt: data.createdAt?.toDate?.().toISOString?.() || data.createdAt || null,
    updatedAt: data.updatedAt?.toDate?.().toISOString?.() || data.updatedAt || null,
  };
};

const parseDataUrl = (dataUrl) => {
  const match = String(dataUrl || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    return null;
  }

  return {
    mimeType: match[1],
    base64: match[2],
  };
};

const extensionFromMime = (mimeType) => {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  return '.jpg';
};

const groqApiKey = process.env.GROQ_API_KEY;
const groqVisionModel =
  process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';
const groqTimeoutMs = Number(process.env.GROQ_TIMEOUT_MS || 15000);
const groqBase64LimitBytes = Number(process.env.GROQ_BASE64_LIMIT_BYTES || 4 * 1024 * 1024);
const groqBase64SafetyBytes = Math.floor(groqBase64LimitBytes * 0.85);
const groqImageMaxDimension = clampLimit(process.env.GROQ_IMAGE_MAX_DIM, 3072, 4096);

const normalizeDetectedText = (value) => {
  const normalized = String(value || '').trim();
  return normalized ? normalized : null;
};

const normalizePlateNumber = (value) => {
  const normalized = normalizeDetectedText(value);
  if (!normalized) {
    return null;
  }

  return normalized.replace(/[^a-zA-Z0-9]+/g, ' ').trim().replace(/\s+/g, ' ').toUpperCase();
};

const parseGroqJson = (content = '') => {
  const raw = String(content || '').trim();

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }

    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
};

const buildGroqVisionDataUrl = async (imageBuffer) => {
  const presets = [
    { maxDim: groqImageMaxDimension, quality: 86 },
    { maxDim: Math.min(groqImageMaxDimension, 2560), quality: 84 },
    { maxDim: Math.min(groqImageMaxDimension, 2048), quality: 82 },
    { maxDim: Math.min(groqImageMaxDimension, 1600), quality: 80 },
    { maxDim: Math.min(groqImageMaxDimension, 1280), quality: 76 },
    { maxDim: Math.min(groqImageMaxDimension, 1024), quality: 70 },
  ].filter(
    (preset, index, list) =>
      preset.maxDim > 0 && list.findIndex((item) => item.maxDim === preset.maxDim) === index
  );

  const base = sharp(imageBuffer).rotate();

  for (const preset of presets) {
    const processed = await base
      .clone()
      .resize({
        width: preset.maxDim,
        height: preset.maxDim,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .sharpen()
      .jpeg({ quality: preset.quality, mozjpeg: true })
      .toBuffer();

    const dataUrl = `data:image/jpeg;base64,${processed.toString('base64')}`;
    if (Buffer.byteLength(dataUrl, 'utf8') <= groqBase64SafetyBytes) {
      return dataUrl;
    }
  }

  return null;
};

const detectVehicleWithGroq = async ({ imageDataUrl }) => {
  if (!groqApiKey) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), groqTimeoutMs);

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: groqVisionModel,
        temperature: 0,
        top_p: 1,
        stream: false,
        response_format: { type: 'json_object' },
        max_completion_tokens: 700,
        messages: [
          {
            role: 'system',
            content:
              'You analyze vehicle photos for a women-safety app. Return only one valid JSON object. Be conservative. Never invent a plate number or hidden detail, and never return driver, owner, or phone details. If a field is not clearly visible, set it to null. Your first priority is OCR: read the visible vehicle registration or license plate exactly. If no usable plate is visible or readable, describe only visible vehicle clues.',
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  [
                    'Inspect this vehicle image and return JSON with exactly these keys:',
                    'vehicleType, vehicleBrand, vehicleModel, vehicleColor, plateNumber, noPlateVisible, confidence, identificationMark.',
                    'Rules:',
                    '1. Return only one JSON object and no extra text.',
                    '2. plateNumber should contain only the readable registration text, normalized with spaces between groups when obvious, for example MH 12 AB 1234.',
                    '3. plateNumber must be null if the plate is missing, cut off, blurred, blocked, too small, glare-covered, or not confidently readable.',
                    '4. Set noPlateVisible=false only when plateNumber is confidently readable. Otherwise set noPlateVisible=true.',
                    '5. If the image is cropped tightly around a plate, focus on plateNumber and set unclear vehicle fields to null.',
                    '6. identificationMark should describe only clearly visible clues such as stickers, bumper guard, helmet hook, roof rail, tarp rope, mirror sticker, scratches, dents, text decals, seat-cover color, or other unique visible marks.',
                    '7. vehicleBrand and vehicleModel must be null if not clearly visible from badge/shape clues.',
                    '8. confidence must be one of: high, medium, low.',
                    '9. Use short values only.',
                    'Example output:',
                    '{"vehicleType":"Car","vehicleBrand":null,"vehicleModel":null,"vehicleColor":"White","plateNumber":"MH 12 AB 1234","noPlateVisible":false,"confidence":"high","identificationMark":null}',
                  ].join(' '),
              },
              {
                type: 'image_url',
                image_url: {
                  url: imageDataUrl,
                },
              },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      logger.warn('Groq vision request failed', {
        statusCode: response.status,
        model: groqVisionModel,
        body: errorBody.slice(0, 500),
      });
      return null;
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    const parsed = parseGroqJson(content);

    if (!parsed) {
      logger.warn('Groq vision response was not valid JSON', {
        model: groqVisionModel,
        contentPreview: String(content || '').slice(0, 300),
      });
      return null;
    }

    return {
      vehicleType: normalizeDetectedText(parsed.vehicleType),
      vehicleBrand: normalizeDetectedText(parsed.vehicleBrand),
      vehicleModel: normalizeDetectedText(parsed.vehicleModel),
      vehicleColor: normalizeDetectedText(parsed.vehicleColor),
      plateNumber:
        typeof parsed.noPlateVisible === 'boolean' && parsed.noPlateVisible
          ? null
          : normalizePlateNumber(parsed.plateNumber),
      noPlateVisible:
        typeof parsed.noPlateVisible === 'boolean' ? parsed.noPlateVisible : null,
      confidence: normalizeDetectedText(parsed.confidence),
      identificationMark: normalizeDetectedText(parsed.identificationMark),
    };
  } catch (error) {
    logger.warn('Groq vision request error', {
      model: groqVisionModel,
      error: error.message,
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

router.get('/', verifyToken, async (req, res) => {
  if (!ensureFirestore(res)) return;

  const limit = clampLimit(req.query.limit, 12, 50);

  try {
    const snapshot = await getObservationCollection(req.user.uid)
      .orderBy('updatedAt', 'desc')
      .limit(limit)
      .get();

    return res.json({
      success: true,
      data: snapshot.docs.map(toClientRecord),
    });
  } catch (error) {
    logger.error('Vehicle observations list failed', {
      uid: req.user.uid,
      error: error.message,
    });

    return res.status(500).json({
      success: false,
      error: 'Failed to load vehicle observations.',
    });
  }
});

router.post('/', verifyToken, async (req, res) => {
  if (!ensureFirestore(res)) return;

  const {
    imageDataUrl,
    noPlate,
    vehicleType,
    vehicleColor,
    vehicleBrand,
    vehicleModel,
    note,
    latitude,
    longitude,
  } = req.body || {};

  if (!imageDataUrl) {
    return res.status(400).json({
      success: false,
      error: 'Vehicle image is required.',
    });
  }

  const parsedImage = parseDataUrl(imageDataUrl);
  if (!parsedImage) {
    return res.status(400).json({
      success: false,
      error: 'Vehicle image must be sent as a valid base64 data URL.',
    });
  }

  if (!groqApiKey) {
    return res.status(503).json({
      success: false,
      error:
        'GROQ_API_KEY is not configured on the backend. Add GROQ_API_KEY to backend/.env and restart the server.',
    });
  }

  try {
    const fileExtension = extensionFromMime(parsedImage.mimeType);
    const imageBuffer = Buffer.from(parsedImage.base64, 'base64');
    const imageFingerprint = crypto.createHash('sha256').update(imageBuffer).digest('hex');
    const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${fileExtension}`;
    const filePath = path.join(uploadsDir, fileName);

    const groqVisionDataUrl = await buildGroqVisionDataUrl(imageBuffer);
    if (!groqVisionDataUrl) {
      return res.status(413).json({
        success: false,
        error:
          'Vehicle image is too large to analyze. Crop the photo around the number plate and try again.',
      });
    }

    const groqDetection = await detectVehicleWithGroq({ imageDataUrl: groqVisionDataUrl });
    if (!groqDetection) {
      return res.status(502).json({
        success: false,
        error: 'Groq vision analysis failed. Please try again with a clearer cropped image.',
      });
    }

    const hasReadablePlate = Boolean(groqDetection.plateNumber);
    const resolvedNoPlate =
      noPlate === true ? true : !hasReadablePlate;
    const trustedVehicleType =
      String(vehicleType || '').trim() || groqDetection?.vehicleType || null;
    const trustedVehicleColor =
      String(vehicleColor || '').trim() || groqDetection?.vehicleColor || null;
    const trustedVehicleBrand =
      String(vehicleBrand || '').trim() || groqDetection?.vehicleBrand || null;
    const trustedVehicleModel =
      String(vehicleModel || '').trim() || groqDetection?.vehicleModel || null;

    const vehicleDetails = {
      plateNumber: groqDetection?.plateNumber || null,
      vehicleType: trustedVehicleType,
      vehicleColor: trustedVehicleColor,
      vehicleBrand: trustedVehicleBrand,
      vehicleModel: trustedVehicleModel,
      identificationMark: groqDetection?.identificationMark || null,
      aiConfidence: groqDetection?.confidence || null,
    };

    fs.writeFileSync(filePath, imageBuffer);

    const payload = {
      noPlate: resolvedNoPlate,
      imageFingerprint,
      vehicleType: trustedVehicleType,
      vehicleColor: trustedVehicleColor,
      vehicleBrand: trustedVehicleBrand,
      vehicleModel: trustedVehicleModel,
      plateNumber: vehicleDetails.plateNumber,
      identificationMark: vehicleDetails.identificationMark,
      vehicleDetails,
      detectionSource: 'groq_vision',
      note: String(note || '').trim() || null,
      imagePath: `uploads/vehicle-observations/${fileName}`,
      imageMimeType: parsedImage.mimeType,
      latitude: sanitizeNumber(latitude),
      longitude: sanitizeNumber(longitude),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const docRef = await getObservationCollection(req.user.uid).add(payload);

    const savedDoc = await docRef.get();

    logger.info('Vehicle observation saved', {
      uid: req.user.uid,
      observationId: docRef.id,
      noPlate: payload.noPlate,
    });

    return res.status(201).json({
      success: true,
      data: toClientRecord(savedDoc),
    });
  } catch (error) {
    logger.error('Vehicle observation save failed', {
      uid: req.user.uid,
      error: error.message,
    });

    return res.status(500).json({
      success: false,
      error: 'Failed to save vehicle observation.',
    });
  }
});

module.exports = router;
