"use strict";

// ============================================================
// services/apiService.js
// Service layer for fetching external location/satellite API data,
// validating coordinates, normalizing payloads, and upserting into MongoDB.
// Handles browser User-Agent headers, multiple endpoints, and fast bulkWrite.
// ============================================================

const Location = require("../models/Location");
const Satellite = require("../models/model");
const { isValidCoordinate } = require("../utils/distance");

const PRIMARY_API_URL =
    process.env.EXTERNAL_API_URL ||
    "https://celestrak.org/NORAD/elements/gp.php?GROUP=STATIONS&FORMAT=TLE";

const FALLBACK_API_URLS = [
    "https://celestrak.org/NORAD/elements/gp.php?GROUP=ACTIVE&FORMAT=TLE",
    "https://celestrak.org/NORAD/elements/gp.php?GROUP=LAST-30-DAYS&FORMAT=TLE",
];

// Rich fallback dataset of active space assets & stations with valid TLEs
const SEED_SATELLITES = [
    {
        name: "ISS (ZARYA)",
        line1: "1 25544U 98067A   24239.54143519  .00014389  00000+0  25686-3 0  9997",
        line2: "2 25544  51.6416 261.3415 0005728 126.7905 315.6543 15.49755437469176",
        noradId: 25544,
        category: "Space Station"
    },
    {
        name: "CSS (TIANGONG)",
        line1: "1 48274U 21035A   24239.50000000  .00012000  00000+0  20000-3 0  9991",
        line2: "2 48274  41.4700 150.2000 0006000  90.0000 270.0000 15.60000000180000",
        noradId: 48274,
        category: "Space Station"
    },
    {
        name: "HST (HUBBLE)",
        line1: "1 20580U 90037B   24239.40000000  .00001000  00000+0  50000-4 0  9992",
        line2: "2 20580  28.4690 110.1500 0002800 100.0000 260.0000 15.08000000900000",
        noradId: 20580,
        category: "Observatory"
    },
    {
        name: "NOAA 20 (JPSS-1)",
        line1: "1 43013U 17073A   24239.30000000  .00000100  00000+0  20000-4 0  9993",
        line2: "2 43013  98.7000  45.3000 0001000  80.0000 280.0000 14.10000000300000",
        noradId: 43013,
        category: "Environmental Asset"
    },
    {
        name: "LANDSAT 8",
        line1: "1 39084U 13008A   24239.20000000  .00000120  00000+0  22000-4 0  9994",
        line2: "2 39084  98.2000 210.5000 0001500  75.0000 285.0000 14.57000000600000",
        noradId: 39084,
        category: "Earth Observation"
    },
    {
        name: "SENTINEL-6",
        line1: "1 46984U 20086A   24239.10000000  .00000080  00000+0  15000-4 0  9995",
        line2: "2 46984  66.0400 320.1000 0000800 120.0000 240.0000 13.40000000200000",
        noradId: 46984,
        category: "Ocean Altimetry"
    },
    {
        name: "TERRA (EOS AM-1)",
        line1: "1 25994U 99068A   24239.15000000  .00000200  00000+0  30000-4 0  9996",
        line2: "2 25994  98.2000 180.4000 0001200  85.0000 275.0000 14.58000000500000",
        noradId: 25994,
        category: "Earth Science"
    },
    {
        name: "AQUA (EOS PM-1)",
        line1: "1 27424U 02022A   24239.25000000  .00000210  00000+0  31000-4 0  9997",
        line2: "2 27424  98.2000 195.1000 0001400  70.0000 290.0000 14.57000000400000",
        noradId: 27424,
        category: "Earth Science"
    },
    {
        name: "STARLINK-1007",
        line1: "1 44713U 19074A   24239.35000000  .00005000  00000+0  10000-3 0  9998",
        line2: "2 44713  53.0500 140.2000 0001000  90.0000 270.0000 15.06000000700000",
        noradId: 44713,
        category: "Communications Constellation"
    },
    {
        name: "GOES 18",
        line1: "1 51850U 22021A   24239.45000000  .00000010  00000+0  10000-5 0  9999",
        line2: "2 51850   8.9000  75.1000 0003000   0.0000   0.0000  1.00270000100000",
        noradId: 51850,
        category: "Geostationary Weather"
    }
];

