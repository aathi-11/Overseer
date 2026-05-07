// ─── Tester Agent ─────────────────────────────────────────────────────────────
// Runs a 4-step testing workflow: Understand Feature → Write Test Cases →
// Edge Cases → Test Report. Each step has a targeted, structured prompt.
// ──────────────────────────────────────────────────────────────────────────────

const { callOllamaChat } = require("./ollamaClient");
const { delay } = require("../utils/delay");
const { TEST_SYSTEM } = require("../config/prompts");

const TEST_STEPS = [
  "Understand Feature",
  "Write Test Cases",
  "Edge Cases",
  "Test Report",
];

// Step-specific instructions for focused, actionable outputs
const STEP_INSTRUCTIONS = {
  "Understand Feature": (input) =>
    `Step: Understand Feature.\n` +
    `Feature to test: "${input}"\n` +
    `Summarize: 1) What the feature does, 2) Key inputs and outputs, ` +
    `3) Core behaviour to verify, 4) Potential failure points. Max 150 words.`,

  "Write Test Cases": (input) =>
    `Step: Write Test Cases.\n` +
    `Write 5-7 test cases for: "${input}"\n` +
    `Format each as:\n` +
    `TC-N | Input | Expected Output | Pass/Fail Criteria\n` +
    `Cover: happy path (2-3 cases), invalid input (1-2 cases), boundary values (1-2 cases). Max 200 words.`,

  "Edge Cases": (input) =>
    `Step: Edge Cases.\n` +
    `List 4-6 edge case scenarios for: "${input}"\n` +
    `For each edge case specify: scenario description + expected safe behaviour. ` +
    `Focus on: empty/null inputs, extreme values, rapid repeated actions, state after reset. Max 180 words.`,

  "Test Report": (input) =>
    `Step: Test Report.\n` +
    `Write a concise QA report for: "${input}"\n` +
    `Include:\n` +
    `- Summary: total test cases, expected pass rate\n` +
    `- Risk areas: top 2-3 areas most likely to fail\n` +
    `- Recommendations: 2-3 actionable improvements for robustness\n` +
    `- Overall quality verdict (Good / Needs Work / Critical Issues)\n` +
    `Max 180 words.`,
};

function buildMessages(memory, input, step) {
  const safeMemory = Array.isArray(memory) ? memory : [];
  const messages = [{ role: "system", content: TEST_SYSTEM }];

  // Include prior memory for context (e.g., carrying forward test cases into edge cases)
  if (safeMemory.length) {
    messages.push(...safeMemory);
  }

  if (!safeMemory.length || safeMemory[safeMemory.length - 1].role !== "user") {
    messages.push({ role: "user", content: input });
  }

  const stepInstruction = STEP_INSTRUCTIONS[step];
  messages.push({
    role: "user",
    content: stepInstruction ? stepInstruction(input) : `Step: ${step}. Respond in <= 150 words.`,
  });

  return messages;
}

async function runTesterWorkflow({ input, memory, onStep }) {
  const results = [];

  for (const step of TEST_STEPS) {
    const response = await callOllamaChat({
      messages: buildMessages(memory, input, step),
      temperature: 0.2,     // Low temp — test cases should be deterministic and specific
      numPredict: 800,      // Enough for structured test case output
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
  runTesterWorkflow,
};
