import dns from 'node:dns';
import mongoose from 'mongoose';

// Fix for "querySrv ECONNREFUSED" on Windows / some ISPs: the local DNS can't resolve
// mongodb+srv SRV records, so use public resolvers for Node's lookups.
dns.setServers((process.env.DNS_SERVERS || '8.8.8.8,1.1.1.1').split(',').map((s) => s.trim()));

async function tryConnect(uri, label) {
  await mongoose.connect(uri, {
    dbName: process.env.MONGO_DB_NAME || 'Habit_Tracker',
    serverSelectionTimeoutMS: 15000,
    // Keep warm connections so requests never wait for a fresh TLS handshake to Atlas
    minPoolSize: 5,
    maxPoolSize: 20,
  });
  console.log(`MongoDB connected (${label}) -> db "${mongoose.connection.name}"`);
}

export async function connectDB() {
  const { MONGO_URI, MONGO_URI_FALLBACK } = process.env;
  if (!MONGO_URI) throw new Error('MONGO_URI missing in .env');

  try {
    await tryConnect(MONGO_URI, 'primary');
  } catch (err) {
    console.error('Primary MongoDB connection failed:', err.message);
    if (!MONGO_URI_FALLBACK) throw err;
    console.log('Trying MONGO_URI_FALLBACK (non-SRV connection string)...');
    await mongoose.disconnect().catch(() => {});
    await tryConnect(MONGO_URI_FALLBACK, 'fallback');
  }
}
