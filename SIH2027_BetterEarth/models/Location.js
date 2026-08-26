"use strict";

// ============================================================
// models/Location.js
// Mongoose schema for normalized location records stored in MongoDB.
// Supports GeoJSON 2dsphere indexing and unique externalId upserts.
// ============================================================

const mongoose = require("mongoose");

const locationSchema = new mongoose.Schema(
    {
        externalId: {
            type: String,
            required: true,
            unique: true,
            index: true,
            trim: true,
        },
        name: {
            type: String,
            required: true,
            trim: true,
        },
        description: {
            type: String,
            default: "",
            trim: true,
        },
        latitude: {
            type: Number,
            required: true,
            min: -90,
            max: 90,
        },
        longitude: {
            type: Number,
            required: true,
            min: -180,
            max: 180,
        },
        location: {
            type: {
                type: String,
                enum: ["Point"],
                default: "Point",
            },
            coordinates: {
                type: [Number], // [longitude, latitude] for GeoJSON
                required: true,
            },
        },
        address: {
            type: String,
            default: "N/A",
            trim: true,
        },
        category: {
            type: String,
            default: "General",
            trim: true,
        },
        source: {
            type: String,
            default: "external-api",
            trim: true,
        },
        distance: {
            type: Number,
            default: null,
        },
        rawData: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        lastUpdated: {
            type: Date,
            default: Date.now,
            index: true,
        },
    },
    {
        timestamps: true,
        collection: "locations",
    }
);

locationSchema.index({ location: "2dsphere" });
locationSchema.index({ lastUpdated: -1 });

const Location =
    mongoose.models.Location || mongoose.model("Location", locationSchema);

module.exports = Location;
