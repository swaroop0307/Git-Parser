const express = require('express');
const { answerQuestion, answerQuestionStream } = require('../services/ragPipeline');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// POST /api/chat/query (Non-streaming fallback)
router.post('/query', authenticateToken, async (req, res) => {
  try {
    const { question } = req.body;
    if (!question || typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({ error: 'Question string parameter is required' });
    }

    console.log(`[RAG Query] User ${req.user.email}: "${question}"`);
    const result = await answerQuestion(question.trim());

    res.json({
      question: question.trim(),
      answer: result.answer,
      sources: result.sources,
    });
  } catch (error) {
    console.error('RAG Query Error:', error);
    res.status(500).json({ error: error.message || 'Error executing RAG pipeline' });
  }
});

// POST /api/chat/stream (SSE real-time streaming endpoint)
router.post('/stream', authenticateToken, async (req, res) => {
  const { question } = req.body;
  if (!question || typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'Question string parameter is required' });
  }

  // Set SSE Headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  console.log(`[RAG SSE Stream] User ${req.user.email}: "${question}"`);

  try {
    await answerQuestionStream(
      question.trim(),
      (token) => {
        res.write(`data: ${JSON.stringify({ type: 'token', token })}\n\n`);
      },
      (sources) => {
        res.write(`data: ${JSON.stringify({ type: 'sources', sources })}\n\n`);
      }
    );

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (error) {
    console.error('RAG Streaming Error:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
    res.end();
  }
});

module.exports = router;
