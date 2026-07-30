const { ChromaClient } = require("chromadb");
const { OpenAI } = require("openai");

/**
 * Handles the RAG search, constructs the prompt, and writes Server-Sent Events (SSE)
 * tokens directly to the Express response stream.
 * @param {string} repoUrl - Normalized repository URL.
 * @param {string} question - Query text.
 * @param {object} res - Express response object.
 */
async function retrieveAndGenerateStream(repoUrl, question, res) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.write(`data: ${JSON.stringify({ event: "error", data: "OPENAI_API_KEY is not configured on the backend." })}\n\n`);
    res.write(`data: ${JSON.stringify({ event: "done" })}\n\n`);
    res.end();
    return;
  }
  
  const openai = new OpenAI({ apiKey });
  const host = process.env.CHROMADB_URL || "http://localhost:8000";
  const chroma = new ChromaClient({ path: host });
  
  let collection;
  try {
    collection = await chroma.getCollection({ name: "repo_chunks" });
  } catch (err) {
    res.write(`data: ${JSON.stringify({ event: "token", data: "No indexed repositories found. Please index the repository first." })}\n\n`);
    res.write(`data: ${JSON.stringify({ event: "done" })}\n\n`);
    res.end();
    return;
  }
  
  // 1. Generate query embedding
  let embeddingRes;
  try {
    embeddingRes = await openai.embeddings.create({
      model: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
      input: [question]
    });
  } catch (err) {
    res.write(`data: ${JSON.stringify({ event: "error", data: `Failed to embed query: ${err.message}` })}\n\n`);
    res.write(`data: ${JSON.stringify({ event: "done" })}\n\n`);
    res.end();
    return;
  }
  
  const queryEmbedding = embeddingRes.data[0].embedding;
  
  // 2. Fetch similarity search with metadata repo_url filtering
  let searchRes;
  try {
    searchRes = await collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: 5,
      where: { repo_url: repoUrl }
    });
  } catch (err) {
    res.write(`data: ${JSON.stringify({ event: "error", data: `Chroma query failed: ${err.message}` })}\n\n`);
    res.write(`data: ${JSON.stringify({ event: "done" })}\n\n`);
    res.end();
    return;
  }
  
  // Unpack search results
  const docs = searchRes.documents[0] || [];
  const metas = searchRes.metadatas[0] || [];
  
  // Format source metadata lists to send to the client first
  const sources = docs.map((doc, idx) => {
    const meta = metas[idx] || {};
    return {
      file_path: meta.file_path || "unknown",
      filename: meta.filename || "unknown",
      start_line: meta.start_line || 1,
      end_line: meta.end_line || 1,
      code_snippet: doc,
      language: meta.language || "text"
    };
  });
  
  // Send sources immediately to the client
  res.write(`data: ${JSON.stringify({ event: "sources", data: sources })}\n\n`);
  
  if (docs.length === 0) {
    res.write(`data: ${JSON.stringify({ event: "token", data: "No relevant code segments matching this repository were found. Please verify the URL and ensure it has been indexed." })}\n\n`);
    res.write(`data: ${JSON.stringify({ event: "done" })}\n\n`);
    res.end();
    return;
  }
  
  // 3. Prepare Chat Prompt with sources grounding
  let contextStr = "";
  for (let i = 0; i < docs.length; i++) {
    const meta = metas[i] || {};
    contextStr += `--- SOURCE FILE: ${meta.file_path || "unknown"} (Lines ${meta.start_line || 1}-${meta.end_line || 1}) ---\n${docs[i]}\n\n`;
  }
  
  const systemPrompt = (
    "You are a Senior AI Software Architect analyzing a code repository.\n" +
    "Your task is to answer the user's question about the codebase using ONLY the provided code chunks.\n" +
    "Please follow these guidelines strictly:\n" +
    "1. Direct Reference: Reference specific file paths and line numbers/contexts when explaining.\n" +
    "2. Strict Grounding: Rely ONLY on the provided code context. Do not invent details or assume code exists outside the context.\n" +
    "3. Clear Structure: Explain the architecture, design patterns, and logic clearly using markdown. Use syntax highlighting in code blocks.\n" +
    "4. Gaps/Limitations: If the provided code chunks do not contain enough information to answer the question, state that clearly and identify what parts are missing."
  );
  
  const humanPrompt = `Code Context:\n${contextStr}\n\nUser Question: ${question}`;
  
  // 4. Stream LLM tokens
  try {
    const stream = await openai.chat.completions.create({
      model: process.env.LLM_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: humanPrompt }
      ],
      temperature: 0.1, // Highly grounded factual temperature
      stream: true
    });
    
    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content || "";
      if (token) {
        res.write(`data: ${JSON.stringify({ event: "token", data: token })}\n\n`);
      }
    }
  } catch (err) {
    res.write(`data: ${JSON.stringify({ event: "error", data: `LLM streaming error: ${err.message}` })}\n\n`);
  }
  
  // Close connection cleanly
  res.write(`data: ${JSON.stringify({ event: "done" })}\n\n`);
  res.end();
}

module.exports = {
  retrieveAndGenerateStream
};
