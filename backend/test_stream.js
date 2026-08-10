const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

async function testStream() {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY.trim());
    const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });
    const result = await model.generateContentStream("Hello");
    
    for await (const chunk of result.stream) {
      console.log("Chunk:", chunk.text());
    }
  } catch (err) {
    console.error("Test Error:", err);
  }
}
testStream();
