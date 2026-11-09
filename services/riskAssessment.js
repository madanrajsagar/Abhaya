import crimeZones from '../kolhapur_crime_zones.json';

/**
 * Calculate distance between two coordinates using Haversine formula
 * Returns distance in meters
 */
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371000; // Earth's radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

/**
 * Get time-based risk multiplier
 * Night hours (8 PM - 6 AM) have higher risk
 */
const getTimeMultiplier = () => {
  const now = new Date();
  const hour = now.getHours();

  if (hour >= 20 || hour < 6) {
    // Night: 8 PM - 6 AM
    return 1.5;
  } else if (hour >= 6 && hour < 9) {
    // Early morning: 6 AM - 9 AM (moderate risk)
    return 1.2;
  } else if (hour >= 17 && hour < 20) {
    // Evening: 5 PM - 8 PM (moderate risk)
    return 1.2;
  } else {
    // Day: 9 AM - 5 PM
    return 1.0;
  }
};

/**
 * Get current location's crime zone risk
 * Also returns baseline risk if in Kolhapur
 */
const getLocationRiskDetails = (latitude, longitude) => {
  if (!latitude || !longitude) {
    return {
      locationRisk: 0,
      insideZone: false,
      insideDangerZone: false,
      activeZone: null,
    };
  }

  let maxRisk = 0;
  let insideZone = false;
  let insideDangerZone = false;
  let activeZone = null;

  // Check proximity to crime zones
  crimeZones.forEach((zone) => {
    const distance = calculateDistance(latitude, longitude, zone.latitude, zone.longitude);
    const isInsideZone = distance <= zone.radius;
    const isDangerZone = zone.risk === 'high' || zone.risk === 'medium';

    if (isInsideZone) {
      insideZone = true;
      if (isDangerZone) {
        insideDangerZone = true;
      }

      const riskValue =
        zone.risk === 'high' ? 95 : zone.risk === 'medium' ? 82 : 45;

      if (riskValue >= maxRisk) {
        maxRisk = riskValue;
        activeZone = {
          ...zone,
          distance: Math.round(distance),
          insideZone: true,
        };
      }
    } else if (distance <= zone.radius * 2) {
      const baseRisk = zone.risk === 'high' ? 75 : zone.risk === 'medium' ? 55 : 25;
      const proximityRisk = baseRisk * 0.6;

      if (proximityRisk >= maxRisk) {
        maxRisk = proximityRisk;
        activeZone = {
          ...zone,
          distance: Math.round(distance),
          insideZone: false,
        };
      }
    }
  });

  // If not in any crime zone but in Kolhapur area, apply baseline risk
  if (maxRisk === 0) {
    const kolhapurLat = 16.70;
    const kolhapurLon = 74.23;
    const distToKolhapur = calculateDistance(latitude, longitude, kolhapurLat, kolhapurLon);

    if (distToKolhapur < 10000) {
      maxRisk = 20;
    }
  }

  return {
    locationRisk: maxRisk,
    insideZone,
    insideDangerZone,
    activeZone,
  };
};

/**
 * Calculate deviation from planned route
 * Returns deviation percentage (0-100)
 */
const calculateRouteDeviation = (currentLocation, plannedRoute) => {
  if (!currentLocation || !plannedRoute || plannedRoute.length === 0) {
    return 0;
  }

  const { latitude: curLat, longitude: curLon } = currentLocation;

  // Find the closest point on the planned route
  let minDistance = Infinity;
  plannedRoute.forEach((point) => {
    const distance = calculateDistance(curLat, curLon, point.latitude, point.longitude);
    minDistance = Math.min(minDistance, distance);
  });

  // If more than 200 meters away from route, consider it deviation
  // Convert to percentage: 200m = 0% deviation, 2000m = 100% deviation
  const deviationDistance = Math.max(0, minDistance - 200);
  const deviationPercentage = Math.min(100, (deviationDistance / 1800) * 100);

  return deviationPercentage;
};

/**
 * Calculate activity-based risk adjustment
 * Returns risk multiplier
 */
