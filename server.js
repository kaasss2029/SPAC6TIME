const express = require('express');
const path = require('path');
const cors = require('cors');
const dotenv = require('dotenv');
const { connectMongo } = require('./src/config/db');
const orbitService = require('./src/services/orbitService');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'OrbitGuard API',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/dashboard', async (req, res) => {
  try {
    const snapshot = await orbitService.getDashboardSnapshot();
    res.json(snapshot);
  } catch (error) {
    res.status(500).json({
      error: 'Unable to produce dashboard snapshot.',
      details: error.message
    });
  }
});

app.get('/api/satellites', async (req, res) => {
  try {
    const records = await orbitService.getStoredSatelliteRecords();
    res.json(records);
  } catch (error) {
    res.status(500).json({
      error: 'Unable to fetch satellite data.',
      details: error.message
    });
  }
});

app.get('/api/conjunctions', async (req, res) => {
  try {
    const snapshot = await orbitService.getDashboardSnapshot();
    res.json(snapshot.conjunctions);
  } catch (error) {
    res.status(500).json({
      error: 'Unable to fetch conjunction events.',
      details: error.message
    });
  }
});

app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'BetterEarthSIH.HTML'));
});

async function startServer() {
  await connectMongo();

  app.listen(PORT, () => {
    console.log(`OrbitGuard server running on http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Server startup failed:', error);
  process.exit(1);
});
