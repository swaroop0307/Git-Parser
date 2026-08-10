// backend/src/config/env.js
require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 5000,
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/smartdocqa',
  JWT_SECRET: process.env.JWT_SECRET || 'supersecretjwtkey',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  PINECONE_API_KEY: process.env.PINECONE_API_KEY,
  PINECONE_ENVIRONMENT: process.env.PINECONE_ENVIRONMENT,
  CHUNK_SIZE: parseInt(process.env.CHUNK_SIZE) || 1000,
  CHUNK_OVERLAP: parseInt(process.env.CHUNK_OVERLAP) || 200,
  TOP_K: parseInt(process.env.TOP_K) || 5,
};