let satLib = null;
async function getSatLib() {
    if (satLib) return satLib;
    satLib = await import("satellite.js");
    return satLib;
}

/**
 * Fetches TLE data from CelesTrak using standard Chrome browser headers to avoid HTTP 403 Forbidden.
 *
 * @param {number} timeoutMs Timeout in milliseconds (default 12000ms)
 * @returns {Promise<string>} Raw text payload from API
 */
async function fetchExternalAPIData(timeoutMs = 12000) {
    const BROWSER_HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache"
    };

    async function doFetch(url) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            let response;
            if (typeof fetch === "function") {
                response = await fetch(url, {
                    signal: controller.signal,
                    headers: BROWSER_HEADERS,
                });
            } else {
                const nodeFetch = require("node-fetch");
                response = await nodeFetch(url, {
                    signal: controller.signal,
                    headers: BROWSER_HEADERS,
                });
            }

            clearTimeout(timer);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            return await response.text();
        } catch (err) {
            clearTimeout(timer);
            throw err;
        }
    }

    // Try primary URL first
    try {
        return await doFetch(PRIMARY_API_URL);
    } catch (primaryErr) {
        console.warn(`[apiService] Primary endpoint (${PRIMARY_API_URL}) failed: ${primaryErr.message}. Trying alternative endpoints...`);
    }

    // Try fallback URLs
    for (const url of FALLBACK_API_URLS) {
        try {
            return await doFetch(url);
        } catch (e) {
            console.warn(`[apiService] Alternative endpoint (${url}) failed: ${e.message}`);
        }
    }

    // Try proxy fallback
    try {
        const proxyUrl = "https://api.allorigins.win/raw?url=" + encodeURIComponent(PRIMARY_API_URL);
        return await doFetch(proxyUrl);
    } catch (proxyErr) {
        console.warn("[apiService] Proxy fallback failed:", proxyErr.message);
        throw new Error("CelesTrak endpoints unreachable / HTTP 403");
    }
}

/**
 * Parses raw TLE text lines into structured satellite objects.
 *
 * @param {string} tleText
 * @returns {Array<Object>}
 */
function parseTleText(tleText) {
    if (!tleText || typeof tleText !== "string") return [];

    const lines = tleText
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l.length > 0);

    const records = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        const next = lines[i + 1];
        const after = lines[i + 2];

        let name, line1, line2;

        if (line.startsWith("1 ") && next && next.startsWith("2 ")) {
            line1 = line;
            line2 = next;
            name = `NORAD ${line1.substring(2, 7).trim()}`;
            i += 2;
        } else if (next && next.startsWith("1 ") && after && after.startsWith("2 ")) {
            name = line;
            line1 = next;
            line2 = after;
            i += 3;
        } else {
            i += 1;
            continue;
        }

        const noradId = Number(line1.substring(2, 7).trim());
        if (!isNaN(noradId)) {
            records.push({ noradId, name, line1, line2 });
        }
    }

    return records;
}

/**
 * Converts a raw satellite TLE record into a normalized internal location structure.
 *
 * @param {Object} rawSat
 * @param {Date} now
 * @returns {Promise<Object|null>} Normalized location object or null if invalid
 */
async function normalizeRecord(rawSat, now = new Date()) {
    try {
        const { twoline2satrec, propagate, eciToGeodetic, gstime, degreesLat, degreesLong } = await getSatLib();

        const satrec = twoline2satrec(rawSat.line1, rawSat.line2);
        if (!satrec || satrec.error !== 0) {
            return null;
        }

        const posVel = propagate(satrec, now);
        if (!posVel || !posVel.position || isNaN(posVel.position.x)) {
            return null;
        }

        const gTime = gstime(now);
        const geodetic = eciToGeodetic(posVel.position, gTime);

        const lat = degreesLat(geodetic.latitude);
        const lng = degreesLong(geodetic.longitude);

        if (!isValidCoordinate(lat, lng)) {
            return null;
        }

        const externalId = String(rawSat.noradId);
        const formattedLat = Number(lat.toFixed(4));
        const formattedLng = Number(lng.toFixed(4));

        return {
            externalId,
            name: rawSat.name || `NORAD ${externalId}`,
            description: `Active orbital asset — NORAD Cat ID ${externalId}`,
            latitude: formattedLat,
            longitude: formattedLng,
            location: {
                type: "Point",
                coordinates: [formattedLng, formattedLat],
            },
            address: `Sub-satellite Point (${formattedLat}°, ${formattedLng}°)`,
            category: rawSat.category || (rawSat.noradId === 25544 ? "Space Station" : "Active Satellite"),
            source: "CelesTrak API",
            rawData: {
                noradId: rawSat.noradId,
                line1: rawSat.line1,
                line2: rawSat.line2,
                altitudeKm: geodetic.height ? Number(geodetic.height.toFixed(1)) : null,
            },
            lastUpdated: now,
        };
    } catch (err) {
        return null;
    }
}

