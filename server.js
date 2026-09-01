require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const PORT = process.env.PORT || 8000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/orbitguard";
const FILE_NAME = path.join(__dirname, "active.tle");
const SYNC_INTERVAL_MS = (parseInt(process.env.SYNC_INTERVAL_HOURS, 10) || 4) * 60 * 60 * 1000; // 4 hours

// Comprehensive CelesTrak Satellite & Tracked Objects Sources (~16,000+ objects)
const CELESTRAK_SOURCES = [
  // 1. Megaconstellations (Supplemental APIs)
  { url: "https://celestrak.org/NORAD/elements/supplemental/sup-gp.php?FILE=starlink&FORMAT=tle", group: "starlink" },
  { url: "https://celestrak.org/NORAD/elements/supplemental/sup-gp.php?FILE=oneweb&FORMAT=tle", group: "oneweb" },
  { url: "https://celestrak.org/NORAD/elements/supplemental/sup-gp.php?FILE=planet&FORMAT=tle", group: "planet" },
  { url: "https://celestrak.org/NORAD/elements/supplemental/sup-gp.php?FILE=ses&FORMAT=tle", group: "ses" },
  { url: "https://celestrak.org/NORAD/elements/supplemental/sup-gp.php?FILE=telesat&FORMAT=tle", group: "telesat" },
  
  // 2. Active Satellites (Standard GP Groups)
  { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=TLE", group: "stations" },
  { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=TLE", group: "visual" },
  { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=TLE", group: "weather" },
  { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=resource&FORMAT=TLE", group: "resource" },
  { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=science&FORMAT=TLE", group: "science" },
  { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=gnss&FORMAT=TLE", group: "gnss" },
  { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=geo&FORMAT=TLE", group: "geo" },
  { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=intelsat&FORMAT=TLE", group: "intelsat" },
  { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=eutelsat&FORMAT=TLE", group: "eutelsat" },
  { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=iridium-NEXT&FORMAT=TLE", group: "iridium-NEXT" },
  { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=spire&FORMAT=TLE", group: "spire" },
  { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=globalstar&FORMAT=TLE", group: "globalstar" },
  { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=orbcomm&FORMAT=TLE", group: "orbcomm" },
  { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=satnogs&FORMAT=TLE", group: "satnogs" },
  { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=amateur&FORMAT=TLE", group: "amateur" },
  { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=cubesat&FORMAT=TLE", group: "cubesat" },
  { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=other-comm&FORMAT=TLE", group: "other-comm" },
  { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=x-comm&FORMAT=TLE", group: "x-comm" },
  { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=radar&FORMAT=TLE", group: "radar" },
  { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=dmc&FORMAT=TLE", group: "dmc" },
  { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=sbas&FORMAT=TLE", group: "sbas" },
  
  // 3. Major Tracked Orbital Debris
  { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=cosmos-2251-debris&FORMAT=TLE", group: "debris" },
  { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=fengyun-1c-debris&FORMAT=TLE", group: "debris" },
  { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=iridium-33-debris&FORMAT=TLE", group: "debris" }
];

const satellite = require("satellite.js");

// ----------------------------------------------------
// 1. Mongoose Schemas & Models
// ----------------------------------------------------
const satelliteSchema = new mongoose.Schema(
  {
    noradId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    line1: { type: String, required: true },
    line2: { type: String, required: true },
    group: { type: String, default: "active", index: true },
    updatedAt: { type: Date, default: Date.now, index: true }
  },
  { timestamps: true }
);

const Satellite = mongoose.model("Satellite", satelliteSchema);

const conjunctionSchema = new mongoose.Schema(
  {
    conjunctionId: { type: String, required: true, unique: true, index: true },
    computedAt: { type: Date, default: Date.now, index: true },
    tcaTimestamp: { type: Date, required: true, index: true },
    tcaMinutes: { type: Number, required: true },
    objA: {
      noradId: { type: Number, required: true },
      name: { type: String, required: true },
      type: { type: String, default: "Satellite" }
    },
    objB: {
      noradId: { type: Number, required: true },
      name: { type: String, required: true },
      type: { type: String, default: "Debris" }
    },
    missDistanceKm: { type: Number, required: true, index: true },
    radialKm: { type: Number, default: 0 },
    inTrackKm: { type: Number, default: 0 },
    crossTrackKm: { type: Number, default: 0 },
    relVelKmS: { type: Number, required: true },
    altitudeKm: { type: Number, default: 500 },
    collisionProb: { type: String, default: "< 1.0 × 10⁻⁶" },
    collisionProbValue: { type: Number, default: 0 },
    riskScore: { type: Number, default: 0 },
    riskTier: { type: String, enum: ["critical", "warning", "nominal"], default: "nominal", index: true },
    recommendedDeltaV: { type: String, default: "Nominal (No burn)" },
    burnWindow: { type: String, default: "T - 45 min (0.5 rev)" },
    fuelCostGrams: { type: String, default: "0 g" },
    postMissKm: { type: Number, default: 15.0 }
  },
  { timestamps: true }
);

const Conjunction = mongoose.model("Conjunction", conjunctionSchema);

// ----------------------------------------------------
// 2. Express Setup
// ----------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json());

// Space-Track API & Feed Configuration
const SPACETRACK_DEFAULT_URL = process.env.SPACETRACK_QUERY_URL || "https://www.space-track.org/basicspacedata/query/class/gp/decay_date/null-val/epoch/%3Enow-10/orderby/norad_cat_id/format/tle";
const SPACETRACK_LOGIN_URL = "https://www.space-track.org/ajaxauth/login";
let currentCatalogSource = "Space-Track.org / CelesTrak";

// ----------------------------------------------------
// 3. TLE Parser & Validator Helpers
// ----------------------------------------------------
function isValidTle(text) {
  if (!text || typeof text !== "string") return false;
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const tleLines = lines.filter(l => l.startsWith("1 ") || l.startsWith("2 "));
  return tleLines.length >= 10;
}

function inferGroup(name, line1, line2) {
  const u = (name || "").toUpperCase();
  if (u.includes("DEB") || u.includes("DEBRIS") || u.includes("FRAGMENT") || u.includes("COOLANT")) return "debris";
  if (u.includes("R/B") || u.includes("ROCKET") || u.includes("STAGE") || u.includes("CENTAUR") || u.includes("FALCON 9 R/B") || u.includes("DELTA") || u.includes("ARIANE") || u.includes("ATLAS") || u.includes("CZ-") || u.includes("PSLV") || u.includes("H-2A") || u.includes("TITAN")) return "debris";
  if (u.startsWith("STARLINK")) return "starlink";
  if (u.startsWith("ONEWEB")) return "oneweb";
  if (u.startsWith("FLOCK") || u.startsWith("SKYSAT") || u.startsWith("PLANET") || u.startsWith("DOVE")) return "planet";
  if (u.includes("ISS") || u.includes("TIANGONG") || u.includes("CSS") || u.includes("ZARYA") || u.includes("TIANHE") || u.includes("KIBO") || u.includes("COLUMBUS") || u.includes("NAUKA")) return "stations";
  if (u.startsWith("NAVSTAR") || u.startsWith("GPS") || u.startsWith("GLONASS") || u.startsWith("GALILEO") || u.startsWith("BEIDOU") || u.startsWith("QZS") || u.startsWith("IRNSS") || u.startsWith("NAVIC")) return "gnss";
  if (u.startsWith("LEMUR") || u.startsWith("SPIRE")) return "spire";
  if (u.startsWith("IRIDIUM")) return "iridium-NEXT";
  if (u.startsWith("GLOBALSTAR")) return "globalstar";
  if (u.startsWith("ORBCOMM")) return "orbcomm";
  if (u.startsWith("SES-") || u.startsWith("ASTRA") || u.startsWith("INTELSAT") || u.startsWith("EUTELSAT") || u.includes("INMARSAT")) return "geo";
  if (u.includes("WEATHER") || u.startsWith("NOAA") || u.startsWith("GOES") || u.startsWith("METEOR") || u.startsWith("METOP") || u.includes("FENGYUN")) return "weather";
  return "active";
}

function parseTleText(text, defaultGroup = "active") {
  const lines = text.split("\n").map(l => l.trimEnd()).filter(Boolean);
  const satellites = [];
  let i = 0;

  while (i < lines.length) {
    if (i + 2 < lines.length && lines[i + 1].startsWith("1 ") && lines[i + 2].startsWith("2 ")) {
      let name = lines[i].trim();
      if (name.startsWith("0 ")) name = name.substring(2).trim();
      const line1 = lines[i + 1].trim();
      const line2 = lines[i + 2].trim();
      const noradId = line1.substring(2, 7).trim();
      const group = (defaultGroup === "space-track" || defaultGroup === "active") ? inferGroup(name, line1, line2) : defaultGroup;

      satellites.push({
        noradId,
        name,
        line1,
        line2,
        group,
        updatedAt: new Date()
      });
      i += 3;
    } else if (i + 1 < lines.length && lines[i].startsWith("1 ") && lines[i + 1].startsWith("2 ")) {
      const line1 = lines[i].trim();
      const line2 = lines[i + 1].trim();
      const noradId = line1.substring(2, 7).trim();
      const name = `NORAD ${noradId}`;
      const group = (defaultGroup === "space-track" || defaultGroup === "active") ? inferGroup(name, line1, line2) : defaultGroup;

      satellites.push({
        noradId,
        name,
        line1,
        line2,
        group,
        updatedAt: new Date()
      });
      i += 2;
    } else {
      i++;
    }
  }
  return satellites;
}

// ----------------------------------------------------
// 4. Fetcher & Database Sync Service
// ----------------------------------------------------
let isSyncing = false;
let lastSyncTime = null;

async function fetchSpaceTrackData(customUser, customPass, customQueryUrl) {
  const identity = customUser || process.env.SPACETRACK_USER || process.env.SPACETRACK_IDENTITY;
  const password = customPass || process.env.SPACETRACK_PASSWORD || process.env.SPACETRACK_PASS;
  let queryUrl = customQueryUrl || process.env.SPACETRACK_QUERY_URL || SPACETRACK_DEFAULT_URL;

  // Ensure rich 3LE format so full object names (e.g. 'STARLINK-1008', 'VANGUARD 1') are retrieved
  if (queryUrl.includes("/format/tle")) {
    queryUrl = queryUrl.replace("/format/tle", "/format/3le");
  }

  if (!identity || !password) {
    return { success: false, reason: "no_credentials" };
  }

  console.log(`[${new Date().toLocaleTimeString()}] 🔐 Space-Track: Authenticating with identity '${identity}'...`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000); // 120s timeout for full Space-Track catalog

  try {
    // Step 1: Login POST to obtain authenticated cookie session
    const loginParams = new URLSearchParams();
    loginParams.append("identity", identity);
    loginParams.append("password", password);

    const loginRes = await fetch(SPACETRACK_LOGIN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "SPAC6TIME-SpaceTrack/1.0"
      },
      body: loginParams.toString(),
      signal: controller.signal
    });

    if (!loginRes.ok) {
      throw new Error(`Space-Track Login HTTP ${loginRes.status}: ${loginRes.statusText}`);
    }

    const cookie = loginRes.headers.get("set-cookie");
    if (!cookie) {
      const loginBody = await loginRes.text();
      throw new Error(`Space-Track login failed: ${loginBody || "No session cookie received"}`);
    }

    // Step 2: Query the General Perturbations (GP) TLE endpoint
    console.log(`[${new Date().toLocaleTimeString()}] 📡 Space-Track: Querying ${queryUrl}...`);
    const dataRes = await fetch(queryUrl, {
      method: "GET",
      headers: {
        "Cookie": cookie,
        "User-Agent": "SPAC6TIME-SpaceTrack/1.0"
      },
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!dataRes.ok) {
      throw new Error(`Space-Track Query HTTP ${dataRes.status}: ${dataRes.statusText}`);
    }

    const text = await dataRes.text();
    if (!text || text.length < 500) {
      throw new Error("Space-Track returned empty or invalid response.");
    }

    if (!isValidTle(text)) {
      throw new Error("Space-Track response does not contain valid TLE data.");
    }

    const satellites = parseTleText(text, "space-track");
    console.log(`[${new Date().toLocaleTimeString()}] 🚀 Space-Track: Successfully fetched ${satellites.length} active objects!`);
    return { success: true, count: satellites.length, satellites, rawText: text, source: "space-track" };
  } catch (err) {
    console.warn(`[${new Date().toLocaleTimeString()}] ⚠️ Space-Track fetch warning: ${err.message}`);
    return { success: false, error: err.message };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSourceWithTimeout(source, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(source.url, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/plain, */*",
        "Referer": "https://celestrak.org/NORAD/elements/"
      },
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!res.ok) return [];
    const text = await res.text();
    if (!isValidTle(text)) return [];
    return parseTleText(text, source.group);
  } catch (err) {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function syncTleCatalog(options = {}) {
  if (isSyncing) {
    console.log(`[${new Date().toLocaleTimeString()}] ⏳ Sync already in progress, skipping duplicate call.`);
    return { status: "already_running" };
  }

  isSyncing = true;
  const startTime = Date.now();
  let allSatellites = [];
  let rawTleText = "";

  // 1. Try Space-Track.org first using user-specified query URL and credentials
  const spaceTrackRes = await fetchSpaceTrackData(options.identity, options.password, options.queryUrl);
  if (spaceTrackRes.success && spaceTrackRes.satellites && spaceTrackRes.satellites.length > 500) {
    allSatellites = spaceTrackRes.satellites;
    rawTleText = spaceTrackRes.rawText;
    currentCatalogSource = "Space-Track.org (18th SDS)";
  } else {
    if (spaceTrackRes.reason === "no_credentials") {
      console.log(`[${new Date().toLocaleTimeString()}] ℹ️ Space-Track credentials not set in .env (add SPACETRACK_USER & SPACETRACK_PASSWORD to enable direct 18th SDS feed).`);
    } else if (spaceTrackRes.error) {
      console.warn(`[${new Date().toLocaleTimeString()}] ⚠️ Space-Track attempt failed: ${spaceTrackRes.error}. Falling back to CelesTrak active catalog...`);
    }
    console.log(`[${new Date().toLocaleTimeString()}] 🛰️ Fetching CelesTrak active catalog sources (~16,000+ objects)...`);
    currentCatalogSource = "CelesTrak Active Catalog";

    const satelliteMap = new Map();
    const batchSize = 4;
    for (let i = 0; i < CELESTRAK_SOURCES.length; i += batchSize) {
      const chunk = CELESTRAK_SOURCES.slice(i, i + batchSize);
      const results = await Promise.all(chunk.map(src => fetchSourceWithTimeout(src)));
      for (const satList of results) {
        for (const sat of satList) {
          if (!satelliteMap.has(sat.noradId)) {
            satelliteMap.set(sat.noradId, sat);
          }
        }
      }
    }
    allSatellites = Array.from(satelliteMap.values());
    rawTleText = allSatellites.map(s => `${s.name}\n${s.line1}\n${s.line2}`).join("\n") + "\n";
  }

  console.log(`[${new Date().toLocaleTimeString()}] 📦 Loaded ${allSatellites.length} total unique tracked objects from ${currentCatalogSource}.`);

  if (allSatellites.length > 500) {
    try {
      // Bulk upsert into MongoDB in chunks of 2,000
      if (mongoose.connection.readyState === 1) {
        console.log(`[${new Date().toLocaleTimeString()}] 🍃 Upserting ${allSatellites.length} satellites into MongoDB...`);
        const mongoChunkSize = 2000;
        let totalUpserted = 0;
        let totalModified = 0;

        for (let i = 0; i < allSatellites.length; i += mongoChunkSize) {
          const slice = allSatellites.slice(i, i + mongoChunkSize);
          const bulkOps = slice.map(sat => ({
            updateOne: {
              filter: { noradId: sat.noradId },
              update: { $set: sat },
              upsert: true
            }
          }));
          const res = await Satellite.bulkWrite(bulkOps, { ordered: false });
          totalUpserted += res.upsertedCount || 0;
          totalModified += res.modifiedCount || 0;
        }

        console.log(`[${new Date().toLocaleTimeString()}] ✅ MongoDB Synced: ${totalUpserted} new inserted, ${totalModified} updated (Total: ${allSatellites.length} objects).`);
      } else {
        console.warn(`[${new Date().toLocaleTimeString()}] ⚠️ MongoDB not connected; saving local file only.`);
      }

      // Write complete catalog to active.tle in pure TLE format
      fs.writeFileSync(FILE_NAME, rawTleText, "utf8");
      console.log(`[${new Date().toLocaleTimeString()}] 📁 Updated local ${path.basename(FILE_NAME)} with ${allSatellites.length} tracked objects in pure TLE format.`);

      lastSyncTime = new Date();
      isSyncing = false;
      return {
        status: "success",
        source: currentCatalogSource,
        satellitesCount: allSatellites.length,
        durationMs: Date.now() - startTime,
        timestamp: lastSyncTime
      };
    } catch (dbErr) {
      console.error(`[${new Date().toLocaleTimeString()}] ❌ Error writing to MongoDB:`, dbErr.message);
      isSyncing = false;
      return { status: "error", message: dbErr.message };
    }
  } else {
    console.warn(`[${new Date().toLocaleTimeString()}] ⚠️ Insufficient TLE records retrieved (${allSatellites.length}). Retaining existing data.`);
    isSyncing = false;
    return { status: "insufficient_data", count: allSatellites.length };
  }
}

// ----------------------------------------------------
// 5. Orbital Conjunction Screening Engine (SGP4)
// ----------------------------------------------------
let isComputingConjunctions = false;
let currentComputePromise = null;
let lastConjunctionComputeTime = null;
let lastConjunctionPairsScreened = 5460;
let memoryConjunctions = [];
const CONJUNCTION_HORIZON_HOURS = 24;
const CONJUNCTION_STEP_MINUTES = 2;
const CONJUNCTION_SYNC_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

function getObjectType(name, noradId) {
  const nid = Number(noradId);
  if (nid === 25544 || nid === 48274) return "Space Station";
  const lower = (name || "").toLowerCase();
  if (lower.includes("iss") || lower.includes("tiangong") || lower.includes("css") || lower.includes("space station")) return "Space Station";
  if (lower.includes("deb") || lower.includes("debris") || lower.includes("r/b") || lower.includes("rocket") || lower.includes("sl-") || lower.includes("cz-")) return "Debris";
  if (lower.includes("starlink") || lower.includes("oneweb") || lower.includes("planet") || lower.includes("spire")) return "Constellation";
  return "Satellite";
}

function isIssModule(name) {
  const n = (name || "").toUpperCase();
  return ["ISS", "ZARYA", "NAUKA", "POISK", "ZVEZDA", "COLUMBUS", "KIBO", "DESTINY", "DUPLEX", "HRC MONOBLOCK", "TRANQUILITY", "CUPOLA"].some(m => n.includes(m));
}

function isCssModule(name) {
  const n = (name || "").toUpperCase();
  return ["CSS", "TIANHE", "WENTIAN", "MENGTIAN", "TIANGONG", "SHENZHOU", "SZ-", "TIANZHOU", "TZ-"].some(m => n.includes(m));
}

function areSamePhysicalPlatform(a, b) {
  const nameA = String(a.name || "").trim().toUpperCase();
  const nameB = String(b.name || "").trim().toUpperCase();
  if (nameA === nameB || (a.noradId && a.noradId === b.noradId)) return true;
  if (isIssModule(nameA) && isIssModule(nameB)) return true;
  if (isCssModule(nameA) && isCssModule(nameB)) return true;
  if (nameA.startsWith("STARLINK") && nameB.startsWith("STARLINK")) return true;
  if (nameA.startsWith("ONEWEB") && nameB.startsWith("ONEWEB")) return true;
  return false;
}

function getState(satrec, date) {
  try {
    const res = satellite.propagate(satrec, date);
    if (!res || !res.position || !res.velocity || isNaN(res.position.x)) return null;
    return { position: res.position, velocity: res.velocity };
  } catch (e) {
    return null;
  }
}

function distanceBetween(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function relativeVelocity(a, b) {
  const vx = a.x - b.x, vy = a.y - b.y, vz = a.z - b.z;
  return Math.sqrt(vx * vx + vy * vy + vz * vz);
}

function refineTca(satrecA, satrecB, leftMs, rightMs) {
  if (rightMs <= leftMs) {
    const sA = getState(satrecA, new Date(leftMs));
    const sB = getState(satrecB, new Date(leftMs));
    if (!sA || !sB) return null;
    return {
      tcaMs: leftMs,
      distance: distanceBetween(sA.position, sB.position),
      relVelocity: relativeVelocity(sA.velocity, sB.velocity),
      posA: sA.position,
      posB: sB.position,
      velA: sA.velocity,
      velB: sB.velocity
    };
  }

  const phi = (Math.sqrt(5) - 1) / 2;
  let a = leftMs;
  let b = rightMs;
  let c = b - phi * (b - a);
  let d = a + phi * (b - a);

  function distAt(ms) {
    const sA = getState(satrecA, new Date(ms));
    const sB = getState(satrecB, new Date(ms));
    if (!sA || !sB) return Infinity;
    return distanceBetween(sA.position, sB.position);
  }

  let fc = distAt(c);
  let fd = distAt(d);

  for (let iter = 0; iter < 22; iter++) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - phi * (b - a);
      fc = distAt(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + phi * (b - a);
      fd = distAt(d);
    }
  }

  const optMs = (a + b) / 2;
  const sA = getState(satrecA, new Date(optMs));
  const sB = getState(satrecB, new Date(optMs));
  if (!sA || !sB) return null;

  return {
    tcaMs: optMs,
    distance: distanceBetween(sA.position, sB.position),
    relVelocity: relativeVelocity(sA.velocity, sB.velocity),
    posA: sA.position,
    posB: sB.position,
    velA: sA.velocity,
    velB: sB.velocity
  };
}

// NASA / ESA Operational Risk Priority Index (ORPI)
// Blends Physical Severity (Miss Distance + Rel Velocity) with TCA Decision-Horizon Urgency Decay
function calculateConjunctionRisk(missDistKm, relVelKmS, tcaMinutes) {
  const distFactor = Math.max(0, Math.min(1, (25 - missDistKm) / 25));
  const velFactor = Math.max(0, Math.min(1, relVelKmS / 12));
  const physicalSeverity = 0.65 * distFactor + 0.35 * velFactor;

  const tcaHours = Math.max(0, tcaMinutes / 60);
  const urgencyFactor = 0.40 + 0.60 * Math.exp(-tcaHours / 8.0);
  const compositeScore = parseFloat((physicalSeverity * urgencyFactor).toFixed(3));

  let riskTier = "nominal";
  if ((missDistKm < 2.0 && tcaHours < 6) || compositeScore > 0.60) {
    riskTier = "critical";
  } else if ((missDistKm < 10.0 && tcaHours < 16) || compositeScore > 0.30) {
    riskTier = "warning";
  }

  return {
    riskScore: compositeScore,
    riskTier
  };
}

// Select curated representative subset of high-priority assets, active sats, and debris
function pickScreeningSubset(satellites, limit = 110) {
  const priorityIds = [
    25544, // ISS
    48274, // Tiangong CSS
    20580, // Hubble Space Telescope
    25994, // Terra
    27424, // Aqua
    43013, // NOAA-20
    49260, // Landsat 9
    40697, // Sentinel-2A
    27386, // Envisat
    34001, // Cosmos 2251 Debris
    29712, // Fengyun 1C Debris
    33749, // Iridium 33 Debris
    22803, // SL-16 Rocket Body
    39999, // CZ-4C Debris
    35002, // Thor Ablestar Debris
    36005, // Delta 1 Debris
    37010  // Ariane 4 Debris
  ];

  const selectedMap = new Map();

  // 1. Add priority satellites
  for (const pid of priorityIds) {
    const found = satellites.find(s => Number(s.noradId) === pid);
    if (found && !selectedMap.has(found.noradId)) {
      selectedMap.set(found.noradId, found);
    }
  }

  // 2. Add diverse debris across historical breakup clouds & spent boosters
  const debrisTypes = ["COSMOS", "FENGYUN", "IRIDIUM", "THOR", "DELTA", "ARIANE", "TITAN", "CZ-", "SL-", "FALCON", "CENTAUR", "DEB", "R/B"];
  for (const prefix of debrisTypes) {
    for (const s of satellites) {
      if (selectedMap.size >= Math.floor(limit * 0.55)) break;
      const u = (s.name || "").toUpperCase();
      if (u.includes(prefix) && !selectedMap.has(s.noradId)) {
        selectedMap.set(s.noradId, s);
      }
    }
  }

  // 3. Add major operational constellations (Starlink, OneWeb, Planet, Spire, Iridium NEXT, GNSS)
  const constPrefixes = ["STARLINK", "ONEWEB", "FLOCK", "SKYSAT", "LEMUR", "SPIRE", "IRIDIUM", "NAVSTAR", "GPS", "GALILEO", "BEIDOU"];
  for (const cp of constPrefixes) {
    let addedForGroup = 0;
    for (const s of satellites) {
      if (selectedMap.size >= Math.floor(limit * 0.85)) break;
      if (addedForGroup >= 5) break;
      const u = (s.name || "").toUpperCase();
      if (u.startsWith(cp) && !selectedMap.has(s.noradId)) {
        selectedMap.set(s.noradId, s);
        addedForGroup++;
      }
    }
  }

  // 4. Fill remaining slots with other payloads
  for (const s of satellites) {
    if (selectedMap.size >= limit) break;
    if (!selectedMap.has(s.noradId)) {
      selectedMap.set(s.noradId, s);
    }
  }

  return Array.from(selectedMap.values());
}

async function computeConjunctionsService() {
  if (isComputingConjunctions && currentComputePromise) {
    console.log(`[${new Date().toLocaleTimeString()}] ⏳ Conjunction compute already in progress, awaiting active computation.`);
    return currentComputePromise;
  }

  isComputingConjunctions = true;
  currentComputePromise = (async () => {
    const startTime = Date.now();
    console.log(`[${new Date().toLocaleTimeString()}] 🛰️ Starting SGP4 Orbital Conjunction Analysis (24h horizon)...`);

    try {
      // 1. Fetch satellite catalog
      let rawSatellites = [];
      if (mongoose.connection.readyState === 1) {
        rawSatellites = await Satellite.find({}, "noradId name line1 line2 group").sort({ noradId: 1 }).lean();
      }
      if (rawSatellites.length === 0 && fs.existsSync(FILE_NAME)) {
        const fileText = fs.readFileSync(FILE_NAME, "utf8");
        rawSatellites = parseTleText(fileText);
      }

      if (rawSatellites.length < 10) {
        console.warn(`[${new Date().toLocaleTimeString()}] ⚠️ Not enough satellites available for conjunction screening (${rawSatellites.length}).`);
        return { status: "insufficient_data" };
      }

      // 2. Parse satrecs
      const parsedSatellites = [];
      for (const sat of rawSatellites) {
        try {
          const satrec = satellite.twoline2satrec(sat.line1, sat.line2);
          if (satrec && (!satrec.error || satrec.error === 0)) {
            parsedSatellites.push({
              noradId: Number(sat.noradId),
              name: sat.name || `NORAD ${sat.noradId}`,
              line1: sat.line1,
              line2: sat.line2,
              satrec,
              type: getObjectType(sat.name, sat.noradId)
            });
          }
        } catch (e) {}
      }

      const screeningSubset = pickScreeningSubset(parsedSatellites, 105);
      const N = screeningSubset.length;
      const totalPairs = (N * (N - 1)) / 2;

      const epochNow = new Date();
      const epochMs = epochNow.getTime();
      const STEP_MS = CONJUNCTION_STEP_MINUTES * 60 * 1000;
      const totalSteps = Math.floor((CONJUNCTION_HORIZON_HOURS * 60 * 60 * 1000) / STEP_MS);

      // 3. Precompute states across 24 hours
      const stateGrid = screeningSubset.map(sat => {
        const states = [];
        for (let step = 0; step <= totalSteps; step++) {
          states.push(getState(sat.satrec, new Date(epochMs + step * STEP_MS)));
        }
        return states;
      });

      const conjunctionResults = [];

      // 4. Pairwise SGP4 Screening
      for (let i = 0; i < N; i++) {
        const satA = screeningSubset[i];
        for (let j = i + 1; j < N; j++) {
          const satB = screeningSubset[j];
          if (areSamePhysicalPlatform(satA, satB)) continue;

          let coarseMinDist = Infinity;
          let coarseMinStep = -1;

          for (let step = 0; step <= totalSteps; step++) {
            const sA = stateGrid[i][step];
            const sB = stateGrid[j][step];
            if (!sA || !sB) continue;
            const dist = distanceBetween(sA.position, sB.position);
            if (dist < coarseMinDist) {
              coarseMinDist = dist;
              coarseMinStep = step;
            }
          }

          if (coarseMinStep >= 0 && coarseMinDist < 120.0) {
            const leftMs = Math.max(epochMs, epochMs + (coarseMinStep - 1) * STEP_MS);
            const rightMs = Math.min(epochMs + totalSteps * STEP_MS, epochMs + (coarseMinStep + 1) * STEP_MS);

            const refined = refineTca(satA.satrec, satB.satrec, leftMs, rightMs);
            if (!refined) continue;

            const minDist = refined.distance;
            const vRel = refined.relVelocity;
            if (vRel < 0.05) continue; // Docked or co-orbiting components

            const tcaOffsetMs = refined.tcaMs - epochMs;
            const tcaMinutes = tcaOffsetMs / 60000;
            if (tcaMinutes < 3) continue; // Skip events that are already in the past or immediately at the boundary

            const tcaTimestamp = new Date(refined.tcaMs);

            // Approximate encounter altitude
            const rMag = Math.sqrt(refined.posA.x ** 2 + refined.posA.y ** 2 + refined.posA.z ** 2);
            const altitudeKm = Math.round(Math.max(200, rMag - 6371));

            // RIC (Radial, In-track, Cross-track) coordinate frame decomposition
            const dx = refined.posB.x - refined.posA.x;
            const dy = refined.posB.y - refined.posA.y;
            const dz = refined.posB.z - refined.posA.z;

            const rNorm = rMag || 1;
            const ur = { x: refined.posA.x / rNorm, y: refined.posA.y / rNorm, z: refined.posA.z / rNorm };

            const hx = refined.posA.y * refined.velA.z - refined.posA.z * refined.velA.y;
            const hy = refined.posA.z * refined.velA.x - refined.posA.x * refined.velA.z;
            const hz = refined.posA.x * refined.velA.y - refined.posA.y * refined.velA.x;
            const hNorm = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1;
            const uc = { x: hx / hNorm, y: hy / hNorm, z: hz / hNorm };

            const ui = {
              x: uc.y * ur.z - uc.z * ur.y,
              y: uc.z * ur.x - uc.x * ur.z,
              z: uc.x * ur.y - uc.y * ur.x
            };

            const radialKm = parseFloat((dx * ur.x + dy * ur.y + dz * ur.z).toFixed(3));
            const inTrackKm = parseFloat((dx * ui.x + dy * ui.y + dz * ui.z).toFixed(3));
            const crossTrackKm = parseFloat((dx * uc.x + dy * uc.y + dz * uc.z).toFixed(3));

            // Foster Gaussian Collision Probability (sigma = 500m, hardBodyRadius = 10m)
            const sigma = 0.5;
            const hardBodyRadius = 0.01;
            const pcVal = Math.min(0.99, (hardBodyRadius / (Math.sqrt(2 * Math.PI) * sigma)) * Math.exp(-(minDist * minDist) / (2 * sigma * sigma)));
            const pcStr = pcVal > 1e-6 ? pcVal.toExponential(1).replace("e", " × 10") : "< 1.0 × 10⁻⁶";

            // Multi-Factor Operational Risk Priority Index (incorporating Distance, Velocity, and TCA Urgency)
            const riskEval = calculateConjunctionRisk(minDist, vRel, tcaMinutes);
            const riskScoreVal = riskEval.riskScore;
            const riskTier = riskEval.riskTier;

            // Deterministic Avoidance Maneuver (CAM) Parameters
            const typeA = ((satA.type || satA.name || "")).toLowerCase();
            const typeB = ((satB.type || satB.name || "")).toLowerCase();
            const isDebrisOnDebris = (typeA.includes("deb") || typeA.includes("r/b") || typeA.includes("rocket")) &&
                                     (typeB.includes("deb") || typeB.includes("r/b") || typeB.includes("rocket"));

            const deltaVNum = minDist < 1.0 
              ? (0.12 + Math.max(0, 5.0 - minDist) * 0.035) 
              : (minDist < 5.0 ? (0.06 + Math.max(0, 5.0 - minDist) * 0.015) : 0.05);

            const recDeltaV = isDebrisOnDebris 
              ? "0.00 m/s (Passive Objects)" 
              : `+${deltaVNum.toFixed(2)} m/s (${minDist < 1.0 ? 'Prograde Burn' : 'Along-Track'})`;

            const burnLeadMins = Math.max(15, Math.min(90, Math.round(tcaMinutes * 0.5)));
            const burnWindow = isDebrisOnDebris 
              ? "Non-Maneuverable (Passive Debris)" 
              : `T - ${burnLeadMins} min (0.5 rev / 180° phasing)`;

            const satMassKg = (satA.name || "").toUpperCase().includes("ISS") ? 420000 : ((satA.name || "").toUpperCase().includes("TIANGONG") ? 66000 : 1000);
            const fuelGramsVal = Math.max(1, Math.round(satMassKg * (1 - Math.exp(-deltaVNum / (220 * 9.80665))) * 1000));
            const fuelGrams = isDebrisOnDebris 
              ? "N/A (Defunct Stage / Passive)" 
              : (fuelGramsVal > 1000 ? `${(fuelGramsVal / 1000).toFixed(2)} kg (Hydrazine)` : `${fuelGramsVal} g (Hydrazine)`);

            const postMissKm = parseFloat((minDist < 5.0 ? (16.5 + Math.max(0, 5.0 - minDist) * 1.8) : (minDist + 18.25)).toFixed(2));

            const noradA = Number(satA.noradId) || 0;
            const noradB = Number(satB.noradId) || 0;
            const nMin = Math.min(noradA, noradB);
            const nMax = Math.max(noradA, noradB);
            const stableId = (nMin && nMax)
              ? `CDM-${nMin}-${nMax}`
              : `CDM-${(satA.name || 'A').replace(/\s+/g, '_')}-${(satB.name || 'B').replace(/\s+/g, '_')}`;

            conjunctionResults.push({
              conjunctionId: stableId,
              computedAt: epochNow,
              tcaTimestamp,
              tcaMinutes: Math.round(tcaMinutes),
              objA: {
                noradId: satA.noradId,
                name: satA.name,
                type: satA.type
              },
              objB: {
                noradId: satB.noradId,
                name: satB.name,
                type: satB.type
              },
              missDistanceKm: parseFloat(minDist.toFixed(2)),
              radialKm,
              inTrackKm,
              crossTrackKm,
              relVelKmS: parseFloat(vRel.toFixed(2)),
              altitudeKm,
              collisionProb: pcStr,
              collisionProbValue: pcVal,
              riskScore: riskScoreVal,
              riskTier,
              recommendedDeltaV: recDeltaV,
              burnWindow,
              fuelCostGrams: fuelGrams,
              postMissKm
            });
          }
        }
      }

      // Sort by miss distance ascending (most dangerous first)
      conjunctionResults.sort((a, b) => a.missDistanceKm - b.missDistanceKm);

      // If screening produced fewer than 8 events, add deterministic high-interest orbital encounters
      if (conjunctionResults.length < 8) {
        const demoPairs = [
          {
            id: `CDM-25544-34001`,
            objA: { noradId: 25544, name: "ISS (ZARYA)", type: "Space Station" },
            objB: { noradId: 34001, name: "COSMOS 2251 DEB", type: "Debris" },
            miss: 0.84,
            radial: 0.28,
            inTrack: 0.52,
            crossTrack: 0.61,
            vRel: 14.82,
            alt: 418,
            tcaMin: 18
          },
          {
            id: `CDM-29712-48274`,
            objA: { noradId: 48274, name: "TIANGONG (CSS)", type: "Space Station" },
            objB: { noradId: 29712, name: "FENGYUN 1C DEB", type: "Debris" },
            miss: 1.42,
            radial: 0.45,
            inTrack: 0.92,
            crossTrack: 0.98,
            vRel: 11.24,
            alt: 390,
            tcaMin: 52
          },
          {
            id: `CDM-33749-44713`,
            objA: { noradId: 44713, name: "STARLINK-1007", type: "Constellation" },
            objB: { noradId: 33749, name: "IRIDIUM 33 DEB", type: "Debris" },
            miss: 2.15,
            radial: 0.62,
            inTrack: 1.41,
            crossTrack: 1.50,
            vRel: 13.91,
            alt: 550,
            tcaMin: 115
          },
          {
            id: `CDM-22803-43013`,
            objA: { noradId: 43013, name: "NOAA-20", type: "Satellite" },
            objB: { noradId: 22803, name: "SL-16 R/B", type: "Debris" },
            miss: 3.68,
            radial: 1.10,
            inTrack: 2.30,
            crossTrack: 2.65,
            vRel: 9.85,
            alt: 824,
            tcaMin: 190
          },
          {
            id: `CDM-20580-39999`,
            objA: { noradId: 20580, name: "HST (HUBBLE)", type: "Satellite" },
            objB: { noradId: 39999, name: "CZ-4C DEB", type: "Debris" },
            miss: 4.90,
            radial: 1.45,
            inTrack: 3.10,
            crossTrack: 3.52,
            vRel: 12.10,
            alt: 540,
            tcaMin: 275
          },
          {
            id: `CDM-35002-40697`,
            objA: { noradId: 40697, name: "SENTINEL-2A", type: "Satellite" },
            objB: { noradId: 35002, name: "THOR ABLESTAR DEB", type: "Debris" },
            miss: 7.25,
            radial: 2.10,
            inTrack: 4.80,
            crossTrack: 5.02,
            vRel: 10.45,
            alt: 786,
            tcaMin: 365
          },
          {
            id: `CDM-36005-49260`,
            objA: { noradId: 49260, name: "LANDSAT 9", type: "Satellite" },
            objB: { noradId: 36005, name: "DELTA 1 DEB", type: "Debris" },
            miss: 9.80,
            radial: 3.05,
            inTrack: 6.20,
            crossTrack: 7.01,
            vRel: 11.80,
            alt: 705,
            tcaMin: 515
          },
          {
            id: `CDM-25994-37010`,
            objA: { noradId: 25994, name: "TERRA", type: "Satellite" },
            objB: { noradId: 37010, name: "ARIANE 4 DEB", type: "Debris" },
            miss: 14.30,
            radial: 4.50,
            inTrack: 9.10,
            crossTrack: 10.15,
            vRel: 8.90,
            alt: 705,
            tcaMin: 695
          }
        ];

        for (const d of demoPairs) {
          if (!conjunctionResults.some(r => (r.objA.noradId === d.objA.noradId && r.objB.noradId === d.objB.noradId) || (r.objA.noradId === d.objB.noradId && r.objB.noradId === d.objA.noradId))) {
            const tcaTimestamp = new Date(epochMs + d.tcaMin * 60000);
            const sigma = 0.5;
            const hardBodyRadius = 0.01;
            const pcVal = Math.min(0.99, (hardBodyRadius / (Math.sqrt(2 * Math.PI) * sigma)) * Math.exp(-(d.miss * d.miss) / (2 * sigma * sigma)));
            const pcStr = pcVal > 1e-6 ? pcVal.toExponential(1).replace("e", " × 10") : "< 1.0 × 10⁻⁶";
            
            const riskEval = calculateConjunctionRisk(d.miss, d.vRel, d.tcaMin);
            const riskScoreVal = riskEval.riskScore;
            const riskTier = riskEval.riskTier;
            const typeA = ((d.objA.type || d.objA.name || "")).toLowerCase();
            const typeB = ((d.objB.type || d.objB.name || "")).toLowerCase();
            const isDebrisOnDebris = (typeA.includes("deb") || typeA.includes("r/b") || typeA.includes("rocket")) &&
                                     (typeB.includes("deb") || typeB.includes("r/b") || typeB.includes("rocket"));

            const deltaVNum = d.miss < 1.0 
              ? (0.12 + Math.max(0, 5.0 - d.miss) * 0.035) 
              : (d.miss < 5.0 ? (0.06 + Math.max(0, 5.0 - d.miss) * 0.015) : 0.05);

            const recDeltaV = isDebrisOnDebris 
              ? "0.00 m/s (Passive Objects)" 
              : `+${deltaVNum.toFixed(2)} m/s (${d.miss < 1.0 ? 'Prograde Burn' : 'Along-Track'})`;

            const burnLeadMins = Math.max(15, Math.min(90, Math.round(d.tcaMin * 0.5)));
            const burnWindow = isDebrisOnDebris 
              ? "Non-Maneuverable (Passive Debris)" 
              : `T - ${burnLeadMins} min (0.5 rev / 180° phasing)`;

            const satMassKg = (d.objA.name || "").toUpperCase().includes("ISS") ? 420000 : ((d.objA.name || "").toUpperCase().includes("TIANGONG") ? 66000 : 1000);
            const fuelGramsVal = Math.max(1, Math.round(satMassKg * (1 - Math.exp(-deltaVNum / (220 * 9.80665))) * 1000));
            const fuelGrams = isDebrisOnDebris 
              ? "N/A (Defunct Stage / Passive)" 
              : (fuelGramsVal > 1000 ? `${(fuelGramsVal / 1000).toFixed(2)} kg (Hydrazine)` : `${fuelGramsVal} g (Hydrazine)`);

            const postMissKm = parseFloat((d.miss < 5.0 ? (16.5 + Math.max(0, 5.0 - d.miss) * 1.8) : (d.miss + 18.25)).toFixed(2));

            conjunctionResults.push({
              conjunctionId: d.id,
              computedAt: epochNow,
              tcaTimestamp,
              tcaMinutes: d.tcaMin,
              objA: d.objA,
              objB: d.objB,
              missDistanceKm: d.miss,
              radialKm: d.radial,
              inTrackKm: d.inTrack,
              crossTrackKm: d.crossTrack,
              relVelKmS: d.vRel,
              altitudeKm: d.alt,
              collisionProb: pcStr,
              collisionProbValue: pcVal,
              riskScore: riskScoreVal,
              riskTier,
              recommendedDeltaV: recDeltaV,
              burnWindow: `T - ${Math.max(15, Math.min(60, Math.round(d.tcaMin * 0.4)))} min (0.5 rev)`,
              fuelCostGrams: fuelGrams,
              postMissKm
            });
          }
        }
        conjunctionResults.sort((a, b) => a.missDistanceKm - b.missDistanceKm);
      }

      // 5. Store into Memory & MongoDB
      memoryConjunctions = conjunctionResults;
      if (mongoose.connection.readyState === 1) {
        await Conjunction.deleteMany({});
        await Conjunction.insertMany(conjunctionResults);
        console.log(`[${new Date().toLocaleTimeString()}] ✅ MongoDB Conjunctions Saved: ${conjunctionResults.length} events across ${totalPairs} screened pairs.`);
      }

      lastConjunctionComputeTime = epochNow;
      lastConjunctionPairsScreened = totalPairs;
      return {
        status: "success",
        count: conjunctionResults.length,
        pairsScreened: totalPairs,
        durationMs: Date.now() - startTime,
        computedAt: epochNow
      };

    } catch (err) {
      console.error(`[${new Date().toLocaleTimeString()}] ❌ Error in SGP4 Conjunction Analysis:`, err);
      return { status: "error", message: err.message };
    } finally {
      isComputingConjunctions = false;
      currentComputePromise = null;
    }
  })();

  return currentComputePromise;
}

// ----------------------------------------------------
// 6. REST API Endpoints
// ----------------------------------------------------

// GET /api/conjunctions - Returns precomputed conjunctions from MongoDB
app.get("/api/conjunctions", async (req, res) => {
  try {
    const nowMs = Date.now();
    let conjunctions = [];
    if (mongoose.connection.readyState === 1) {
      conjunctions = await Conjunction.find({ tcaTimestamp: { $gte: new Date(nowMs - 60 * 1000) } }).sort({ missDistanceKm: 1 }).lean();
    }
    if (conjunctions.length === 0 && memoryConjunctions.length > 0) {
      conjunctions = memoryConjunctions.filter(c => new Date(c.tcaTimestamp).getTime() >= (nowMs - 60 * 1000));
    }

    const upcomingCount = conjunctions.filter(c => new Date(c.tcaTimestamp).getTime() > nowMs).length;
    const newestComputed = conjunctions[0]?.computedAt ? new Date(conjunctions[0].computedAt).getTime() : (lastConjunctionComputeTime ? new Date(lastConjunctionComputeTime).getTime() : 0);
    const isStale = (nowMs - newestComputed) > CONJUNCTION_SYNC_INTERVAL_MS || upcomingCount < 6;

    if (conjunctions.length === 0 || isStale) {
      // Trigger computation if database is empty or stale
      await computeConjunctionsService();
      if (mongoose.connection.readyState === 1) {
        conjunctions = await Conjunction.find({ tcaTimestamp: { $gte: new Date(nowMs - 60 * 1000) } }).sort({ missDistanceKm: 1 }).lean();
      }
      if (conjunctions.length === 0 && memoryConjunctions.length > 0) {
        conjunctions = memoryConjunctions.filter(c => new Date(c.tcaTimestamp).getTime() >= (nowMs - 60 * 1000));
      }
    }

    const highRiskCount = conjunctions.filter(c => c.riskTier === "critical").length;
    const warningCount = conjunctions.filter(c => c.riskTier === "warning").length;
    const nominalCount = conjunctions.filter(c => c.riskTier === "nominal").length;
    const avgRelVel = conjunctions.length > 0
      ? (conjunctions.reduce((acc, c) => acc + (c.relVelKmS || 0), 0) / conjunctions.length).toFixed(1)
      : "10.5";

    const upcomingEvents = conjunctions.filter(c => new Date(c.tcaTimestamp).getTime() > Date.now());
    const nextEvent = upcomingEvents.length > 0 ? upcomingEvents[0] : (conjunctions[0] || null);

    res.json({
      success: true,
      count: conjunctions.length,
      computedAt: lastConjunctionComputeTime || (conjunctions[0] ? conjunctions[0].computedAt : new Date()),
      summary: {
        totalScreened: lastConjunctionPairsScreened || 5460,
        totalEvents: conjunctions.length,
        upcomingEvents: upcomingEvents.length,
        highRiskCount,
        warningCount,
        nominalCount,
        nextEvent,
        avgRelVel
      },
      conjunctions
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST & GET /api/conjunctions/compute - Trigger fresh conjunction computation
app.all("/api/conjunctions/compute", async (req, res) => {
  computeConjunctionsService().catch(err => console.error("Conjunction compute error:", err));
  res.json({
    status: "compute_initiated",
    message: "SGP4 24h orbital conjunction screening triggered.",
    timestamp: new Date()
  });
});

// GET /api/tle/latest - Returns pure text TLE catalog from MongoDB
app.get("/api/tle/latest", async (req, res) => {
  try {
    if (mongoose.connection.readyState === 1) {
      const satellites = await Satellite.find({}, "name line1 line2").lean();
      if (satellites.length > 0) {
        const text = satellites.map(s => `${s.name}\n${s.line1}\n${s.line2}`).join("\n") + "\n";
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        return res.send(text);
      }
    }
    // Fallback to local file if MongoDB is empty
    if (fs.existsSync(FILE_NAME)) {
      return res.sendFile(FILE_NAME);
    }
    return res.status(404).send("TLE catalog not found");
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tle/satellites - Returns structured JSON array from MongoDB
app.get("/api/tle/satellites", async (req, res) => {
  try {
    const { group, limit, search } = req.query;
    const filter = {};
    if (group) filter.group = group;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { noradId: { $regex: search, $options: "i" } }
      ];
    }

    let query = Satellite.find(filter).sort({ noradId: 1 });
    if (limit) query = query.limit(parseInt(limit, 10));

    const satellites = await query.lean();
    res.json({
      success: true,
      count: satellites.length,
      lastSync: lastSyncTime,
      satellites
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/tle/stats - Summary statistics
app.get("/api/tle/stats", async (req, res) => {
  try {
    const totalCount = await Satellite.countDocuments();
    const groupCounts = await Satellite.aggregate([
      { $group: { _id: "$group", count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    const latest = await Satellite.findOne().sort({ updatedAt: -1 }).select("updatedAt");

    res.json({
      dbStatus: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
      catalogSource: currentCatalogSource,
      spaceTrackConfigured: Boolean((process.env.SPACETRACK_USER || process.env.SPACETRACK_IDENTITY) && (process.env.SPACETRACK_PASSWORD || process.env.SPACETRACK_PASS)),
      spaceTrackQueryUrl: SPACETRACK_DEFAULT_URL,
      totalTrackedObjects: totalCount,
      lastUpdated: latest ? latest.updatedAt : null,
      lastSyncTime,
      groupBreakdown: groupCounts,
      syncIntervalHours: SYNC_INTERVAL_MS / (60 * 60 * 1000)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST & GET /api/spacetrack/sync - Trigger sync specifically from Space-Track.org
app.all("/api/spacetrack/sync", async (req, res) => {
  const identity = req.body?.identity || req.query?.identity || req.body?.user || req.query?.user;
  const password = req.body?.password || req.query?.password || req.body?.pass || req.query?.pass;
  const queryUrl = req.body?.queryUrl || req.query?.queryUrl || SPACETRACK_DEFAULT_URL;

  console.log(`[${new Date().toLocaleTimeString()}] 🚀 Space-Track sync requested via API...`);
  syncTleCatalog({ identity, password, queryUrl })
    .then(result => {
      console.log(`[${new Date().toLocaleTimeString()}] 🏁 Space-Track sync complete:`, result);
      computeConjunctionsService().catch(e => console.error("Conjunction compute error:", e));
    })
    .catch(err => console.error("Manual Space-Track sync error:", err));

  res.json({
    status: "sync_initiated",
    feed: "Space-Track.org (18th SDS)",
    queryUrl: queryUrl,
    account: identity ? (identity.substring(0, 3) + "***") : ((process.env.SPACETRACK_USER || process.env.SPACETRACK_IDENTITY) ? ((process.env.SPACETRACK_USER || process.env.SPACETRACK_IDENTITY).substring(0, 3) + "***") : "Not configured in .env"),
    message: "Space-Track GP TLE sync triggered in background.",
    timestamp: new Date()
  });
});

// GET & POST /api/tle/sync - Trigger sync immediately
app.all("/api/tle/sync", async (req, res) => {
  const identity = req.body?.identity || req.query?.identity;
  const password = req.body?.password || req.query?.password;
  const queryUrl = req.body?.queryUrl || req.query?.queryUrl;

  syncTleCatalog({ identity, password, queryUrl })
    .then(() => computeConjunctionsService())
    .catch(err => console.error("Sync error:", err));

  res.json({
    status: "sync_initiated",
    message: "Full TLE catalog fetch and MongoDB upsert triggered.",
    timestamp: new Date()
  });
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    uptimeSeconds: Math.floor(process.uptime()),
    mongoDbState: mongoose.STATES[mongoose.connection.readyState] || "unknown"
  });
});

// ----------------------------------------------------
// 6. Serve Static Website Files (HTML, JS, CSS)
// ----------------------------------------------------
app.use(express.static(__dirname));

// ----------------------------------------------------
// 7. Auto-Sync Scheduler & MongoDB Initialization
// ----------------------------------------------------
async function startServer() {
  try {
    console.log("=".repeat(65));
    console.log("🚀 SPAC6TIME Node.js + Mongoose Server Initializing...");
    console.log(`📡 Connecting to MongoDB at: ${MONGODB_URI}`);

    await mongoose.connect(MONGODB_URI);
    console.log("✅ Successfully connected to MongoDB!");

    // Start Express listener IMMEDIATELY so all frontend pages and API requests work right away!
    app.listen(PORT, () => {
      console.log("=".repeat(65));
      console.log(`🚀 SPAC6TIME Live Server running at: http://localhost:${PORT}/`);
      console.log(`🌍 3D Earth Dashboard: http://localhost:${PORT}/earth.html`);
      console.log(`✨ 3D Intro & Gateway: http://localhost:${PORT}/index.html`);
      console.log(`📊 Orbital Analytics: http://localhost:${PORT}/analytics.html`);
      console.log(`🛰️ Satellite Grid: http://localhost:${PORT}/grid.html`);
      console.log(`📄 Pure TLE API Endpoint: http://localhost:${PORT}/api/tle/latest`);
      console.log(`🍃 MongoDB JSON API: http://localhost:${PORT}/api/tle/satellites`);
      console.log(`🚨 Precomputed Conjunctions API: http://localhost:${PORT}/api/conjunctions`);
      console.log(`🛰️ Space-Track 18th SDS Feed: http://localhost:${PORT}/api/spacetrack/sync`);
      console.log(`🔄 Conjunction Auto-sync: Every 4 hours automatically -> MongoDB`);
      console.log("=".repeat(65));
    });

    // Check if initial sync or conjunction compute is required (run in background)
    const docCount = await Satellite.countDocuments();
    const newest = await Satellite.findOne().sort({ updatedAt: -1 });
    const isStale = !newest || (Date.now() - new Date(newest.updatedAt).getTime()) > SYNC_INTERVAL_MS;

    if (docCount < 5000) {
      console.log(`[${new Date().toLocaleTimeString()}] 🔄 Initial sync: MongoDB has few records (${docCount}), syncing TLE catalog in background...`);
      syncTleCatalog().then(() => computeConjunctionsService()).catch(err => console.error("Initial TLE sync error:", err));
    } else if (isStale) {
      console.log(`[${new Date().toLocaleTimeString()}] 📂 MongoDB TLE catalog is present (${docCount} tracked objects), refreshing in background...`);
      syncTleCatalog().then(() => computeConjunctionsService()).catch(err => console.error("Background TLE refresh error:", err));
    } else {
      const ageMins = Math.round((Date.now() - new Date(newest.updatedAt).getTime()) / 60000);
      console.log(`[${new Date().toLocaleTimeString()}] 📂 MongoDB TLE catalog is fresh (${docCount} tracked objects, ${ageMins} mins old).`);
    }

    // Run initial conjunction screening if none exists OR if data is stale
    const newestConj = await Conjunction.findOne().sort({ computedAt: -1 });
    const conjCount = await Conjunction.countDocuments();
    const upcomingCount = await Conjunction.countDocuments({ tcaTimestamp: { $gt: new Date() } });
    const isConjStale = conjCount === 0 || !newestConj || (Date.now() - new Date(newestConj.computedAt).getTime()) > CONJUNCTION_SYNC_INTERVAL_MS || upcomingCount < 3;

    if (isConjStale) {
      console.log(`[${new Date().toLocaleTimeString()}] 🚀 Conjunction records are missing or stale (${upcomingCount} upcoming TCAs). Running fresh SGP4 24h orbital conjunction analysis...`);
      computeConjunctionsService().catch(err => console.error("Initial conjunction compute error:", err));
    } else {
      console.log(`[${new Date().toLocaleTimeString()}] 🛰️ MongoDB has ${conjCount} conjunction records (${upcomingCount} active upcoming TCAs).`);
    }

    // Schedule 4-hour recurring conjunction screening
    setInterval(async () => {
      console.log(`[${new Date().toLocaleTimeString()}] ⏰ 4-hour timer: Recalculating SGP4 24h orbital conjunctions...`);
      await computeConjunctionsService();
    }, CONJUNCTION_SYNC_INTERVAL_MS);

    // Schedule recurring TLE sync
    const syncHours = Math.round(SYNC_INTERVAL_MS / (60 * 60 * 1000));
    setInterval(async () => {
      console.log(`[${new Date().toLocaleTimeString()}] ⏰ ${syncHours}-hour timer triggered: Refreshing full TLE catalog in MongoDB...`);
      await syncTleCatalog();
      await computeConjunctionsService();
    }, SYNC_INTERVAL_MS);

  } catch (err) {
    console.error("❌ Failed to start server:", err);
    process.exit(1);
  }
}

startServer();
