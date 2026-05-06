const { callOllamaChat } = require("./ollamaClient");
const { delay } = require("../utils/delay");
const { TEST_SYSTEM } = require("../config/prompts");

const TEST_STEPS = [
  "Understand Feature",
  "Write Test Cases",
  "Edge Cases",
  "Test Report",
];

function buildMessages(memory, input, step) {
  const safeMemory = Array.isArray(memory) ? memory : [];
  const messages = [{ role: "system", content: TEST_SYSTEM }, ...safeMemory];

  if (!safeMemory.length || safeMemory[safeMemory.length - 1].role !== "user") {
    messages.push({ role: "user", content: input });
  }

  messages.push({
    role: "user",
    content: `Step: ${step}. Respond in <= 150 words.`,
  });

  return messages;
}

async function runTesterWorkflow({ input, memory, onStep }) {
  const results = [];

  for (const step of TEST_STEPS) {
    const response = await callOllamaChat({
      messages: buildMessages(memory, input, step),
      temperature: 0.25,
      numPredict: 600,
    });

    const output = { title: step, content: response };
    results.push(output);

    if (onStep) {
      await onStep(output);
    }

    await delay(300);
  }

  return results;
}

module.exports = {
  runTesterWorkflow,
};
