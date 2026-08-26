"use strict";

// ============================================================
// server.js
// Express backend server for BetterEarthSIH / OrbitGuard.
// Handles MongoDB storage, external API sync, Haversine distance
// calculations, and JSON API endpoints.
// ============================================================

const express     = require("express");
const path        = require("path");
const cors        = require("cors");
const dotenv      = require("dotenv");
const cron        = require("node-cron");

const { connectMongo }                   = require("./config/db");
const orbitService                       = require("./services/orbitService");
const apiService                         = require("./services/apiService");
const Location                           = require("./models/Location");
const { isValidCoordinate, sortLocationsByDistance } = require("./utils/distance");

dotenv.config({ path: path.join(__dirname, "config", ".env") });

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve static HTML views
app.use(express.static(path.join(__dirname, "views")));

// ------------------------------------------------------------
// ROUTES
// ------------------------------------------------------------

// GET / -> Dashboard HTML
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "views", "BetterEarthSIH.HTML"));
});

// GET /api/health -> Health Check
app.get("/api/health", async (req, res) => {
    try {
        const count = await Location.countDocuments();
        res.json({
            status: "ok",
            service: "BetterEarthSIH / OrbitGuard API",
            locationsInDb: count,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        res.status(500).json({
            status: "error",
            message: error.message,
        });
    }
});

// GET /api/locations -> Geographical Distance Sorted Locations
app.get("/api/locations", async (req, res) => {
    try {
        const { lat, lng, radius } = req.query;

        if (!isValidCoordinate(lat, lng)) {
            return res.status(400).json({
                success: false,
                error: "Invalid or missing latitude/longitude parameters. Latitude must be between -90 and 90, Longitude between -180 and 180.",
            });
        }

        const userLat = Number(lat);
        const userLng = Number(lng);

        let docs = await Location.find({}).lean();

        if (docs.length === 0) {
            console.log("[API] DB empty on /api/locations request; running sync...");
            await apiService.syncLocationsFromAPI();
            docs = await Location.find({}).lean();
        }

        // Calculate Haversine distance and sort ascending (nearest first)
        let sortedLocations = sortLocationsByDistance(docs, userLat, userLng);

        if (radius !== undefined && radius !== null && !isNaN(Number(radius))) {
            const radKm = Number(radius);
            if (radKm > 0) {
                sortedLocations = sortedLocations.filter(loc => loc.distance <= radKm);
            }
        }

        res.json({
            success: true,
            userLocation: {
                latitude: userLat,
                longitude: userLng,
            },
            count: sortedLocations.length,
            locations: sortedLocations,
        });
    } catch (error) {
        console.error("[API] /api/locations error:", error.message);
        res.status(500).json({
            success: false,
            error: "Unable to calculate nearby locations.",
            details: error.message,
        });
    }
});

// POST /api/sync -> Manual Sync Trigger
app.post("/api/sync", async (req, res) => {
    try {
        const force = req.body && req.body.force === true;
        console.log(`[API] Location sync triggered — force: ${force}`);
        const result = await apiService.syncLocationsFromAPI({ force });
        res.json({
            success: result.success !== false,
            message: "Location sync complete",
            ...result,
        });
    } catch (error) {
        console.error("[API] /api/sync error:", error.message);
        res.status(500).json({
            success: false,
            error: "Location synchronization failed.",
            details: error.message,
        });
    }
});

// GET /api/satellites -> Satellite TLEs from MongoDB
app.get("/api/satellites", async (req, res) => {
    try {
        const records = await orbitService.getStoredSatelliteRecords();
        res.json(records);
    } catch (error) {
        console.error("[API] /api/satellites error:", error.message);
        res.status(500).json({
            error: "Unable to fetch satellite data.",
            details: error.message,
        });
    }
});

// GET /api/conjunctions
app.get("/api/conjunctions", async (req, res) => {
    try {
        const snapshot = await orbitService.getDashboardSnapshot();
        res.json(snapshot.conjunctions);
    } catch (error) {
        console.error("[API] /api/conjunctions error:", error.message);
        res.status(500).json({
            error: "Unable to fetch conjunction events.",
            details: error.message,
        });
    }
});

// GET /api/dashboard -> Full computed snapshot
app.get("/api/dashboard", async (req, res) => {
    try {
        const snapshot = await orbitService.getDashboardSnapshot();
        res.json(snapshot);
    } catch (error) {
        console.error("[API] /api/dashboard error:", error.message);
        res.status(500).json({
            error: "Unable to produce dashboard snapshot.",
            details: error.message,
        });
    }
});

// GET /api/tle/status
app.get("/api/tle/status", async (req, res) => {
    try {
        const newest = await Location.findOne()
            .sort({ lastUpdated: -1 })
            .select("lastUpdated -_id")
            .lean();

        const count = await Location.countDocuments();
        const ageMs = newest ? Date.now() - new Date(newest.lastUpdated).getTime() : null;

        res.json({
            totalLocations: count,
            lastFetchedAt: newest ? newest.lastUpdated : null,
            ageMinutes: ageMs ? Math.round(ageMs / 60_000) : null,
            freshThresholdMinutes: 120,
        });
    } catch (error) {
        res.status(500).json({
            error: "Unable to get TLE status.",
            details: error.message,
        });
    }
});

// POST /api/tle/refresh
app.post("/api/tle/refresh", async (req, res) => {
    try {
        const force = req.body && req.body.force === true;
        const result = await apiService.syncLocationsFromAPI({ force });
        res.json({
            message: "Location/TLE catalog refreshed successfully.",
            ...result,
        });
    } catch (error) {
        console.error("[API] /api/tle/refresh error:", error.message);
        res.status(500).json({
            error: "TLE refresh failed.",
            details: error.message,
        });
    }
});

// 404 Fallback
app.use((req, res) => {
    res.status(404).json({
        error: `Route not found: ${req.method} ${req.path}`,
    });
});

// ------------------------------------------------------------
// STARTUP
// ------------------------------------------------------------

async function startServer() {
    await connectMongo();

    console.log("[Boot] Syncing location data from API / MongoDB...");
    try {
        const result = await apiService.syncLocationsFromAPI();
        console.log(`[Boot] Location sync complete — total records in DB: ${result.totalInDb}`);
    } catch (err) {
        console.error("[Boot] Location sync failed (non-fatal):", err.message);
    }

    cron.schedule("0 */2 * * *", async () => {
        console.log("[Cron] Running scheduled location sync...");
        try {
            const result = await apiService.syncLocationsFromAPI({ force: true });
            console.log(`[Cron] Done — total records in DB: ${result.totalInDb}`);
        } catch (error) {
            console.error("[Cron] Location sync failed:", error.message);
        }
    });

    app.listen(PORT, () => {
        console.log(`\n BetterEarthSIH running → http://localhost:${PORT}`);
        console.log(` Dashboard         → http://localhost:${PORT}/`);
        console.log(` Locations API     → http://localhost:${PORT}/api/locations?lat=20.2961&lng=85.8245`);
        console.log(` Satellites API    → http://localhost:${PORT}/api/satellites`);
        console.log(` Health check      → http://localhost:${PORT}/api/health\n`);
    });
}

startServer().catch(error => {
    console.error("[Startup] Fatal error:", error);
    process.exit(1);
});
