require('dotenv').config();
const { answerQuestion } = require('./src/services/ragPipeline');

async function test() {
  const result = await answerQuestion("3rd Question Answer");
  console.log(result.answer);
}

test();
