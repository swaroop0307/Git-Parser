require("dotenv").config();
const { ChromaClient } = require("chromadb");
const { OpenAI } = require("openai");
const path = require("path");
const fs = require("fs");

const { parseRepository } = require("../backend/parser");
const { indexDocuments } = require("../backend/indexer");

// Gold-Standard QA Evaluation Dataset
const EVAL_DATASET = [
  {
    question: "How does the system ensure git URLs are secure and prevent command injection?",
    expected_files: ["backend/security.js", "backend/server.js"],
    keywords: ["regex", "validateGithubUrl", "illegal", "characters"]
  },
  {
    question: "What is the chunking strategy and how does it calculate line numbers for chunks?",
    expected_files: ["backend/parser.js"],
    keywords: ["splitText", "calculateLineNumbers", "indexOf"]
  },
  {
    question: "How does the indexing process prevent duplicate documents when re-indexing?",
    expected_files: ["backend/indexer.js"],
    keywords: ["clearIndexedRepo", "delete", "where", "repo_url"]
  },
  {
    question: "How is the streaming of answers implemented on the server?",
    expected_files: ["backend/retriever.js", "backend/server.js"],
    keywords: ["setHeader", "retrieveAndGenerateStream", "stream", "openai"]
  }
];

const JUDGE_SYSTEM_PROMPT = (
  "You are an expert RAG Evaluation Judge.\n" +
  "You will be given a User Question, the Code Context, the generated Explanation, and a list of Keywords.\n" +
  "Your job is to rate the Explanation on a scale of 1 to 5 based on three criteria:\n" +
  "1. Faithfulness (1-5): Is the answer grounded ONLY in the context? (Reject hallucinated details)\n" +
  "2. Completeness (1-5): Does the answer directly answer the user's question?\n" +
  "3. Precision (1-5): Does the answer focus on relevant files, referencing correct files and concepts?\n\n" +
  "Provide a final combined integer score (1 to 5) and a brief reasoning string.\n" +
  "You must return your output strictly in JSON format as:\n" +
  "{\n" +
  "  \"score\": <int>,\n" +
  "  \"reasoning\": \"<string>\"\n" +
  "}"
);

