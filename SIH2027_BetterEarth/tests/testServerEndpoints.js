"use strict";

// ============================================================
// tests/testServerEndpoints.js
// Integration test to verify apiService data normalization,
// coordinate validation, and Haversine distance sorting.
// ============================================================

const assert = require("assert");
const apiService = require("../services/apiService");
const { sortLocationsByDistance } = require("../utils/distance");

async function testIntegration() {
    console.log("=========================================");
    console.log("RUNNING INTEGRATION TESTS FOR API SERVICE");
    console.log("=========================================\n");

    const sampleTle = `ISS (ZARYA)
1 25544U 98067A   24239.54143519  .00014389  00000+0  25686-3 0  9997
2 25544  51.6416 261.3415 0005728 126.7905 315.6543 15.49755437469176`;

    const rawRecords = apiService.parseTleText(sampleTle);
    assert.strictEqual(rawRecords.length, 1);

    const normalized = await apiService.normalizeRecord(rawRecords[0]);
    assert.notStrictEqual(normalized, null);
    assert.strictEqual(normalized.externalId, "25544");

    const sorted = sortLocationsByDistance([
        normalized,
        {
            externalId: "99999",
            name: "Local Ground Hub",
            latitude: 20.3000,
            longitude: 85.8300,
        }
    ], 20.2961, 85.8245);

    assert.strictEqual(sorted[0].externalId, "99999");

    console.log("=========================================");
    console.log("INTEGRATION TESTS COMPLETED SUCCESSFULLY");
    console.log("=========================================\n");
}

testIntegration().catch(err => {
    console.error("Integration test failed:", err);
    process.exit(1);
});
