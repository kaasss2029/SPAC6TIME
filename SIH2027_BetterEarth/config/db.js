"use strict";

// ============================================================
// config/db.js
// Single Mongoose connection for the process.
// ============================================================

const mongoose = require("mongoose");

async function connectMongo() {
    if (mongoose.connection.readyState !== 0) return;

    const uri =
        process.env.MONGO_URI ||
        "mongodb://127.0.0.1:27017/orbitguard";

    await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 10000,
    });

    console.log(`[DB] Connected to MongoDB → ${uri}`);

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
}

async function shutdown(signal) {
    console.log(`\n[DB] ${signal} received — closing MongoDB connection.`);
    await mongoose.connection.close();
    process.exit(0);
}

module.exports = { connectMongo };
