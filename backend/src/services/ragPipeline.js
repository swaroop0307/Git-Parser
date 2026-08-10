const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');
const { OpenAI } = require('openai');
const { queryVectorStore, getActiveLlmProvider } = require('./vectorStore');
require('dotenv').config();

function buildPrompt(question, retrievedSources) {
  const contextList = retrievedSources
    .map((s, i) => `[Source ${i + 1}] (File: "${s.source}", Page: ${s.page})\n${s.text}`)
    .join('\n\n---\n\n');

  return `You are an intelligent Document Q&A Assistant.
Use the provided document context below to answer the user's question.
If the document contains assignment questions or problems, you are allowed to use your own knowledge to solve or answer them based on the text provided.
For every point that directly references the text, cite the source document (e.g. [Source: report.pdf, Page 3]).
IMPORTANT: DO NOT use any Markdown formatting in your response. Output STRICTLY plain text without characters like **, ##, *, or _.

Context:
${contextList}

Question: ${question}

Answer:`;
}

/**
 * Generate answer using Google Gemini API
 */
async function generateGeminiAnswer(prompt) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY.trim());
  const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });
  const result = await model.generateContent(prompt);
  const response = await result.response;
  return response.text().trim();
}

/**
 * Stream answer using Google Gemini API
 */
async function streamGeminiAnswer(prompt, onChunk) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY.trim());
  const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });
  const result = await model.generateContentStream(prompt);
  
  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) {
      onChunk(text);
    }
  }
}

/**
 * Generate answer using Groq API (Free Llama 3)
 */
async function generateGroqAnswer(prompt) {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY.trim() });
  const completion = await groq.chat.completions.create({
    messages: [
      { role: 'system', content: 'You are a professional RAG assistant. Give concise, accurate answers strictly grounded in context with precise citations.' },
      { role: 'user', content: prompt }
    ],
    model: 'llama-3.1-8b-instant',
    temperature: 0.1,
  });
  return completion.choices[0]?.message?.content || '';
}

/**
 * Stream answer using Groq API (Free Llama 3)
 */
async function streamGroqAnswer(prompt, onChunk) {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY.trim() });
  const stream = await groq.chat.completions.create({
    messages: [
      { role: 'system', content: 'You are a professional RAG assistant. Give concise, accurate answers strictly grounded in context with precise citations.' },
      { role: 'user', content: prompt }
    ],
    model: 'llama-3.1-8b-instant',
    temperature: 0.1,
    stream: true,
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || '';
    if (content) {
      onChunk(content);
    }
  }
}

/**
 * Perform RAG Q&A flow
 */
async function answerQuestion(question, topK = 5) {
  const retrieved = await queryVectorStore(question, topK);
  
  if (!retrieved || retrieved.length === 0) {
    return {
      answer: "No relevant document chunks found in the database. Please upload relevant PDFs first.",
      sources: []
    };
  }

  const sources = retrieved.map(r => ({
    source: r.source,
    page: r.page,
    score: r.score ? parseFloat(r.score.toFixed(4)) : null,
    snippet: r.text.length > 250 ? r.text.slice(0, 250) + '...' : r.text,
    fullText: r.text
  }));

  const provider = getActiveLlmProvider();

  if (provider === 'none') {
    return {
      answer: `⚠️ **API Key Missing**: Please set a free \`GEMINI_API_KEY\` or \`GROQ_API_KEY\` in \`backend/.env\` to enable AI generation.`,
      sources
    };
  }

  try {
    const prompt = buildPrompt(question, retrieved);
    
    if (provider === 'gemini') {
      const answer = await generateGeminiAnswer(prompt);
      return { answer, sources };
    }

    if (provider === 'groq') {
      const answer = await generateGroqAnswer(prompt);
      return { answer, sources };
    }

    if (provider === 'openai') {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a professional RAG assistant. Give concise, accurate answers strictly grounded in context with precise citations.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
      });
      const answer = completion.choices[0].message.content.trim();
      return { answer, sources };
    }
  } catch (err) {
    console.error(`[RAG Pipeline] ${provider.toUpperCase()} API Error:`, err.message);
    return {
      answer: `⚠️ **${provider.toUpperCase()} API Error**: ${err.message}\n\nPlease verify your key in \`backend/.env\`.`,
      sources
    };
  }
}

/**
 * Perform streaming RAG Q&A flow
 */
async function answerQuestionStream(question, onChunk, onSources, topK = 5) {
  const retrieved = await queryVectorStore(question, topK);

  if (!retrieved || retrieved.length === 0) {
    onSources([]);
    onChunk("No relevant document chunks found in the database. Please upload relevant PDFs first.");
    return;
  }

  const sources = retrieved.map(r => ({
    source: r.source,
    page: r.page,
    score: r.score ? parseFloat(r.score.toFixed(4)) : null,
    snippet: r.text.length > 250 ? r.text.slice(0, 250) + '...' : r.text,
    fullText: r.text
  }));

  onSources(sources);
  const provider = getActiveLlmProvider();

  if (provider === 'none') {
    const msg = `⚠️ **API Key Missing**: Please set a free \`GEMINI_API_KEY\` or \`GROQ_API_KEY\` in \`backend/.env\` to enable AI generation.`;
    for (const char of msg) {
      onChunk(char);
      await new Promise(r => setTimeout(r, 6));
    }
    return;
  }

  try {
    const prompt = buildPrompt(question, retrieved);

    if (provider === 'gemini') {
      await streamGeminiAnswer(prompt, onChunk);
      return;
    }

    if (provider === 'groq') {
      await streamGroqAnswer(prompt, onChunk);
      return;
    }

    if (provider === 'openai') {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const stream = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a professional RAG assistant. Give concise, accurate answers strictly grounded in context with precise citations.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        stream: true,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          onChunk(content);
        }
      }
      return;
    }
  } catch (err) {
    console.error(`[RAG Pipeline] ${provider.toUpperCase()} API Error:`, err.message);
    onChunk(`⚠️ **${provider.toUpperCase()} API Error**: ${err.message}\n\nPlease verify your key in \`backend/.env\`.`);
  }
}

module.exports = {
  answerQuestion,
  answerQuestionStream
};
