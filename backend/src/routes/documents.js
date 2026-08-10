const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Document = require('../models/Document');
const { getIsConnected } = require('../config/db');
const { processPdf } = require('../services/documentProcessor');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Upload directory setup
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed!'), false);
    }
  },
  limits: { fileSize: 25 * 1024 * 1024 } // 25 MB limit
});

// In-memory fallback registry if MongoDB is disconnected
const inMemoryDocs = [];

// POST /api/documents/upload (Protected)
router.post('/upload', authenticateToken, upload.array('documents', 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No PDF files provided' });
    }

    const isDbConnected = getIsConnected();
    const results = [];

    for (const file of req.files) {
      console.log(`Processing uploaded PDF: ${file.originalname}...`);
      const result = await processPdf(file.path, file.originalname);

      let docData;
      if (isDbConnected) {
        const created = await Document.create({
          userId: req.user.id,
          filename: file.originalname,
          storedPath: file.path,
          totalPages: result.totalPages,
          chunksIndexed: result.chunksIndexed,
          uploadedAt: new Date(),
        });
        docData = {
          id: created._id.toString(),
          userId: created.userId,
          filename: created.filename,
          totalPages: created.totalPages,
          chunksIndexed: created.chunksIndexed,
          uploadedAt: created.uploadedAt,
        };
      } else {
        docData = {
          id: Date.now().toString() + Math.random().toString(36).substring(2, 7),
          userId: req.user.id,
          filename: file.originalname,
          storedPath: file.path,
          totalPages: result.totalPages,
          chunksIndexed: result.chunksIndexed,
          uploadedAt: new Date().toISOString(),
        };
        inMemoryDocs.push(docData);
      }

      results.push(docData);
    }

    res.status(200).json({
      message: `Successfully processed ${results.length} PDF document(s).`,
      documents: results
    });

  } catch (error) {
    console.error('Upload Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/documents (Protected)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const isDbConnected = getIsConnected();
    if (isDbConnected) {
      const docs = await Document.find({ userId: req.user.id }).sort({ uploadedAt: -1 });
      const formatted = docs.map(d => ({
        id: d._id.toString(),
        filename: d.filename,
        totalPages: d.totalPages,
        chunksIndexed: d.chunksIndexed,
        uploadedAt: d.uploadedAt,
      }));
      return res.json({ documents: formatted });
    }

    const userDocs = inMemoryDocs.filter(d => d.userId === req.user.id);
    res.json({ documents: userDocs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/documents/:id (Protected)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const isDbConnected = getIsConnected();
    let removedPath = null;

    if (isDbConnected) {
      const doc = await Document.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
      if (!doc) {
        return res.status(404).json({ error: 'Document not found' });
      }
      removedPath = doc.storedPath;
    } else {
      const index = inMemoryDocs.findIndex(d => d.id === req.params.id && d.userId === req.user.id);
      if (index === -1) {
        return res.status(404).json({ error: 'Document not found' });
      }
      const [removed] = inMemoryDocs.splice(index, 1);
      removedPath = removed.storedPath;
    }

    if (removedPath && fs.existsSync(removedPath)) {
      try {
        fs.unlinkSync(removedPath);
      } catch (e) {
        console.warn('Could not delete physical file:', e.message);
      }
    }

    res.json({ message: 'Document deleted successfully', id: req.params.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