async function runEvaluation() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("❌ Error: OPENAI_API_KEY is not defined. Skipping evaluation.");
    return;
  }
  
  const mockRepoUrl = "https://github.com/developer/rag-explainer.git";
  const openai = new OpenAI({ apiKey });
  const host = process.env.CHROMADB_URL || "http://localhost:8000";
  const chroma = new ChromaClient({ path: host });
  
  console.log("\n🚀 Starting RAG Evaluation Suite...");
  console.log(`Indexing current workspace directory as '${mockRepoUrl}'...`);
  
  // 1. Self-Index current Node.js project directory
  const currentDir = path.resolve(path.join(__dirname, ".."));
  try {
    const documents = parseRepository(currentDir, mockRepoUrl);
    await indexDocuments(documents, mockRepoUrl);
    console.log(`Successfully indexed ${documents.length} code chunks.`);
  } catch (err) {
    console.error(`❌ Failed to parse/index local repo: ${err.message}`);
    return;
  }
  
  let collection;
  try {
    collection = await chroma.getCollection({ name: "repo_chunks" });
  } catch (err) {
    console.error("❌ Could not connect to collection repo_chunks.");
    return;
  }
  
  let retrievalHits = 0;
  let totalJudgeScore = 0;
  const evalCount = EVAL_DATASET.length;
  
  console.log("\n--- Running Queries and Grading ---");
  
  for (let i = 0; i < evalCount; i++) {
    const item = EVAL_DATASET[i];
    const { question, expected_files, keywords } = item;
    
    console.log(`\n[Test ${i + 1}/${evalCount}] Q: "${question}"`);
    
    // A. Embed the Query
    let embedRes;
    try {
      embedRes = await openai.embeddings.create({
        model: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
        input: [question]
      });
    } catch (err) {
      console.error(`❌ Query embedding failed: ${err.message}`);
      continue;
    }
    const queryEmbedding = embedRes.data[0].embedding;
    
    // B. Search Vector DB
    let queryRes;
    try {
      queryRes = await collection.query({
        queryEmbeddings: [queryEmbedding],
        nResults: 5,
        where: { repo_url: mockRepoUrl }
      });
    } catch (err) {
      console.error(`❌ Vector search query failed: ${err.message}`);
      continue;
    }
    
    const docs = queryRes.documents[0] || [];
    const metas = queryRes.metadatas[0] || [];
    const filePaths = metas.map(m => m.file_path || "");
    
    // Evaluate Retrieval Hit Rate
    const hit = expected_files.some(exp => filePaths.some(p => p.includes(exp)));
    if (hit) {
      retrievalHits += 1;
      console.log(`✅ Retrieval HIT. Found expected files in: ${filePaths.slice(0, 2).join(", ")}...`);
    } else {
      console.log(`❌ Retrieval MISS. Retrieved file paths: ${filePaths.join(", ")}`);
    }
    
    // C. Generate Answer (Without streaming for evaluation ease)
    let contextStr = "";
    for (let dIdx = 0; dIdx < docs.length; dIdx++) {
      const meta = metas[dIdx] || {};
      contextStr += `--- SOURCE FILE: ${meta.file_path || "unknown"} (Lines ${meta.start_line || 1}-${meta.end_line || 1}) ---\n${docs[dIdx]}\n\n`;
    }
    
    const systemPrompt = (
      "You are a Senior AI Software Architect analyzing a code repository.\n" +
      "Your task is to answer the user's question about the codebase using ONLY the provided code chunks.\n" +
      "Refer directly to file paths and line ranges. Do not assume or hallucinate details outside context."
    );
    const humanPrompt = `Code Context:\n${contextStr}\n\nUser Question: ${question}`;
    
    let answer = "";
    try {
      const chatRes = await openai.chat.completions.create({
        model: process.env.LLM_MODEL || "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: humanPrompt }
        ],
        temperature: 0.1
      });
      answer = chatRes.choices[0].message.content;
    } catch (err) {
      console.error(`❌ Answer generation failed: ${err.message}`);
      continue;
    }
    
    // D. Grade via LLM-as-a-Judge
    const judgePrompt = (
      `User Question: ${question}\n\n` +
      `Code Context:\n{contextStr}\n\n` +
      `Explanation:\n${answer}\n\n` +
      `Expected Keywords: ${keywords.join(", ")}`
    );
    
    try {
      const judgeRes = await openai.chat.completions.create({
        model: process.env.LLM_MODEL || "gpt-4o-mini",
        messages: [
          { role: "system", content: JUDGE_SYSTEM_PROMPT },
          { role: "user", content: judgePrompt }
        ],
        temperature: 0.0,
        response_format: { type: "json_object" }
      });
      
      const grade = JSON.parse(judgeRes.choices[0].message.content);
      const score = parseInt(grade.score || 1);
      const reasoning = grade.reasoning || "";
      
      totalJudgeScore += score;
      console.log(`⚖️ LLM-as-a-Judge Score: ${score}/5`);
      console.log(`   Reasoning: ${reasoning}`);
    } catch (err) {
      console.error(`❌ Judge grading request failed: ${err.message}`);
    }
  }
  
  // E. Print Summary
  const hitRate = (retrievalHits / evalCount) * 100;
  const avgScore = totalJudgeScore / evalCount;
  
  console.log("\n================ EVALUATION SUMMARY ================");
  console.log(`Total Test Cases Evaluated: ${evalCount}`);
  console.log(`Retrieval Hit Rate @ 5:     {hitRate.toFixed(1)}%`);
  console.log(`Average Judge Score (1-5):  {avgScore.toFixed(2)} / 5.0`);
  console.log("====================================================");
}

runEvaluation();