const getActivityRiskMultiplier = (isJourneyActive, isDeviated) => {
  let multiplier = 1.0;

  if (isJourneyActive) {
    if (isDeviated) {
      // Significant deviation during journey = HIGH RISK
      multiplier = 1.5; // Increase risk when deviating from planned route
    } else {
      // On track journey = lower risk
      multiplier = 0.8;
    }
  } else {
    // No active journey tracking = normal risk
    multiplier = 1.0;
  }

  return multiplier;
};

/**
 * Main risk assessment function
 * Returns comprehensive risk data
 * Considers ALL parameters: Location + Time + Activity equally
 */
export const calculateRiskPercentage = (locationData, journeyData) => {
  const {
    latitude = null,
    longitude = null,
  } = locationData || {};

  const {
    isActive = false,
    plannedRoute = [],
    destination = null,
  } = journeyData || {};

  // ===== PARAMETER 1: LOCATION RISK (0-100) =====
  const locationRiskDetails = getLocationRiskDetails(latitude, longitude);
  const locationRisk = locationRiskDetails.locationRisk;

  // ===== PARAMETER 2: TIME-BASED RISK (0-100) =====
  const hour = new Date().getHours();
  const isNight = hour >= 20 || hour < 6;
  const isEarlyMorning = hour >= 6 && hour < 9;
  const isEvening = hour >= 17 && hour < 20;
  
  let timeRisk = 20; // Base day risk
  if (isNight) {
    timeRisk = 65; // Night is significantly more dangerous
  } else if (isEarlyMorning || isEvening) {
    timeRisk = 45; // Transition hours are moderate-high risk
  }

  // ===== PARAMETER 3: ACTIVITY RISK (0-100) =====
  // Calculate route deviation
  const deviationPercentage = isActive
    ? calculateRouteDeviation({ latitude, longitude }, plannedRoute)
    : 0;

  const isDeviated = deviationPercentage > 30;
  
  let activityRisk = 30; // Base: no active journey = moderate risk
  
  if (isActive) {
    if (isDeviated) {
      // Significantly off-route: very high activity risk
      activityRisk = 70 + (deviationPercentage / 100) * 30; // 70-100%
    } else {
      // On-track journey: lower activity risk
      activityRisk = 15; // 15% - you're being tracked
    }
  }

  // ===== COMBINED RISK CALCULATION =====
  // Equal weight to all three parameters (33% each)
  // This ensures location + time + activity are all considered fairly
  const averageRisk = (locationRisk + timeRisk + activityRisk) / 3;
  
  // Apply adjustment based on combination scenarios
  let finalRisk = averageRisk;
  
  // Critical scenarios: multiple high-risk factors
  if (locationRisk >= 50 && timeRisk >= 50 && activityRisk >= 50) {
    // All three high: multiplicative effect
    finalRisk = Math.min(100, averageRisk * 1.3);
  } else if (locationRisk >= 60 && timeRisk >= 60) {
    // High crime zone + night: very dangerous
    finalRisk = Math.min(100, averageRisk * 1.2);
  } else if (isDeviated && timeRisk >= 45) {
    // Deviated during unsafe hours: concerning
    finalRisk = Math.min(100, averageRisk * 1.15);
  }

  if (locationRiskDetails.insideDangerZone) {
    finalRisk = Math.max(finalRisk, locationRisk >= 90 ? 88 : 76);
  } else if (locationRiskDetails.insideZone) {
    finalRisk = Math.max(finalRisk, 52);
  }

  // Cap at 100
  finalRisk = Math.min(100, Math.max(0, finalRisk));

  // Determine risk level
  let riskLevel = 'Low';
  let riskColor = '#22c55e'; // Green
  if (finalRisk >= 75) {
    riskLevel = 'Critical';
    riskColor = '#dc2626'; // Red
  } else if (finalRisk >= 50) {
    riskLevel = 'High';
    riskColor = '#f97316'; // Orange
  } else if (finalRisk >= 30) {
    riskLevel = 'Medium';
    riskColor = '#eab308'; // Yellow
  }

  return {
    percentage: Math.round(finalRisk),
    level: riskLevel,
    color: riskColor,
    locationRisk: Math.round(locationRisk),
    timeRisk: Math.round(timeRisk),
    activityRisk: Math.round(activityRisk),
    deviationPercentage: Math.round(deviationPercentage),
    isDeviated,
    insideDangerZone: locationRiskDetails.insideDangerZone,
    insideZone: locationRiskDetails.insideZone,
    activeZone: locationRiskDetails.activeZone,
    timeOfDay: getTimeOfDay(),
    nearbyZones: getNearbyZones(latitude, longitude),
  };
};

