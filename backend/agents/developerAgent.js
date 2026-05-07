// ─── Developer Agent ─────────────────────────────────────────────────────────
// Runs a 3-step SDLC workflow: System Design → Implement → Code Review.
// The Implement step is the most critical: it streams full HTML and uses
// per-step RAG context injected from workflowController.
// ──────────────────────────────────────────────────────────────────────────────

const { callOllamaChat } = require("./ollamaClient");
const { delay } = require("../utils/delay");
const { DEV_SYSTEM, DEV_SYSTEM_IMPLEMENT } = require("../config/prompts");

const DEV_STEPS = ["System Design", "Implement", "Code Review"];

/**
 * Returns targeted implementation constraints based on what the user is asking for.
 * IMPORTANT: Specific types (compound interest, EMI, BMI) must be checked
 * BEFORE the generic "calculator" catch-all.
 */
function buildImplementHints(input) {
  const lowered = String(input || "").toLowerCase();

  // ── Specific calculator types (checked first) ──────────────────────────────
  if (
    (lowered.includes("compound") && lowered.includes("interest")) ||
    lowered.includes("compound interest")
  ) {
    return (
      "Build a COMPOUND INTEREST CALCULATOR — NOT a basic arithmetic calculator. " +
      "Include: input for Principal (id='principal'), Annual Rate % (id='rate'), " +
      "Time in years (id='time'), Compounds per year (id='n', default value=12 for monthly). " +
      "A Calculate button calls calculate(). Formula: A = P * Math.pow(1 + r/n, n*t) where r=rate/100. " +
      "Display: Final Amount, Total Interest Earned (A - P). " +
      "Show a year-by-year breakdown table with Year, Balance, Interest Earned columns. " +
      "Use parseFloat() for all inputs. Validate that all inputs are positive numbers. " +
      "Style with a clean card layout, prominent result display. DO NOT build a number-pad calculator."
    );
  }

  if (
    (lowered.includes("emi") || lowered.includes("loan")) &&
    lowered.includes("calculator")
  ) {
    return (
      "Build an EMI LOAN CALCULATOR. Include inputs for Loan Amount (id='loanAmount'), " +
      "Annual Interest Rate % (id='interestRate'), Loan Tenure in months (id='tenure'). " +
      "EMI formula: EMI = P * r * Math.pow(1+r, n) / (Math.pow(1+r,n) - 1) where r = annualRate/12/100, n = months. " +
      "Display Monthly EMI, Total Payment, Total Interest. Show amortization table with Month, EMI, Principal, Interest, Balance. " +
      "DO NOT build a number-pad calculator."
    );
  }

  if (lowered.includes("bmi") || (lowered.includes("body") && lowered.includes("mass"))) {
    return (
      "Build a BMI CALCULATOR. Include inputs for Weight in kg (id='weight') and Height in cm (id='height'). " +
      "Formula: BMI = weight / Math.pow(height/100, 2). Display BMI value rounded to 1 decimal and category: " +
      "Underweight (<18.5), Normal (18.5-24.9), Overweight (25-29.9), Obese (>=30). " +
      "Show a color-coded result bar. Include an interpretation section below."
    );
  }

  if (lowered.includes("tax") && lowered.includes("calculator")) {
    return (
      "Build an INCOME TAX CALCULATOR. Include inputs for Annual Income, deductions (80C, HRA, standard deduction). " +
      "Show Old Regime vs New Regime comparison. Calculate tax slabs step by step and display total tax, effective rate, " +
      "and take-home pay. Show a breakdown table of slabs."
    );
  }

  // ── Generic arithmetic calculator (only when no specific type matched) ─────
  if (
    lowered.includes("calculator") &&
    !lowered.includes("interest") &&
    !lowered.includes("loan") &&
    !lowered.includes("emi") &&
    !lowered.includes("bmi") &&
    !lowered.includes("tax")
  ) {
    return (
      "Include display input with id='display', number buttons 0-9, operators + - * /, decimal point, C (clear), = (equals). " +
      "Implement: appendNumber(n), setOperator(op), calculateResult(), clearDisplay(). " +
      "Support multi-digit input, chained operations. Show result in display on equals. " +
      "Handle division by zero gracefully."
    );
  }

  // ── Other app types ────────────────────────────────────────────────────────
  if (lowered.includes("todo") || lowered.includes("task manager") || lowered.includes("task list")) {
    return (
      "Include input field + Add button, tasks array, render() function. " +
      "On Add: push to array, call render(). render() clears the list and re-creates li elements each with: " +
      "task text, a Complete button (toggles strikethrough), and a Delete button. " +
      "Persist tasks and completion state to localStorage. Show task count."
    );
  }

  if (lowered.includes("timer") || lowered.includes("countdown") || lowered.includes("stopwatch")) {
    return (
      "Use totalSeconds state, Start/Pause/Reset buttons, setInterval stored in a variable. " +
      "On Start: setInterval every 1000ms, decrement totalSeconds, update display as Math.floor(s/60) + ':' + String(s%60).padStart(2,'0'). " +
      "On Pause: clearInterval. On Reset: clearInterval and restore original. " +
      "If stopwatch: count UP instead of down. Show large time display."
    );
  }

  if (lowered.includes("quiz")) {
    return (
      "Store questions as JS array of objects: {question, options: [4 strings], answer}. " +
      "Track currentIndex and score. render() shows question text and 4 option buttons. " +
      "On option click: compare to answer, apply green/red highlight, increment score if correct, " +
      "then after 800ms move to next question. After last question show final score screen with percentage and Play Again button."
    );
  }

  if (lowered.includes("notes") || lowered.includes("notepad")) {
    return (
      "Use textarea + Save button + title input. Store notes as array of {title, body, timestamp}. " +
      "render() creates note cards with title, body preview, timestamp, Edit and Delete buttons. " +
      "Edit pre-fills the form. Show note count in header. Persist to localStorage."
    );
  }

  if (lowered.includes("expense") || lowered.includes("budget tracker") || lowered.includes("finance")) {
    return (
      "Use inputs for description, amount (number), and category (select: Food/Transport/Shopping/Bills/Other). " +
      "Add button pushes to expenses array and calls render(). " +
      "render() builds a table of entries with date, description, category, amount, delete button. " +
      "Show total amount and per-category breakdown. Persist to localStorage."
    );
  }

  if (lowered.includes("weather")) {
    return (
      "Use mock weather data as a JS object keyed by city name (at least 5 cities). " +
      "Each city has: temp (Celsius), condition, humidity %, windSpeed km/h, feelsLike, 5-day forecast array. " +
      "Include city search input, display weather card with large temp, emoji icon, condition. " +
      "Show 5-day forecast row. Apply background gradient based on condition (sunny/cloudy/rainy)."
    );
  }

  if (lowered.includes("portfolio")) {
    return (
      "Build a professional single-page portfolio. Sections: nav (fixed, smooth-scroll links), " +
      "hero (name, title, CTA button), about (bio + photo placeholder), " +
      "skills (CSS animated progress bars), projects (card grid with title/description/tags/links), " +
      "contact (form with Name/Email/Message). Use CSS variables for colors. " +
      "Add scroll-based fade-in animation using IntersectionObserver."
    );
  }

  if (lowered.includes("chat") || lowered.includes("messaging")) {
    return (
      "Build a chat UI with messages array, input + Send button. " +
      "render() creates message bubbles (right-aligned for user, left for bot). " +
      "Bot responses cycle through a set of mock replies with 500ms delay. " +
      "Show timestamp on each message, auto-scroll to latest, support Enter key to send."
    );
  }

  if (lowered.includes("game") || lowered.includes("tic tac toe") || lowered.includes("snake")) {
    if (lowered.includes("tic tac") || lowered.includes("tictac")) {
      return (
        "Build Tic-Tac-Toe. Use a 3x3 grid of buttons, board array of 9 nulls, currentPlayer (X/O). " +
        "On cell click: set board[index]=currentPlayer, re-render, check winner. " +
        "checkWinner() tests all 8 win lines. Show status above board. Reset button. Highlight winning cells."
      );
    }
    return (
      "Build Snake game using HTML canvas (id='gameCanvas', 400x400). " +
      "Snake is array of {x,y} segments. Food at random cell. Arrow key controls direction. " +
      "setInterval at 150ms moves snake, checks food collision (grow), wall/self collision (game over). " +
      "Show score. Restart on game over."
    );
  }

  return "";
}

