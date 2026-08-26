"use strict";

// ============================================================
// models/model.js
// Mongoose schema for satellite TLE records in MongoDB.
// ============================================================

const mongoose = require("mongoose");

const satelliteSchema = new mongoose.Schema(
    {
        noradId: {
            type: Number,
            required: true,
            unique: true,
            index: true,
        },
        name: {
            type: String,
            required: true,
            trim: true,
        },
        line1: {
            type: String,
            required: true,
            trim: true,
        },
        line2: {
            type: String,
            required: true,
            trim: true,
        },
        fetchedAt: {
            type: Date,
            default: Date.now,
            index: true,
        },
        epoch: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
        collection: "satellites",
    }
);

satelliteSchema.virtual("NORAD_CAT_ID").get(function () {
    return this.noradId;
});

const Satellite =
    mongoose.models.Satellite ||
    mongoose.model("Satellite", satelliteSchema);

module.exports = Satellite;
