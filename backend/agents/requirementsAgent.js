const { callOllamaChat } = require("./ollamaClient");
const { delay } = require("../utils/delay");

const REQ_SYSTEM =
  "Answer only if you are certain. If unsure, say 'I don't know'. Do not make up facts.\n" +
  "You are the Requirements Agent in a lightweight SDLC. " +
  "Write concise user stories and requirements for the requested feature. " +
  "Limit to 150 words. Use plain text, no markdown.";

const REQ_STEPS = ["Analyze Needs", "Draft User Stories", "Finalize Requirements"];

function buildMessages(memory, input, step) {
  const safeMemory = Array.isArray(memory) ? memory : [];
  const messages = [{ role: "system", content: REQ_SYSTEM }, ...safeMemory];

  if (!safeMemory.length || safeMemory[safeMemory.length - 1].role !== "user") {
    messages.push({ role: "user", content: input });
  }

  messages.push({
    role: "user",
    content: `Step: ${step}. Respond in <= 150 words.`,
  });

  return messages;
}

async function runRequirementsWorkflow({ input, memory, onStep }) {
  const results = [];

  for (const step of REQ_STEPS) {
    const response = await callOllamaChat({
      messages: buildMessages(memory, input, step),
      temperature: 0.25,
      numPredict: 260,
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
  runRequirementsWorkflow,
};
