const express = require('express');
const polyline = require('polyline');

const logger = require('../utils/logger');
const { haversine, minDistanceToRoute } = require('../utils/geo');

const router = express.Router();

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const ORS_DIRECTION_URLS = {
  vehicle: 'https://api.openrouteservice.org/v2/directions/driving-car',
  walking: 'https://api.openrouteservice.org/v2/directions/foot-walking',
};
const FIREBASE_TIMEOUT_MS = Number(process.env.FIREBASE_TIMEOUT_MS || 8000);
const ROUTE_REQUEST_TIMEOUT_MS = Number(process.env.ROUTE_REQUEST_TIMEOUT_MS || 4500);
const GEOCODE_CACHE_TTL_MS = Number(process.env.GEOCODE_CACHE_TTL_MS || 10 * 60 * 1000);
const ROUTE_CACHE_TTL_MS = Number(process.env.ROUTE_CACHE_TTL_MS || 3 * 60 * 1000);
const DEVIATION_THRESHOLD_METRES = Number(
  process.env.DEVIATION_THRESHOLD_METRES || 1000
);
const ROUTE_RADIUS_ATTEMPTS_METRES = [null, 1000, 2500, 5000];
const FAST_ROUTE_RADIUS_ATTEMPTS_METRES = [null, 1000];
const recentRouteCache = new Map();
const recentGeocodeCache = new Map();

const createTimeoutError = () => {
  const error = new Error('Journey provider request timed out.');
  error.code = 'JOURNEY_TIMEOUT';
  return error;
};

const timedJsonFetch = async (url, options, context, timeoutMs = FIREBASE_TIMEOUT_MS) => {
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(timeoutMs),
    });

    const data = await response.json();

    logger.info('Journey provider request completed', {
      context,
      statusCode: response.status,
      durationMs: Date.now() - startedAt,
    });

    return { response, data };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const isTimeout = error.name === 'TimeoutError' || error.name === 'AbortError';

    if (isTimeout) {
      logger.warn('Journey provider request timed out', {
        context,
        timeoutMs,
        durationMs,
      });
      throw createTimeoutError();
    }

    logger.error('Journey provider request failed', {
      context,
      durationMs,
      error: error.message,
    });
    throw error;
  }
};

const requireOrsApiKey = () => {
  const orsApiKey = process.env.ORS_API_KEY;

  if (!orsApiKey) {
    const error = new Error(
      'Backend is missing ORS_API_KEY. Add it to backend/.env and restart the server.'
    );
    error.statusCode = 503;
    throw error;
  }

  return orsApiKey;
};

const parseCoordinate = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const getProviderMessage = (routeResponse) =>
  routeResponse.data?.error?.message ||
  routeResponse.data?.error ||
  'Unable to plan route.';

const isUnroutablePointError = (routeResponse) =>
  routeResponse.response.status === 400 &&
  (String(routeResponse.data?.error?.code || '').includes('2004') ||
    /routable point|radius of/i.test(String(getProviderMessage(routeResponse))));

const buildRouteBody = ({
  originLat,
  originLng,
  destLat,
  destLng,
  includeAlternatives = false,
  radiusMetres = null,
}) => {
  const body = {
    coordinates: [
      [originLng, originLat],
      [destLng, destLat],
    ],
    instructions: false,
  };

  if (includeAlternatives) {
    body.alternative_routes = { target_count: 3 };
  }

  if (Number.isFinite(radiusMetres) && radiusMetres > 0) {
    body.radiuses = [radiusMetres, radiusMetres];
  }

  return body;
};

const toLatLngObject = (point) => ({
  lat: Number(point[0].toFixed(6)),
  lng: Number(point[1].toFixed(6)),
});

const roundCoordinate = (value) => Number(Number(value).toFixed(4));

const getRouteCacheKey = ({
  originLat,
  originLng,
  destLat,
  destLng,
  mode,
  includeAlternatives,
}) =>
  JSON.stringify({
    mode,
    includeAlternatives,
    originLat: roundCoordinate(originLat),
    originLng: roundCoordinate(originLng),
    destLat: roundCoordinate(destLat),
    destLng: roundCoordinate(destLng),
  });

const getCachedRoute = (cacheKey) => {
  const cached = recentRouteCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  if (Date.now() - cached.cachedAt > ROUTE_CACHE_TTL_MS) {
    recentRouteCache.delete(cacheKey);
    return null;
  }

  return cached.data;
};

