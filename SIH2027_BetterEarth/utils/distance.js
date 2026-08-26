"use strict";

// ============================================================
// utils/distance.js
// Utility functions for geographical distance calculation using
// the Haversine formula, coordinate validation, unit formatting,
// and distance sorting.
// ============================================================

/**
 * Calculates the great-circle distance between two points on Earth
 * using the Haversine formula.
 *
 * @param {number} lat1 Latitude of point 1 in degrees
 * @param {number} lon1 Longitude of point 1 in degrees
 * @param {number} lat2 Latitude of point 2 in degrees
 * @param {number} lon2 Longitude of point 2 in degrees
 * @returns {number} Distance in kilometers
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
    const nLat1 = Number(lat1);
    const nLon1 = Number(lon1);
    const nLat2 = Number(lat2);
    const nLon2 = Number(lon2);

    if (
        isNaN(nLat1) || isNaN(nLon1) ||
        isNaN(nLat2) || isNaN(nLon2)
    ) {
        throw new TypeError("All coordinates must be valid numbers");
    }

    const EARTH_RADIUS_KM = 6371; // Mean radius of Earth in km

    const dLat = toRadians(nLat2 - nLat1);
    const dLon = toRadians(nLon2 - nLon1);

    const radLat1 = toRadians(nLat1);
    const radLat2 = toRadians(nLat2);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(radLat1) * Math.cos(radLat2) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return EARTH_RADIUS_KM * c;
}

function toRadians(degrees) {
    return (degrees * Math.PI) / 180;
}

/**
 * Validates whether latitude and longitude are numeric and within valid geographic bounds.
 *
 * @param {any} lat
 * @param {any} lng
 * @returns {boolean} true if valid, false otherwise
 */
function isValidCoordinate(lat, lng) {
    if (lat === null || lat === undefined || lng === null || lng === undefined) {
        return false;
    }

    const numLat = Number(lat);
    const numLng = Number(lng);

    if (isNaN(numLat) || isNaN(numLng)) {
        return false;
    }

    if (numLat < -90 || numLat > 90) {
        return false;
    }

    if (numLng < -180 || numLng > 180) {
        return false;
    }

    return true;
}

/**
 * Formats distance in kilometers to a human-readable string.
 * Uses meters for distances under 1 km, otherwise rounds to 1 decimal place.
 *
 * @param {number} distanceKm
 * @returns {string} Formatted distance string (e.g. "150 m" or "3.4 km")
 */
function formatDistance(distanceKm) {
    if (distanceKm === null || distanceKm === undefined || isNaN(distanceKm)) {
        return "N/A";
    }

    if (distanceKm < 1) {
        const meters = Math.round(distanceKm * 1000);
        return `${meters} m`;
    }

    return `${distanceKm.toFixed(1)} km`;
}

/**
 * Attaches calculated distance to each location record and sorts in ascending order
 * (nearest location first).
 *
 * @param {Array<Object>} locations List of location objects
 * @param {number} userLat User's latitude
 * @param {number} userLng User's longitude
 * @returns {Array<Object>} New array of location objects sorted by ascending distance
 */
function sortLocationsByDistance(locations, userLat, userLng) {
    if (!Array.isArray(locations)) return [];

    return locations
        .filter(loc => isValidCoordinate(loc.latitude, loc.longitude))
        .map(loc => {
            const dist = calculateDistance(userLat, userLng, loc.latitude, loc.longitude);
            return {
                ...loc,
                distance: dist,
                formattedDistance: formatDistance(dist),
            };
        })
        .sort((a, b) => a.distance - b.distance);
}

module.exports = {
    calculateDistance,
    isValidCoordinate,
    formatDistance,
    sortLocationsByDistance,
};
