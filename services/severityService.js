export const calculateSeverity = ({
  message,
  riskData,
  hasEvidence
}) => {
  let score = 0;

  // 1. Message keywords
  if (message) {
    const msg = message.toLowerCase();
    if (msg.includes("help") || msg.includes("danger")) score += 0.3;
    if (msg.includes("attack") || msg.includes("rape")) score += 0.5;
  }

  // 2. Location risk (already calculated in your app)
  if (riskData) {
    score += (riskData.percentage / 100) * 0.3;
  }

  // 3. Time risk
  if (riskData?.timeRisk > 50) {
    score += 0.2;
  }

  // 4. Evidence
  if (hasEvidence) {
    score += 0.2;
  }

  return Math.min(score, 1);
};

export const getSeverityLevel = (score) => {
  if (score >= 0.7) return "HIGH";
  if (score >= 0.4) return "MEDIUM";
  return "LOW";
};