const setCachedRoute = (cacheKey, data) => {
  recentRouteCache.set(cacheKey, {
    data,
    cachedAt: Date.now(),
  });
};

const getGeocodeCacheKey = (query) => String(query || '').trim().toLowerCase();

const getCachedGeocode = (cacheKey) => {
  const cached = recentGeocodeCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  if (Date.now() - cached.cachedAt > GEOCODE_CACHE_TTL_MS) {
    recentGeocodeCache.delete(cacheKey);
    return null;
  }

  return cached.data;
};

const setCachedGeocode = (cacheKey, data) => {
  recentGeocodeCache.set(cacheKey, {
    data,
    cachedAt: Date.now(),
  });
};

const buildFallbackRoute = ({ originLat, originLng, destLat, destLng, mode = 'vehicle' }) => {
  const totalDistanceMetres = haversine(originLat, originLng, destLat, destLng);
  const segmentCount = Math.max(12, Math.min(60, Math.ceil(totalDistanceMetres / 5000)));
  const route = [];

  for (let index = 0; index <= segmentCount; index += 1) {
    const ratio = index / segmentCount;
    route.push([
      Number((originLat + (destLat - originLat) * ratio).toFixed(6)),
      Number((originLng + (destLng - originLng) * ratio).toFixed(6)),
    ]);
  }

  const distanceKm = Number((totalDistanceMetres / 1000).toFixed(2));
  const assumedSpeedKmPerHour = mode === 'walking' ? 4.5 : 45;
  const etaMinutes = Number(((distanceKm / assumedSpeedKmPerHour) * 60).toFixed(1));

  return {
    route,
    eta: etaMinutes,
    distance_km: distanceKm,
    alternatives: [],
    resolvedOrigin: { lat: route[0][0], lng: route[0][1] },
    resolvedDestination: {
      lat: route[route.length - 1][0],
      lng: route[route.length - 1][1],
    },
    fallback: true,
    provider: 'straight_line_fallback',
    mode,
  };
};

router.get('/geocode', async (req, res) => {
  const query = String(req.query.query || '').trim();
  const geocodeCacheKey = getGeocodeCacheKey(query);

  logger.info('Journey geocode requested', {
    queryLength: query.length,
  });

  if (!query) {
    return res.status(400).json({
      success: false,
      error: 'Destination query is required.',
    });
  }

  try {
    const cachedResults = getCachedGeocode(geocodeCacheKey);
    if (cachedResults) {
      logger.info('Journey geocode served from cache', {
        queryLength: query.length,
        results: cachedResults.length,
      });

      return res.json({
        success: true,
        data: cachedResults,
      });
    }

    const url = new URL(NOMINATIM_URL);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('q', query);
    url.searchParams.set('countrycodes', 'in');
    url.searchParams.set('limit', '5');

    const { response, data } = await timedJsonFetch(
      url.toString(),
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'AbhayaJourney/1.0',
        },
      },
      'journeyGeocode'
    );

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: 'Unable to geocode the destination right now.',
      });
    }

    const results = Array.isArray(data)
      ? data.map((item) => ({
          displayName: item.display_name,
          lat: Number(item.lat),
          lng: Number(item.lon),
        }))
      : [];

    logger.info('Journey geocode completed', {
      results: results.length,
    });

    setCachedGeocode(geocodeCacheKey, results);

    return res.json({
      success: true,
      data: results,
    });
  } catch (error) {
    if (error.code === 'JOURNEY_TIMEOUT') {
      return res.status(504).json({
        success: false,
        error: 'Destination search is taking too long. Please try again.',
      });
    }

    logger.error('Journey geocode failed', {
      error: error.message,
    });

    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'Failed to geocode destination.',
    });
  }
});