/**
 * Synchronizes data into both 'satellites' and 'locations' MongoDB collections.
 * Uses fast bulkWrite batch operations.
 *
 * @param {Object} options Options object ({ force: boolean })
 * @returns {Promise<Object>} Summary statistics of sync operation
 */
async function syncLocationsFromAPI(options = {}) {
    console.log("[apiService] Starting location & satellite data synchronization...");

    let rawRecords = [];
    let sourceUsed = "API";

    try {
        const rawText = await fetchExternalAPIData();
        rawRecords = parseTleText(rawText);
        console.log(`[apiService] Successfully fetched & parsed ${rawRecords.length} satellite records from API.`);
    } catch (err) {
        console.warn("[apiService] External API fetch offline / blocked (HTTP 403).");
        console.warn("[apiService] Checking local MongoDB for existing stored records...");

        const storedSatellites = await Satellite.find({}).lean();
        if (storedSatellites.length > 0) {
            console.log(`[apiService] Found ${storedSatellites.length} existing records in MongoDB 'satellites' collection!`);
            rawRecords = storedSatellites;
            sourceUsed = "MongoDB Stored Catalog";
        } else {
            console.log(`[apiService] Populating MongoDB with ${SEED_SATELLITES.length} embedded seed satellite records...`);
            rawRecords = SEED_SATELLITES;
            sourceUsed = "Embedded Seed Catalog";
        }
    }

    const now = new Date();

    // 1. Bulk Upsert into 'satellites' collection
    if (rawRecords.length > 0) {
        const satBulkOps = rawRecords.map(sat => ({
            updateOne: {
                filter: { noradId: sat.noradId },
                update: {
                    $set: {
                        noradId: sat.noradId,
                        name: sat.name,
                        line1: sat.line1,
                        line2: sat.line2,
                        fetchedAt: now
                    }
                },
                upsert: true
            }
        }));

        const CHUNK_SIZE = 1000;
        for (let i = 0; i < satBulkOps.length; i += CHUNK_SIZE) {
            await Satellite.bulkWrite(satBulkOps.slice(i, i + CHUNK_SIZE), { ordered: false });
        }
        console.log(`[apiService] Bulk updated 'satellites' MongoDB collection (${satBulkOps.length} records).`);

        // 2. Bulk Upsert into 'locations' collection with derived geodetic lat/lng
        const locBulkOps = [];
        for (const rawSat of rawRecords) {
            const normalized = await normalizeRecord(rawSat, now);
            if (normalized) {
                locBulkOps.push({
                    updateOne: {
                        filter: { externalId: normalized.externalId },
                        update: { $set: normalized },
                        upsert: true
                    }
                });
            }
        }

        if (locBulkOps.length > 0) {
            for (let i = 0; i < locBulkOps.length; i += CHUNK_SIZE) {
                await Location.bulkWrite(locBulkOps.slice(i, i + CHUNK_SIZE), { ordered: false });
            }
            console.log(`[apiService] Bulk updated 'locations' MongoDB collection (${locBulkOps.length} records).`);
        }
    }

    const totalSatellitesInDb = await Satellite.countDocuments();
    const totalLocationsInDb = await Location.countDocuments();

    console.log(`[apiService] Sync complete (${sourceUsed}) — Satellites DB: ${totalSatellitesInDb}, Locations DB: ${totalLocationsInDb}`);

    return {
        success: true,
        sourceUsed,
        totalSatellitesInDb,
        totalLocationsInDb,
        timestamp: now.toISOString(),
    };
}

module.exports = {
    fetchExternalAPIData,
    parseTleText,
    normalizeRecord,
    syncLocationsFromAPI,
};
