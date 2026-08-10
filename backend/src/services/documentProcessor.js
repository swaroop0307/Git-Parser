const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
const { v4: uuidv4 } = require('uuid');
const { addChunks } = require('./vectorStore');
require('dotenv').config();

const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE) || 1000;
const CHUNK_OVERLAP = parseInt(process.env.CHUNK_OVERLAP) || 200;

/**
 * Split a string into overlapping character chunks
 */
function splitIntoChunks(text, source, page) {
  const chunks = [];
  if (!text || text.trim().length === 0) return chunks;
  
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    const chunkText = text.slice(start, end).trim();
    if (chunkText.length > 0) {
      chunks.push({
        text: chunkText,
        source,
        page,
        chunkId: uuidv4(),
      });
    }
    start += (CHUNK_SIZE - CHUNK_OVERLAP);
  }
  return chunks;
}

/**
 * Process a PDF file by extracting page-wise text and creating vector embeddings
 */
async function processPdf(pdfPath, originalFilename) {
  const dataBuffer = fs.readFileSync(pdfPath);
  const pdfData = await pdf(dataBuffer);
  
  const sourceName = originalFilename || path.basename(pdfPath);
  
  // Page break character '\f' handles page division in pdf-parse output
  const pages = pdfData.text.split('\f');
  const allChunks = [];

  for (let i = 0; i < pages.length; i++) {
    const pageNum = i + 1;
    const pageText = pages[i].trim();
    if (!pageText) continue;

    const pageChunks = splitIntoChunks(pageText, sourceName, pageNum);
    allChunks.push(...pageChunks);
  }

  // Store in vector DB
  await addChunks(allChunks);

  return {
    filename: sourceName,
    totalPages: pdfData.numpages,
    chunksIndexed: allChunks.length,
  };
}

module.exports = {
  processPdf,
};