router.get('/route', async (req, res) => {
  const originLat = parseCoordinate(req.query.origin_lat);
  const originLng = parseCoordinate(req.query.origin_lng);
  const destLat = parseCoordinate(req.query.dest_lat);
  const destLng = parseCoordinate(req.query.dest_lng);
  const mode = String(req.query.mode || '').toLowerCase() === 'walking' ? 'walking' : 'vehicle';
  const includeAlternatives = String(req.query.include_alternatives || 'true').toLowerCase() !== 'false';
  const orsDirectionsUrl = ORS_DIRECTION_URLS[mode];
  const cacheKey = getRouteCacheKey({
    originLat,
    originLng,
    destLat,
    destLng,
    mode,
    includeAlternatives,
  });

  logger.info('Journey route requested', {
    originLat,
    originLng,
    destLat,
    destLng,
    mode,
    includeAlternatives,
  });

  if ([originLat, originLng, destLat, destLng].some((value) => value === null)) {
    return res.status(400).json({
      success: false,
      error: 'Valid origin and destination coordinates are required.',
    });
  }

  try {
    const cachedRoute = getCachedRoute(cacheKey);

    if (cachedRoute) {
      logger.info('Journey route served from cache', {
        mode,
        includeAlternatives,
      });

      return res.json({
        success: true,
        data: cachedRoute,
      });
    }

    const orsApiKey = requireOrsApiKey();
    const radiusAttempts = includeAlternatives
      ? ROUTE_RADIUS_ATTEMPTS_METRES
      : FAST_ROUTE_RADIUS_ATTEMPTS_METRES;

    const headers = {
      Authorization: orsApiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json, application/geo+json',
    };

    let routeResponse = null;

    for (const radiusMetres of radiusAttempts) {
      const attemptBodies = includeAlternatives
        ? [
            buildRouteBody({
              originLat,
              originLng,
              destLat,
              destLng,
              includeAlternatives: true,
              radiusMetres,
            }),
            buildRouteBody({
              originLat,
              originLng,
              destLat,
              destLng,
              includeAlternatives: false,
              radiusMetres,
            }),
          ]
        : [
            buildRouteBody({
              originLat,
              originLng,
              destLat,
              destLng,
              includeAlternatives: false,
              radiusMetres,
            }),
          ];

      for (const [attemptIndex, requestBody] of attemptBodies.entries()) {
        routeResponse = await timedJsonFetch(
          orsDirectionsUrl,
          {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody),
          },
          radiusMetres
            ? `journeyRouteRadius${radiusMetres}_${attemptIndex + 1}`
            : `journeyRouteDefault_${attemptIndex + 1}`,
          ROUTE_REQUEST_TIMEOUT_MS
        );

        if (routeResponse.response.ok) {
          break;
        }

        if (!isUnroutablePointError(routeResponse)) {
          break;
        }
      }

      if (routeResponse?.response.ok || !isUnroutablePointError(routeResponse)) {
        break;
      }
    }

    if (!routeResponse.response.ok) {
      const providerMessage = getProviderMessage(routeResponse);

      if (routeResponse.response.status >= 500) {
        logger.warn('Journey route provider unavailable, using fallback route', {
          statusCode: routeResponse.response.status,
          providerMessage,
        });

        return res.json({
          success: true,
          data: buildFallbackRoute({
            originLat,
            originLng,
            destLat,
            destLng,
            mode,
          }),
        });
      }

      logger.warn('Journey route failed', {
        statusCode: routeResponse.response.status,
        providerMessage,
      });

      return res.status(routeResponse.response.status).json({
        success: false,
        error: `Route planning failed: ${providerMessage}`,
      });
    }

    const routes = (routeResponse.data.routes || []).map((item) => {
      const decodedPoints = polyline.decode(item.geometry);
      const route = decodedPoints.map(([lat, lng]) => [lat, lng]);

      return {
        route,
        eta: Number((item.summary.duration / 60).toFixed(1)),
        distance_km: Number((item.summary.distance / 1000).toFixed(2)),
      };
    });

    if (routes.length === 0) {
      logger.warn('Journey route provider returned no routes, using fallback route', {
        originLat,
        originLng,
        destLat,
        destLng,
      });

      const fallbackRoute = buildFallbackRoute({
        originLat,
        originLng,
        destLat,
        destLng,
        mode,
      });
      setCachedRoute(cacheKey, fallbackRoute);

      return res.json({
        success: true,
        data: fallbackRoute,
      });
    }

    const responseData = {
      route: routes[0].route,
      eta: routes[0].eta,
      distance_km: routes[0].distance_km,
      alternatives: routes.slice(1),
      resolvedOrigin: routes[0].route.length ? toLatLngObject(routes[0].route[0]) : null,
      resolvedDestination: routes[0].route.length
        ? toLatLngObject(routes[0].route[routes[0].route.length - 1])
        : null,
      mode,
    };
    setCachedRoute(cacheKey, responseData);

    logger.info('Journey route planned', {
      mainRoutePoints: routes[0].route.length,
      alternatives: Math.max(routes.length - 1, 0),
      resolvedDestination: routes[0].route.length
        ? toLatLngObject(routes[0].route[routes[0].route.length - 1])
        : null,
    });

    return res.json({
      success: true,
      data: responseData,
    });
  } catch (error) {
    if (error.code === 'JOURNEY_TIMEOUT') {
      logger.warn('Journey route timed out, using fallback route', {
        originLat,
        originLng,
        destLat,
        destLng,
      });

      const fallbackRoute = buildFallbackRoute({
        originLat,
        originLng,
        destLat,
        destLng,
        mode,
      });
      setCachedRoute(cacheKey, fallbackRoute);

      return res.json({
        success: true,
        data: fallbackRoute,
      });
    }

    if (/fetch failed/i.test(String(error.message || ''))) {
      logger.warn('Journey route fetch failed, using fallback route', {
        originLat,
        originLng,
        destLat,
        destLng,
      });

      const fallbackRoute = buildFallbackRoute({
        originLat,
        originLng,
        destLat,
        destLng,
        mode,
      });
      setCachedRoute(cacheKey, fallbackRoute);

      return res.json({
        success: true,
        data: fallbackRoute,
      });
    }

    logger.error('Journey route crashed', {
      error: error.message,
    });

    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'Failed to plan route.',
    });
  }
});

