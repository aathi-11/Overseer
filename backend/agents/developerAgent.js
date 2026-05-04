const { callOllamaChat } = require("./ollamaClient");
const { delay } = require("../utils/delay");

const DEV_SYSTEM =
  "You are the Developer Agent in a lightweight SDLC. " +
  "Write concise, practical guidance for the requested step. " +
  "Limit to 150 words. Use plain text, no markdown.";

const DEV_SYSTEM_IMPLEMENT =
  "You are the Developer Agent. For the Implement step, output a complete single-file HTML application only. " +
  "The output must be a valid HTML document beginning with <!DOCTYPE html> and ending with </html>. " +
  "Do NOT include any markdown, explanation, or commentary — return raw HTML only.";

const DEV_STEPS = ["System Design", "Implement", "Code Review"];

function buildMessages(memory, input, step) {
  const safeMemory = Array.isArray(memory) ? memory : [];
  const systemContent = /implement/i.test(step) ? DEV_SYSTEM_IMPLEMENT : DEV_SYSTEM;
  const messages = [{ role: "system", content: systemContent }, ...safeMemory];

  if (!safeMemory.length || safeMemory[safeMemory.length - 1].role !== "user") {
    messages.push({ role: "user", content: input });
  }

  if (/implement/i.test(step)) {
    messages.push({
      role: "user",
      content: `Step: ${step}. Output the full complete code without truncating.`,
    });
  } else {
    messages.push({
      role: "user",
      content: `Step: ${step}. Respond in <= 150 words.`,
    });
  }

  return messages;
}

async function runDeveloperWorkflow({ input, memory, onStep }) {
  const results = [];

  for (const step of DEV_STEPS) {
    const response = await callOllamaChat({
      messages: buildMessages(memory, input, step),
      temperature: 0.25,
      numPredict: /implement/i.test(step) ? 1500 : 260,
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
  runDeveloperWorkflow,
};
