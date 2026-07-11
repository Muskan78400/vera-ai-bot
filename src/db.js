import mongoose from 'mongoose';
import config from './config.js';

let isConnected = false;

/**
 * Connects to MongoDB if MONGODB_URI is configured.
 * If not configured (or connection fails), the app falls back to a
 * pure in-memory store (see store.js) so local dev/testing never breaks
 * just because Mongo isn't set up yet.
 */
export async function connectMongo() {
  if (!config.mongoUri) {
    console.warn('[db] MONGODB_URI not set — running with in-memory store (no persistence).');
    return false;
  }
  try {
    await mongoose.connect(config.mongoUri, {
      serverSelectionTimeoutMS: 8000,
    });
    isConnected = true;
    console.log('[db] Connected to MongoDB.');
    return true;
  } catch (err) {
    console.error('[db] MongoDB connection failed, falling back to in-memory store:', err.message);
    return false;
  }
}

export function isMongoConnected() {
  return isConnected;
}