router.post('/check-deviation', async (req, res) => {
  const userLat = parseCoordinate(req.body.user_lat);
  const userLng = parseCoordinate(req.body.user_lng);
  const route = Array.isArray(req.body.route) ? req.body.route : [];

  if (userLat === null || userLng === null || route.length < 2) {
    return res.status(400).json({
      success: false,
      error: 'Valid user location and route are required.',
    });
  }

  const distance = minDistanceToRoute(userLat, userLng, route);
  const deviated = distance > DEVIATION_THRESHOLD_METRES;

  logger.info('Journey deviation checked', {
    userLat: Number(userLat.toFixed(6)),
    userLng: Number(userLng.toFixed(6)),
    distance: Number(distance.toFixed(2)),
    deviated,
    threshold: DEVIATION_THRESHOLD_METRES,
    routePoints: route.length,
  });

  return res.json({
    success: true,
    data: {
      deviated,
      distance: Number(distance.toFixed(2)),
      threshold: DEVIATION_THRESHOLD_METRES,
    },
  });
});

router.post('/sos', async (req, res) => {
  const userLat = parseCoordinate(req.body.user_lat);
  const userLng = parseCoordinate(req.body.user_lng);
  const reason = String(req.body.reason || 'manual_sos');

  if (userLat === null || userLng === null) {
    return res.status(400).json({
      success: false,
      error: 'Valid user location is required for SOS.',
    });
  }

  const mapLink = `https://www.openstreetmap.org/?mlat=${userLat}&mlon=${userLng}#map=17/${userLat}/${userLng}`;
  const message = `EMERGENCY: Abhaya journey alert (${reason}). Track live location: ${mapLink}`;

  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioAuth = process.env.TWILIO_AUTH_TOKEN;
  const twilioFrom = process.env.TWILIO_FROM_NUMBER;
  const parentNumber = process.env.EMERGENCY_CONTACT_NUMBER;
  const policeNumber = process.env.POLICE_CONTACT_NUMBER;

  logger.warn('Journey SOS triggered', {
    reason,
    userLat: Number(userLat.toFixed(6)),
    userLng: Number(userLng.toFixed(6)),
    mapLink,
    hasTwilio: Boolean(twilioSid && twilioAuth && twilioFrom),
  });

  if (twilioSid && twilioAuth && twilioFrom) {
    try {
      const { Twilio } = require('twilio');
      const client = new Twilio(twilioSid, twilioAuth);

      if (parentNumber) {
        await client.messages.create({
          body: message,
          from: twilioFrom,
          to: parentNumber,
        });
      }

      if (policeNumber) {
        await client.messages.create({
          body: message,
          from: twilioFrom,
          to: policeNumber,
        });
      }
    } catch (error) {
      logger.error('Journey SOS delivery failed', {
        error: error.message,
      });
    }
  }

  return res.json({
    success: true,
    message: 'SOS alert recorded.',
    data: { mapLink },
  });
});

module.exports = router;
