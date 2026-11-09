const express = require('express');
const { DEFAULT_RECIPIENTS, sendEmergencyEmail } = require('../services/emailService');
const logger = require('../utils/logger');

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const report = req?.body?.report;
    const recipients = Array.isArray(req?.body?.recipients) ? req.body.recipients : DEFAULT_RECIPIENTS;
    const deliveryPreferences =
      req?.body?.deliveryPreferences && typeof req.body.deliveryPreferences === 'object'
        ? req.body.deliveryPreferences
        : {};
    if (!report || typeof report !== 'object') {
      return res.status(400).json({ success: false, error: 'report is required.' });
    }

    const result = await sendEmergencyEmail(report, recipients, deliveryPreferences);

    if (!result?.success) {
      logger.warn('Emergency alert route failed', {
        incidentId: report?.incidentId,
        error: result?.error || 'Failed to send emergency email.',
        channels: result?.channels || null,
      });

      return res.status(502).json({
        success: false,
        error: result?.error || 'Failed to send emergency alert.',
        message: result?.message || 'Emergency alert delivery failed.',
        channels: result?.channels || null,
      });
    }

    return res.json({
      success: true,
      message: result?.message || 'Emergency alert delivered.',
      channels: result?.channels || null,
    });
  } catch (error) {
    logger.error('Emergency alert route crashed', {
      error: error?.message || String(error),
    });

    return res.status(500).json({ success: false, error: 'Failed to send emergency alert.' });
  }
});

module.exports = router;