/**
 * Extracts the latest assistant block from memory (used by Implement step
 * to carry forward the System Design output as context).
 */
function extractLatestAssistantBlock(memory, maxChars = 1500) {
  const safeMemory = Array.isArray(memory) ? memory : [];
  const block = [];

  for (let i = safeMemory.length - 1; i >= 0; i -= 1) {
    const item = safeMemory[i];
    if (!item || item.role === "user") break;
    if (item.content) block.push(String(item.content));
  }

  if (!block.length) return "";

  const merged = block.reverse().join("\n\n");
  return merged.length <= maxChars ? merged : merged.slice(0, maxChars).trim() + "...";
}

function buildMessages({ memory, input, rawInput, step }) {
  const safeMemory = Array.isArray(memory) ? memory : [];
  const isImplement = /implement/i.test(step);
  const isReview = /review/i.test(step);
  const systemContent = isImplement ? DEV_SYSTEM_IMPLEMENT : DEV_SYSTEM;
  const messages = [{ role: "system", content: systemContent }];
  const requirementsContext = isImplement ? extractLatestAssistantBlock(safeMemory) : "";

  if (!isImplement) {
    messages.push(...safeMemory);
  }

  const userInput = isImplement ? (rawInput || input) : input;
  if (!safeMemory.length || safeMemory[safeMemory.length - 1].role !== "user") {
    messages.push({ role: "user", content: userInput });
  }

  if (isImplement) {
    if (requirementsContext) {
      messages.push({
        role: "user",
        content: `System design context:\n${requirementsContext}`,
      });
    }
    const hint = buildImplementHints(userInput);
    messages.push({
      role: "user",
      content:
        `Build the complete working application for: "${userInput}". ` +
        `Output the FULL HTML file starting from <!DOCTYPE html> and ending with </html>. ` +
        `Every button must be functional. Every feature must be implemented in full. ` +
        `Do NOT truncate, abbreviate, or use ellipses. ` +
        `Do NOT add explanatory text before or after the HTML.` +
        (hint ? `\n\nIMPORTANT constraints:\n${hint}` : ""),
    });
  } else if (isReview) {
    messages.push({
      role: "user",
      content: `Step: ${step}. Review the implementation for: 1) Logic correctness, 2) Missing features, 3) UX issues. List findings concisely. Respond in <= 180 words.`,
    });
  } else {
    // System Design step
    messages.push({
      role: "user",
      content: `Step: ${step}. Plan the architecture: components, data structures, key functions needed. Respond in <= 150 words.`,
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
      temperature: isImplement ? 0.15 : 0.25,   // Lower temp = more deterministic code
      numPredict: isImplement ? 6000 : 700,       // 6k tokens for full HTML output
      stream: isImplement,
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
  runDeveloperWorkflow,
};
