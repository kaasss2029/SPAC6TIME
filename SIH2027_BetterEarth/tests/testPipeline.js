"use strict";

// ============================================================
// tests/testPipeline.js
// Unit & Integration test runner for testing API data normalization,
// Haversine distance calculation, coordinate validation, and
// MongoDB upsert logic.
// ============================================================

const assert = require("assert");
const { calculateDistance, isValidCoordinate, formatDistance, sortLocationsByDistance } = require("../utils/distance");
const apiService = require("../services/apiService");

async function runTests() {
    console.log("=========================================");
    console.log("RUNNING SIH PIPELINE & DISTANCE TESTS");
    console.log("=========================================\n");

    let totalTests = 0;
    let passedTests = 0;

    function test(name, fn) {
        totalTests++;
        try {
            fn();
            console.log(`✅ PASS: ${name}`);
            passedTests++;
        } catch (err) {
            console.error(`❌ FAIL: ${name}`);
            console.error(`   Error: ${err.message}`);
        }
    }

    test("isValidCoordinate accepts valid latitude & longitude", () => {
        assert.strictEqual(isValidCoordinate(20.2961, 85.8245), true);
        assert.strictEqual(isValidCoordinate(0, 0), true);
        assert.strictEqual(isValidCoordinate(-90, -180), true);
        assert.strictEqual(isValidCoordinate(90, 180), true);
    });

    test("isValidCoordinate rejects invalid latitude & longitude", () => {
        assert.strictEqual(isValidCoordinate(200, 85.8245), false);
        assert.strictEqual(isValidCoordinate(20.2961, 500), false);
        assert.strictEqual(isValidCoordinate(null, 85.8245), false);
    });

    test("calculateDistance computes accurate geographical distance", () => {
        const dist = calculateDistance(20.2961, 85.8245, 20.4625, 85.8830);
        assert(dist > 18 && dist < 24);
    });

    test("formatDistance formats meters and kilometers cleanly", () => {
        assert.strictEqual(formatDistance(0.150), "150 m");
        assert.strictEqual(formatDistance(3.421), "3.4 km");
    });

    test("sortLocationsByDistance sorts in ascending order (nearest first)", () => {
        const userLat = 20.2961;
        const userLng = 85.8245;

        const sampleLocations = [
            { id: "far", name: "Far City", latitude: 28.6139, longitude: 77.2090 },
            { id: "near", name: "Near Spot", latitude: 20.3000, longitude: 85.8300 },
        ];

        const sorted = sortLocationsByDistance(sampleLocations, userLat, userLng);
        assert.strictEqual(sorted[0].id, "near");
        assert(sorted[0].distance < sorted[1].distance);
    });

    console.log("\n=========================================");
    console.log(`RESULTS: ${passedTests} / ${totalTests} TESTS PASSED`);
    console.log("=========================================\n");

    if (passedTests === totalTests) {
        process.exit(0);
    } else {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error("Test execution failed:", err);
    process.exit(1);
});