/**
 * Get human-readable time of day
 */
const getTimeOfDay = () => {
  const hour = new Date().getHours();

  if (hour >= 20 || hour < 6) {
    return 'Night';
  } else if (hour >= 6 && hour < 12) {
    return 'Morning';
  } else if (hour >= 12 && hour < 17) {
    return 'Afternoon';
  } else {
    return 'Evening';
  }
};

/**
 * Get nearby crime zones within 1 km radius
 */
const getNearbyZones = (latitude, longitude, maxZones = 3) => {
  if (!latitude || !longitude) return [];

  const nearby = crimeZones
    .map((zone) => ({
      ...zone,
      distance: calculateDistance(latitude, longitude, zone.latitude, zone.longitude),
    }))
    .filter((zone) => zone.distance <= 1000) // Within 1 km
    .sort((a, b) => a.distance - b.distance)
    .slice(0, maxZones)
    .map(({ distance, ...zone }) => ({
      ...zone,
      distance: Math.round(distance),
    }));

  return nearby;
};

/**
 * Get safety recommendations based on risk assessment
 * Returns EXACTLY 3 proper safety tips based on all parameters
 */
export const getSafetyRecommendations = (riskData) => {
  const recommendations = [];

  // ===== TIP 1: Risk-Level Based Safety Action =====
  if (riskData.percentage >= 75) {
    recommendations.push('🚨 CRITICAL: Avoid travel if possible. If you must go out, use trusted transport and stay in populated areas only.');
  } else if (riskData.percentage >= 50) {
    recommendations.push('⚠️ HIGH RISK: Travel with a companion and keep emergency contacts informed of your location every 15 minutes.');
  } else if (riskData.percentage >= 30) {
    recommendations.push('ℹ️ MODERATE RISK: Stay alert, use main roads, and keep your phone charged and accessible at all times.');
  } else {
    recommendations.push('✓ LOW RISK: Your surroundings appear relatively safe. Continue to stay aware of your environment.');
  }

  // ===== TIP 2: Time-Based Safety Recommendation =====
  if (riskData.timeOfDay === 'Night') {
    recommendations.push('🌙 NIGHT TRAVEL: Inform someone of your exact location and ETA. Avoid isolated routes and stay in well-lit areas.');
  } else if (riskData.timeOfDay === 'Morning') {
    recommendations.push('🌅 EARLY MORNING: Use well-populated routes. Avoid shortcuts through deserted areas or parks.');
  } else if (riskData.timeOfDay === 'Evening') {
    recommendations.push('🌆 EVENING HOURS: Head to your destination before dark. Avoid loitering and stay in busy, commercial zones.');
  } else {
    recommendations.push('☀️ DAYTIME: While generally safer, remain aware of your surroundings and trust your instincts.');
  }

  // ===== TIP 3: Location + Activity Specific Action =====
  if (riskData.isDeviated && riskData.deviationPercentage > 30) {
    recommendations.push(`📍 ROUTE DEVIATION: You are ${riskData.deviationPercentage}% off your planned path. Return to your planned route or inform contacts of the change.`);
  } else if (riskData.nearbyZones && riskData.nearbyZones.length > 0) {
    const zone = riskData.nearbyZones[0];
    recommendations.push(`⚠️ NEARBY RISK ZONE: ${zone.name} is only ${zone.distance}m away. Exercise extra caution and keep moving through the area.`);
  } else if (riskData.locationRisk >= 60) {
    recommendations.push('📍 HIGH-CRIME AREA: You are in a known high-risk zone. Avoid stopping, use your phone discreetly, and keep moving.');
  } else {
    recommendations.push('📍 LOCATION SAFE: Your current area has low crime reports. Continue staying aware and trust your instincts.');
  }

  return recommendations;
};

export default {
  calculateRiskPercentage,
  getSafetyRecommendations,
  calculateDistance,
};
