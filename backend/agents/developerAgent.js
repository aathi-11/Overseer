const { callOllamaChat } = require("./ollamaClient");
const { delay } = require("../utils/delay");
const { DEV_SYSTEM, DEV_SYSTEM_IMPLEMENT } = require("../config/prompts");

const DEV_STEPS = ["System Design", "Implement", "Code Review"];

function buildImplementHints(input) {
  const lowered = String(input || "").toLowerCase();
  if (lowered.includes("calculator")) {
    return "Include display input with id 'display', number buttons, + - * /, C, =. Implement appendNumber, setOperator, calculateResult, clearDisplay. Support multi-digit input.";
  }
  if (lowered.includes("todo") || lowered.includes("task")) {
    return "Include input + Add button, tasks array, render list, delete by index, and persist to localStorage.";
  }
  if (lowered.includes("timer") || lowered.includes("countdown")) {
    return "Use totalSeconds state, Start/Pause/Reset, setInterval/clearInterval, and format mm:ss.";
  }
  if (lowered.includes("quiz")) {
    return "Use questions array with options/answer, track index + score, render choices, show final score.";
  }
  if (lowered.includes("notes")) {
    return "Use textarea + Save button, notes array, render cards with delete.";
  }
  return "";
}

function buildMessages({ memory, input, rawInput, step }) {
  const safeMemory = Array.isArray(memory) ? memory : [];
  const isImplement = /implement/i.test(step);
  const systemContent = isImplement ? DEV_SYSTEM_IMPLEMENT : DEV_SYSTEM;
  const messages = [{ role: "system", content: systemContent }];

  if (!isImplement) {
    messages.push(...safeMemory);
  }

  const userInput = isImplement ? (rawInput || input) : input;
  if (!safeMemory.length || safeMemory[safeMemory.length - 1].role !== "user") {
    messages.push({ role: "user", content: userInput });
  }

  if (isImplement) {
    const hint = buildImplementHints(userInput);
    messages.push({
      role: "user",
      content: `Build the complete working application for: "${userInput}". ` +
        `Output the full HTML file from <!DOCTYPE html> to </html>. ` +
        `Make sure all buttons are functional and all logic actually works.` +
        (hint ? `\nConstraints: ${hint}` : ""),
    });
  } else {
    messages.push({
      role: "user",
      content: `Step: ${step}. Respond in <= 150 words.`,
    });
  }

  return messages;
}

async function runDeveloperWorkflow({ input, rawInput, memory, onStep }) {
  const results = [];

  for (const step of DEV_STEPS) {
    const isImplement = /implement/i.test(step);
    const response = await callOllamaChat({
      messages: buildMessages({ memory, input, rawInput, step }),
      temperature: isImplement ? 0.2 : 0.25,
      numPredict: isImplement ? 4096 : 600,
      stream: isImplement,
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
