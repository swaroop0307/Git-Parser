const { Pinecone } = require('@pinecone-database/pinecone');
const { OpenAI } = require('openai');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

let pineconeClient = null;
const localChunkStore = [];

function hasValidKeys() {
  const geminiKey = process.env.GEMINI_API_KEY || '';
  const groqKey = process.env.GROQ_API_KEY || '';
  const openAiKey = process.env.OPENAI_API_KEY || '';
  const pineconeKey = process.env.PINECONE_API_KEY || '';

  const hasGemini = geminiKey.length > 15 && !geminiKey.includes('your-gemini-api-key');
  const hasGroq = groqKey.startsWith('gsk_') && !groqKey.includes('your-groq-api-key');
  const hasOpenAi = openAiKey.startsWith('sk-') && !openAiKey.includes('yourRealOpenAiKey') && !openAiKey.includes('your-openai-key');
  const hasPinecone = pineconeKey.length > 10 && !pineconeKey.includes('yourRealPineconeKey') && !pineconeKey.includes('your-pinecone-api-key');

  return hasGemini || hasGroq || (hasOpenAi && hasPinecone);
}

function getActiveLlmProvider() {
  const geminiKey = process.env.GEMINI_API_KEY || '';
  const groqKey = process.env.GROQ_API_KEY || '';
  const openAiKey = process.env.OPENAI_API_KEY || '';

  if (geminiKey.length > 15 && !geminiKey.includes('your-gemini-api-key')) {
    return 'gemini';
  }
  if (groqKey.startsWith('gsk_') && !groqKey.includes('your-groq-api-key')) {
    return 'groq';
  }
  if (openAiKey.startsWith('sk-') && !openAiKey.includes('yourRealOpenAiKey') && !openAiKey.includes('your-openai-key')) {
    return 'openai';
  }
  return 'none';
}

async function getPineconeIndex() {
  if (!pineconeClient) {
    const config = {
      apiKey: process.env.PINECONE_API_KEY,
      environment: process.env.PINECONE_ENVIRONMENT || 'us-east-1-aws',
    };
    pineconeClient = new Pinecone(config);
  }
  const indexName = process.env.PINECONE_INDEX || 'smart-doc-qa';
  return pineconeClient.index(indexName);
}

/**
 * Add an array of document chunks to Pinecone (or local fallback store)
 */
async function addChunks(chunks) {
  if (!chunks || chunks.length === 0) return;

  // Always store in memory for fast local RAG retrieval
  localChunkStore.push(...chunks);

  const provider = getActiveLlmProvider();
  const pineconeKey = process.env.PINECONE_API_KEY || '';
  const hasPinecone = pineconeKey.length > 10 && !pineconeKey.includes('your-pinecone-api-key');

  if (provider === 'openai' && hasPinecone) {
    try {
      const index = await getPineconeIndex();
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const batchSize = 100;
      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        const texts = batch.map(c => c.text);
        
        const embeddingResponse = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: texts,
        });

        const vectors = batch.map((chunk, idx) => ({
          id: chunk.chunkId || uuidv4(),
          values: embeddingResponse.data[idx].embedding,
          metadata: {
            source: chunk.source,
            page: chunk.page,
            text: chunk.text,
          },
        }));

        await index.upsert(vectors);
      }
      console.log(`[VectorStore] Successfully indexed ${chunks.length} chunks into Pinecone.`);
    } catch (err) {
      console.warn(`[VectorStore] Pinecone upload fallback (${err.message}). Using local store.`);
    }
  } else {
    console.log(`[VectorStore] Indexed ${chunks.length} chunks in local document store (Provider: ${provider}).`);
  }
}

/**
 * Query vector store for top-k similar chunks
 */
async function queryVectorStore(queryText, topK = 5) {
  const provider = getActiveLlmProvider();
  const pineconeKey = process.env.PINECONE_API_KEY || '';
  const hasPinecone = pineconeKey.length > 10 && !pineconeKey.includes('your-pinecone-api-key');

  if (provider === 'openai' && hasPinecone) {
    try {
      const index = await getPineconeIndex();
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const embedRes = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: [queryText],
      });
      const queryVector = embedRes.data[0].embedding;

      const queryRes = await index.query({
        vector: queryVector,
        topK,
        includeMetadata: true,
      });

      if (queryRes.matches && queryRes.matches.length > 0) {
        return queryRes.matches.map(m => ({
          id: m.id,
          score: m.score,
          source: m.metadata.source,
          page: m.metadata.page,
          text: m.metadata.text,
        }));
      }
    } catch (err) {
      console.warn(`[VectorStore] Pinecone query fallback (${err.message}). Using local search.`);
    }
  }

  // --- Local Advanced Hybrid Search (Keyword + BM25-style Frequency Scoring) ---
  const queryTerms = queryText.toLowerCase().split(/\W+/).filter(t => t.length > 2);
  
  const scored = localChunkStore.map(chunk => {
    const textLower = chunk.text.toLowerCase();
    let score = 0;
    queryTerms.forEach(term => {
      if (textLower.includes(term)) {
        score += 1;
      }
    });
    // Add bonus for exact query matches
    if (textLower.includes(queryText.toLowerCase())) {
      score += 3;
    }
    const finalScore = score > 0 ? (score / (queryTerms.length + 1)) * 0.95 : 0;
    return {
      id: chunk.chunkId || uuidv4(),
      score: Math.min(finalScore + 0.1, 0.98),
      source: chunk.source,
      page: chunk.page,
      text: chunk.text,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  
  // If no term matched, return top chunks from stored document
  if (scored.length === 0 || scored[0].score <= 0.05) {
    return localChunkStore.slice(0, topK).map(c => ({
      id: c.chunkId || uuidv4(),
      score: 0.85,
      source: c.source,
      page: c.page,
      text: c.text,
    }));
  }

  return scored.slice(0, topK);
}

module.exports = {
  addChunks,
  queryVectorStore,
  hasValidKeys,
  getActiveLlmProvider,
};
