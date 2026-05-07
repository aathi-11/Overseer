// ─── Requirements Agent ───────────────────────────────────────────────────────
// Runs a 3-step requirements workflow: Analyze Needs → Draft User Stories →
// Finalize Requirements. Each step builds on the previous via memory context.
// ──────────────────────────────────────────────────────────────────────────────

const { callOllamaChat } = require("./ollamaClient");
const { delay } = require("../utils/delay");
const { REQ_SYSTEM } = require("../config/prompts");

const REQ_STEPS = ["Analyze Needs", "Draft User Stories", "Finalize Requirements"];

// Step-specific instructions so each step has a clear, focused output
const STEP_INSTRUCTIONS = {
  "Analyze Needs": (input) =>
    `Step: Analyze Needs.\n` +
    `Request: "${input}"\n` +
    `Identify: 1) Core problem being solved, 2) Target users, 3) Key features needed (list up to 5), ` +
    `4) Any constraints or scope limits. Be concise — max 150 words.`,

  "Draft User Stories": (input) =>
    `Step: Draft User Stories.\n` +
    `Write 4-6 user stories for: "${input}"\n` +
    `Format each as: "As a [user], I want to [action] so that [benefit]."\n` +
    `Include stories for: core feature, data input/output, error handling, and UX feedback. ` +
    `Max 180 words.`,

  "Finalize Requirements": (input) =>
    `Step: Finalize Requirements.\n` +
    `Produce a concise specification for: "${input}"\n` +
    `Include:\n` +
    `- Functional requirements (numbered list, 4-6 items)\n` +
    `- Non-functional requirements (2-3 items: performance, usability, compatibility)\n` +
    `- Acceptance criteria for the 2 most important features (Given/When/Then format)\n` +
    `Max 200 words.`,
};

function buildMessages(memory, input, step) {
  const safeMemory = Array.isArray(memory) ? memory : [];
  const messages = [{ role: "system", content: REQ_SYSTEM }];

  // Include prior conversation for context continuity
  if (safeMemory.length) {
    messages.push(...safeMemory);
  }

  if (!safeMemory.length || safeMemory[safeMemory.length - 1].role !== "user") {
    messages.push({ role: "user", content: input });
  }

  // Use the focused step instruction instead of a generic "Step: X" prompt
  const stepInstruction = STEP_INSTRUCTIONS[step];
  messages.push({
    role: "user",
    content: stepInstruction ? stepInstruction(input) : `Step: ${step}. Respond in <= 150 words.`,
  });

  return messages;
}

async function runRequirementsWorkflow({ input, memory, onStep }) {
  const results = [];

  for (const step of REQ_STEPS) {
    const response = await callOllamaChat({
      messages: buildMessages(memory, input, step),
      temperature: 0.2,     // Slightly lower — requirements should be precise
      numPredict: 800,      // Increased from 600 for richer outputs
    });

    const output = { title: step, content: response };
    results.push(output);

    if (onStep) {
      await onStep(output);
    }

    await delay(200);
  }

  return results;
}

module.exports = {
  runRequirementsWorkflow,
};
