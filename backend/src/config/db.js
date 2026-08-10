const mongoose = require('mongoose');
require('dotenv').config();

let isConnected = false;

async function connectDB() {
  const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/smart-doc-qa';

  try {
    mongoose.set('strictQuery', true);
    await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 3000,
    });
    isConnected = true;
    console.log(`\n🍃 MongoDB Connected: ${mongoose.connection.host}`);
  } catch (error) {
    console.warn(`\n⚠️  MongoDB connection failed (${error.message}). Operating with in-memory persistence fallback.`);
    isConnected = false;
  }
}

function getIsConnected() {
  return isConnected;
}

module.exports = {
  connectDB,
  getIsConnected,
};
