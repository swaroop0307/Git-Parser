require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { validateGithubUrl } = require("./security");
const { cloneRepository, parseRepository } = require("./parser");
const { indexDocuments } = require("./indexer");
const { retrieveAndGenerateStream } = require("./retriever");

const app = express();
const PORT = process.env.PORT || 8000;

// Enable CORS
app.use(cors({ origin: "*" }));
app.use(express.json());

// SQLite Concurrency Mutex Lock:
// Node Express processes async requests concurrently. We lock the indexer route
// to prevent SQLite locking collisions in ChromaDB during index updates.
let isIndexing = false;

// Health Status Endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    openai_key_configured: !!process.env.OPENAI_API_KEY,
    database_url: process.env.CHROMADB_URL || "http://localhost:8000"
  });
});

// Indexing Ingestion Endpoint
app.post("/index", async (req, res) => {
  const { repo_url } = req.body;
  if (!repo_url) {
    return res.status(400).json({ detail: "repo_url parameter is required." });
  }
  
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ detail: "OpenAI API key is not configured on backend." });
  }
  
  let safeRepoUrl;
  try {
    safeRepoUrl = validateGithubUrl(repo_url);
  } catch (error) {
    return res.status(400).json({ detail: error.message });
  }
  
  // Guard concurrency conflicts
  if (isIndexing) {
    return res.status(409).json({
      detail: "The indexing service is currently busy. Please wait for the current repository to finish indexing."
    });
  }
  
  isIndexing = true;
  
  // Create unique clone folder
  const baseCloneDir = process.env.TEMP_CLONE_DIR || "./temp_repos";
  const uniqueId = `repo_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const cloneDir = path.resolve(path.join(baseCloneDir, uniqueId));
  
  try {
    fs.mkdirSync(cloneDir, { recursive: true });
    
    // 1. Clone repository (shallow clone)
    console.log(`Cloning ${safeRepoUrl} into ${cloneDir}...`);
    await cloneRepository(safeRepoUrl, cloneDir);
    
    // 2. Parse codebase recursively
    console.log(`Parsing codebase in ${cloneDir}...`);
    const documents = parseRepository(cloneDir, safeRepoUrl);
    
    // 3. Index embeddings in ChromaDB (idempotent delete-before-insert)
    console.log(`Indexing ${documents.length} chunks into ChromaDB...`);
    await indexDocuments(documents, safeRepoUrl);
    
    res.json({
      success: true,
      repo_url: safeRepoUrl,
      chunks_indexed: documents.length,
      message: `Successfully indexed ${documents.length} code chunks.`
    });
  } catch (error) {
    console.error(`Indexing error: ${error.message}`);
    res.status(500).json({ detail: error.message });
  } finally {
    isIndexing = false;
    
    // Clean up temporary clone workspace safely
    try {
      if (fs.existsSync(cloneDir)) {
        fs.rmSync(cloneDir, { recursive: true, force: true });
        console.log(`Temp clone directory ${cloneDir} cleaned up successfully.`);
      }
    } catch (cleanupErr) {
      console.error(`Warning: Failed to clean up temp clone directory: ${cleanupErr.message}`);
    }
  }
});

// Q&A / SSE Streaming Endpoint
app.post("/ask", async (req, res) => {
  const { repo_url, question } = req.body;
  if (!repo_url || !question) {
    return res.status(400).json({ detail: "repo_url and question parameters are required." });
  }
  
  let safeRepoUrl;
  try {
    safeRepoUrl = validateGithubUrl(repo_url);
  } catch (error) {
    return res.status(400).json({ detail: error.message });
  }
  
  // Set SSE response headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  
  try {
    await retrieveAndGenerateStream(safeRepoUrl, question, res);
  } catch (error) {
    console.error(`RAG Stream error: ${error.message}`);
    res.write(`data: ${JSON.stringify({ event: "error", data: error.message })}\n\n`);
    res.write(`data: ${JSON.stringify({ event: "done" })}\n\n`);
    res.end();
  }
});

// Start Express Server
app.listen(PORT, () => {
  console.log(`\n🚀 RAG Explainer Express Backend running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
