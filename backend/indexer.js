const { ChromaClient } = require("chromadb");
const { OpenAI } = require("openai");

// Initialize OpenAI client for embeddings
function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }
  return new OpenAI({ apiKey });
}

// Get Chroma client pointing to local DB server
function getChromaClient() {
  const host = process.env.CHROMADB_URL || "http://localhost:8000";
  return new ChromaClient({ path: host });
}

/**
 * Deletes all indexed documents associated with a repo URL.
 * Ensures re-indexing clean slate.
 */
async function clearIndexedRepo(repoUrl) {
  try {
    const client = getChromaClient();
    // Retrieve collection. If it doesn't exist, we skip deletion.
    const collections = await client.listCollections();
    const exists = collections.some((c) => c.name === "repo_chunks");
    
    if (exists) {
      const collection = await client.getCollection({ name: "repo_chunks" });
      await collection.delete({ where: { repo_url: repoUrl } });
    }
  } catch (error) {
    console.error(`Error clearing collection: ${error.message}`);
    throw error;
  }
}

/**
 * Generates embeddings using OpenAI and inserts chunks in ChromaDB.
 */
async function indexDocuments(documents, repoUrl) {
  // 1. Clean existing records for this repo
  await clearIndexedRepo(repoUrl);
  
  if (!documents || documents.length === 0) return;
  
  const openai = getOpenAIClient();
  const chroma = getChromaClient();
  
  const collection = await chroma.getOrCreateCollection({ name: "repo_chunks" });
  
  // 2. Process documents in batches of 100 to stay under rate limits
  const batchSize = 100;
  
  for (let i = 0; i < documents.length; i += batchSize) {
    const batch = documents.slice(i, i + batchSize);
    
    const contents = batch.map((d) => d.page_content);
    
    // Generate embeddings for the batch
    let embeddingRes;
    try {
      embeddingRes = await openai.embeddings.create({
        model: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
        input: contents
      });
    } catch (e) {
      throw new Error(`OpenAI Embedding API error: ${e.message}`);
    }
    
    const embeddings = embeddingRes.data.map((item) => item.embedding);
    
    // Chroma expects ids, documents, metadatas, and embeddings
    const ids = batch.map((_, idx) => `${repoUrl}_chunk_${i + idx}_${Date.now()}`);
    const metadatas = batch.map((d) => d.metadata);
    
    try {
      await collection.add({
        ids,
        embeddings,
        metadatas,
        documents: contents
      });
    } catch (e) {
      throw new Error(`ChromaDB indexing error: ${e.message}`);
    }
  }
}

module.exports = {
  clearIndexedRepo,
  indexDocuments
};
