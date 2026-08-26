"use strict";

// ============================================================
// services/orbitService.js
// Service layer for satellite orbit mechanics and dashboard snapshots.
// ============================================================

const Satellite = require("../models/model");
const apiService = require("./apiService");

const MAX_CONJUNCTION_SATS = 30;
const SCREEN_KM = 2000;
const COARSE_STEP_MIN = 5;
const FINE_STEP_MIN = 10 / 60;
const FINE_HALF_WINDOW_MIN = COARSE_STEP_MIN * 2;
const HOURS_AHEAD = 24;
const MS_PER_MIN = 60 * 1000;

let satLib = null;
async function getSatLib() {
    if (satLib) return satLib;
    satLib = await import("satellite.js");
    return satLib;
}

async function getState(satrec, time) {
    const { propagate } = await getSatLib();
    const result = propagate(satrec, time);

    if (
        !result.position ||
        !result.velocity ||
        !isFinite(result.position.x) ||
        !isFinite(result.position.y) ||
        !isFinite(result.position.z)
    ) {
        return null;
    }

    return {
        position: result.position,
        velocity: result.velocity,
    };
}

function distanceBetween(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function relativeVelocity(va, vb) {
    const vx = va.x - vb.x;
    const vy = va.y - vb.y;
    const vz = va.z - vb.z;
    return Math.sqrt(vx * vx + vy * vy + vz * vz);
}

async function findTCA(satrecA, satrecB, now) {
    const coarseTotalSteps = Math.round((HOURS_AHEAD * 60) / COARSE_STEP_MIN);

    let coarseMinDist = Infinity;
    let coarseTcaTime = null;

    for (let step = 0; step <= coarseTotalSteps; step++) {
        const time = new Date(now.getTime() + step * COARSE_STEP_MIN * MS_PER_MIN);
        const stateA = await getState(satrecA, time);
        const stateB = await getState(satrecB, time);

        if (!stateA || !stateB) continue;

        const dist = distanceBetween(stateA.position, stateB.position);
        if (dist < coarseMinDist) {
            coarseMinDist = dist;
            coarseTcaTime = time;
        }
    }

    if (!coarseTcaTime || coarseMinDist > SCREEN_KM) {
        return null;
    }

    const fineStart = new Date(coarseTcaTime.getTime() - FINE_HALF_WINDOW_MIN * MS_PER_MIN);
    const fineTotalSteps = Math.round((FINE_HALF_WINDOW_MIN * 2) / FINE_STEP_MIN);

    let minimumDistance = Infinity;
    let tcaTime = null;
    let tcaRelVel = 0;

    for (let step = 0; step <= fineTotalSteps; step++) {
        const time = new Date(fineStart.getTime() + step * FINE_STEP_MIN * MS_PER_MIN);
        const stateA = await getState(satrecA, time);
        const stateB = await getState(satrecB, time);

        if (!stateA || !stateB) continue;

        const dist = distanceBetween(stateA.position, stateB.position);
        if (dist < minimumDistance) {
            minimumDistance = dist;
            tcaTime = time;
            tcaRelVel = relativeVelocity(stateA.velocity, stateB.velocity);
        }
    }

    if (!tcaTime || !isFinite(minimumDistance)) return null;

    return {
        minimumDistance,
        tcaTime,
        timeToTcaMinutes: (tcaTime.getTime() - now.getTime()) / MS_PER_MIN,
        tcaRelVel,
    };
}

function riskLevel(distKm) {
    if (distKm < 50) return "HIGH";
    if (distKm < 500) return "MEDIUM";
    return "LOW";
}

function riskScore(distKm) {
    const clamped = Math.max(0, Math.min(distKm, 2000));
    const score = 100 - (clamped / 2000) * 95;
    return Math.round(Math.max(1, Math.min(99, score)));
}

function pickSubset(satellites, limit) {
    if (satellites.length <= limit) return [...satellites];
    const ISS_NORAD = 25544;
    const iss = satellites.find(s => s.noradId === ISS_NORAD);
    const rest = satellites.filter(s => s.noradId !== ISS_NORAD);

    if (iss) return [iss, ...rest.slice(0, limit - 1)];
    return rest.slice(0, limit);
}

async function getStoredSatelliteRecords() {
    const count = await Satellite.countDocuments();
    if (count === 0) {
        await apiService.syncLocationsFromAPI();
    }

    const docs = await Satellite.find({})
        .select("noradId name line1 line2 -_id")
        .lean();

    return docs.map(d => ({
        name: d.name,
        line1: d.line1,
        line2: d.line2,
        NORAD_CAT_ID: d.noradId,
    }));
}

async function getDashboardSnapshot() {
    const count = await Satellite.countDocuments();
    if (count === 0) {
        await apiService.syncLocationsFromAPI();
    }

    const allDocs = await Satellite.find({})
        .select("noradId name line1 line2 -_id")
        .lean();

    const totalTracked = allDocs.length;
    const { twoline2satrec } = await getSatLib();

    const parsed = allDocs
        .map(d => {
            try {
                const satrec = twoline2satrec(d.line1, d.line2);
                if (satrec.error !== 0) return null;
                return { name: d.name, noradId: d.noradId, satrec };
            } catch {
                return null;
            }
        })
        .filter(Boolean);

    const subset = pickSubset(parsed, MAX_CONJUNCTION_SATS);
    const now = new Date();
    const events = [];

    for (let i = 0; i < subset.length; i++) {
        for (let j = i + 1; j < subset.length; j++) {
            const result = await findTCA(subset[i].satrec, subset[j].satrec, now);
            if (!result) continue;

            const { minimumDistance, tcaTime, timeToTcaMinutes, tcaRelVel } = result;
            const tcaDisplayMinutes = Math.round(timeToTcaMinutes);
            const tcaDisplayString = tcaDisplayMinutes < 0 ? "Now" : `${tcaDisplayMinutes} min`;

            events.push({
                objA: subset[i].name,
                objB: subset[j].name,
                dist: minimumDistance.toFixed(1),
                distValue: minimumDistance,
                tca: tcaDisplayString,
                tcaValue: tcaDisplayMinutes,
                relVel: tcaRelVel.toFixed(2),
                risk: riskLevel(minimumDistance),
                tcaDate: tcaTime,
                score: riskScore(minimumDistance),
            });
        }
    }

    events.sort((a, b) => a.tcaValue - b.tcaValue);
    const highRiskCount = events.filter(e => e.risk === "HIGH").length;
    const nextTca = events.length > 0 ? { minutes: events[0].tcaValue, objA: events[0].objA, objB: events[0].objB } : null;

    return {
        totalTracked,
        conjunctions: events,
        highRiskCount,
        nextTca,
        computedAt: now.toISOString(),
    };
}

module.exports = {
    getStoredSatelliteRecords,
    getDashboardSnapshot,
};
