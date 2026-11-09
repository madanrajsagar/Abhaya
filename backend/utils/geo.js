const EARTH_RADIUS_METRES = 6_371_000;

const haversine = (lat1, lng1, lat2, lng2) => {
  const toRadians = (value) => (value * Math.PI) / 180;

  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const dPhi = toRadians(lat2 - lat1);
  const dLambda = toRadians(lng2 - lng1);

  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;

  return EARTH_RADIUS_METRES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const pointToSegmentDistance = (px, py, ax, ay, bx, by) => {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const segmentLengthSquared = abx * abx + aby * aby;

  if (segmentLengthSquared === 0) {
    return Math.hypot(apx, apy);
  }

  const t = Math.max(
    0,
    Math.min(1, (apx * abx + apy * aby) / segmentLengthSquared)
  );

  const closestX = ax + t * abx;
  const closestY = ay + t * aby;

  return Math.hypot(px - closestX, py - closestY);
};

const minDistanceToRoute = (lat, lng, route = []) => {
  if (!Array.isArray(route) || route.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  let minDistance = Number.POSITIVE_INFINITY;

  for (const [pointLat, pointLng] of route) {
    const distance = haversine(lat, lng, pointLat, pointLng);
    if (distance < minDistance) {
      minDistance = distance;
    }
  }

  for (let index = 0; index < route.length - 1; index += 1) {
    const [aLat, aLng] = route[index];
    const [bLat, bLng] = route[index + 1];

    const degreeDistance = pointToSegmentDistance(lat, lng, aLat, aLng, bLat, bLng);
    if (degreeDistance * 111_000 > minDistance + 50) {
      continue;
    }

    const abx = bLat - aLat;
    const aby = bLng - aLng;
    const apx = lat - aLat;
    const apy = lng - aLng;
    const segmentLengthSquared = abx * abx + aby * aby;

    if (segmentLengthSquared === 0) {
      continue;
    }

    const t = Math.max(
      0,
      Math.min(1, (apx * abx + apy * aby) / segmentLengthSquared)
    );

    const closestLat = aLat + t * abx;
    const closestLng = aLng + t * aby;
    const distance = haversine(lat, lng, closestLat, closestLng);

    if (distance < minDistance) {
      minDistance = distance;
    }
  }

  return minDistance;
};

module.exports = {
  haversine,
  minDistanceToRoute,
};
