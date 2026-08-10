require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const { connectDB } = require('./config/db');

// Import routes
const authRoutes = require('./routes/auth');
const documentRoutes = require('./routes/documents');
const ragRoutes = require('./routes/rag');

const app = express();
const PORT = process.env.PORT || 5000;

// --- Connect MongoDB ---
connectDB();

// --- Middleware ---

app.use(cors({ origin: '*' }));
app.use(express.json());

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// --- API Routes ---
app.use('/api/auth', authRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/chat', ragRoutes);

// --- Global Error Handler ---
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err);
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large. Max 25 MB.' });
  }
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`\n🚀 Smart Document Q&A Backend running on http://localhost:${PORT}`);
  console.log(`   Auth:      POST /api/auth/register | /api/auth/login`);
  console.log(`   Upload:    POST /api/documents/upload`);
  console.log(`   Query:     POST /api/chat/query`);
  console.log(`   Documents: GET  /api/documents\n`);
});
