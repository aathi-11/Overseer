const { callOllamaChat } = require("./ollamaClient");
const { delay } = require("../utils/delay");

const DEV_SYSTEM =
  "You are the Developer Agent in a lightweight SDLC. " +
  "Write concise, practical guidance for the requested step. " +
  "Limit to 150 words. Use plain text, no markdown.";

const DEV_SYSTEM_IMPLEMENT =
  "You are the Developer Agent. Output a complete, working, single-file HTML application. " +
  "Rules you must follow strictly:\n" +
  "- Start with <!DOCTYPE html> and end with </html>. No exceptions.\n" +
  "- All JavaScript must be inside a <script> tag at the bottom of <body>.\n" +
  "- For calculators: use a display <div id='display'>0</div>, store current input in a JS variable, " +
  "wire every button with onclick. Operations must actually compute using eval() or manual logic.\n" +
  "- For todo/task apps: use an <input> + Add button, store items in a JS array, re-render a <ul> on every change. " +
  "Delete buttons must splice the array and re-render.\n" +
  "- For timers/countdowns: use setInterval/clearInterval, display minutes:seconds formatted with padStart.\n" +
  "- For quiz apps: store questions in a JS array of objects with question/options/answer, track score, show result at end.\n" +
  "- For notes apps: use a <textarea> + Save button, store notes in an array, render them as cards below.\n" +
  "- Aesthetics are CRITICAL: You must write beautiful, premium, modern CSS inside a <style> tag. Use sleek color palettes, smooth gradients, soft shadows, rounded corners, interactive hover effects, and modern typography (like system-ui or Inter). NEVER output a plain, basic, or ugly design, even if the user's prompt is very simple.\n" +
  "- Do NOT use React, Vue, Angular, or any external library or CDN.\n" +
  "- Do NOT include markdown, explanation, or commentary. Return raw HTML only.\n" +
  "- Do NOT truncate or cut off the output. The closing </html> tag must always be present.";

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
      content: `Step: ${step}. Build the complete working application for: "${input}". ` +
        `Output the full HTML file from <!DOCTYPE html> to </html>. ` +
        `Make sure all buttons are functional and all logic actually works. Do not stop early.`,
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
      numPredict: /implement/i.test(step) ? 2500 : 260,
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
