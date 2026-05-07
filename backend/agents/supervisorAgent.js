// ─── Supervisor Agent ─────────────────────────────────────────────────────────
// Two modes:
//   1. INTERACTIVE (default): When user wants to build something, the supervisor
//      asks targeted requirements questions first, then builds on the next turn.
//   2. AUTO mode: If user says "auto", "just do it", etc., the full pipeline
//      runs autonomously without asking the user anything.
// ──────────────────────────────────────────────────────────────────────────────

const { callOllamaChat } = require("./ollamaClient");
const { SUPERVISOR_SYSTEM } = require("../config/prompts");

const VALID_ROUTES = new Set(["requirements", "developer", "tester", "both", "clarify", "gather", "refine", "document", "qa"]);

const DOC_KEYWORDS = /\b(report|document|analyse|analyze|summarize|review (the|my|this)|generate (a |the )?report|test results|findings)\b/i;

// Detect question intent for uploaded document Q&A
const QA_KEYWORDS = /\b(what|why|how|when|where|who|explain|tell me|summarize|list|describe|does|did|is there|are there|show me|find)\b/i;

// ── Refinement intent detection ───────────────────────────────────────────────
// Matches user follow-up instructions to patch an existing generated app.
const REFINE_PATTERNS = [
  /\bmake (the |it |them |all )?\w+/i,               // "make the button red"
  /\bchange (the |a )?\w+/i,                          // "change the background"
  /\badd (a |an |the )?\w+/i,                         // "add a dark mode"
  /\bremove (the |a )?\w+/i,                          // "remove the footer"
  /\bfix (the |a )?\w+/i,                             // "fix the layout"
  /\bupdate (the |a )?\w+/i,                          // "update the title"
  /\b(now|also|can you) (add|make|change|fix|remove|update)\b/i,
  /\b(darker|lighter|bigger|smaller|bolder|centered|left|right|inline)\b/i,
  /\bdark mode\b/i,
  /\blight mode\b/i,
  /\bresponsive\b/i,
  /\b(font|color|colour|size|padding|margin|border|background|theme)\b/i,
  /\buse (a |the )?\w+ (color|colour|font|style|theme|background)\b/i,
  /\bmake it (look|feel|appear|be)\b/i,
  /\bstyle (it|the|a)\b/i,
];

// Signals that override refinement detection → user wants a NEW app
const NEW_BUILD_OVERRIDES = [
  /\b(build|create|generate|develop|start|make) (a |an |the )?new\b/i,
  /\bstart over\b/i,
  /\bbuild (a|an) (?!more|better|cleaner)/i,
  /\bcreate (a|an) (?!more|better|cleaner)/i,
];

/**
 * Returns true if the user's input looks like a change to an existing app.
 * Only meaningful when an existing HTML app is in state.
 */
function isRefinementRequest(input) {
  const text = String(input || "");
  // If user is clearly asking for a new build, don't refine
  if (NEW_BUILD_OVERRIDES.some((p) => p.test(text))) return false;
  // Otherwise check refinement patterns
  return REFINE_PATTERNS.some((p) => p.test(text));
}

// ── Auto-mode detection ────────────────────────────────────────────────────────
// If user includes any of these signals, skip requirements gathering and run fully autonomous.
const AUTO_PATTERNS = [
  /\bauto\b/i,
  /\bautonomous(ly)?\b/i,
  /\bjust (do|build|create|make|run) it\b/i,
  /\bdo it (yourself|on your own|automatically)\b/i,
  /\byou decide\b/i,
  /\bno (questions|clarification|requirements)\b/i,
  /\bskip (requirements|questions|asking)\b/i,
  /\bfull(y)? auto(matic(ally)?)?\b/i,
  /\bjust go\b/i,
  /\bgo ahead\b/i,
];

function isAutoMode(input) {
  const text = String(input || "");
  return AUTO_PATTERNS.some((pattern) => pattern.test(text));
}

// ── Vague request detection ────────────────────────────────────────────────────
function isVagueRequest(input) {
  const text = String(input || "").trim().toLowerCase();
  if (!text) return true;
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (wordCount < 3) return true;
  if (/^(hi|hello|hey|yo|sup|start|go|help|test|ok|okay|sure|yes|no)$/i.test(text)) return true;
  if (/\b(build|make|create|do|design)\s+something\b/i.test(text)) return true;
  return false;
}

// ── Check if the previous supervisor turn asked a requirements question ─────────
// If memory contains a "Supervisor Question" and the latest user reply looks like
// an answer (not a new build command), we should proceed to build.
function wasAskedForRequirements(memory) {
  const safeMemory = Array.isArray(memory) ? memory : [];
  // Check last 4 messages for a supervisor requirements question.
  // Only the "Supervisor Question:" prefix is needed — the second keyword
  // filter was fragile and caused false negatives.
  const recent = safeMemory.slice(-4);
  return recent.some(
    (m) =>
      m.role === "assistant" &&
      /Supervisor Question:/i.test(m.content)
  );
}

// ── Build keywords ─────────────────────────────────────────────────────────────
const BUILD_KEYWORDS = /\b(build|create|make|generate|write|develop|implement|code|program|design)\b/i;
const TEST_KEYWORDS = /\b(test|spec|qa|bug|edge case|verify|unit test|test case|write tests?)\b/i;
const REQ_KEYWORDS = /\b(requirement|user stor|gather|document|spec|plan|what (should|does|would))\b/i;
const BOTH_KEYWORDS = /\b(requirement.{0,20}(and|then|also|with|plus).{0,20}(build|implement|code)|full.{0,15}(sdlc|pipeline|workflow))\b/i;

// ── Generate a targeted requirements question based on what user wants ─────────
function buildRequirementsQuestion(input) {
  const lowered = String(input || "").toLowerCase();

  if (lowered.includes("calculator")) {
    if (lowered.includes("compound") || lowered.includes("interest")) {
      return (
        "I'll build the compound interest calculator. A few quick questions:\n" +
        "1. Should I include a year-by-year breakdown table?\n" +
        "2. Any preferred color theme (dark/light/specific color)?\n" +
        "3. Do you need a comparison mode (monthly vs annual compounding)?\n\n" +
        "Or type 'auto' and I'll decide everything for you."
      );
    }
    return (
      "I'll build the calculator. Before I start:\n" +
      "1. Basic (+, -, *, /) only, or also scientific functions (sin, cos, sqrt, %)?\n" +
      "2. Any preferred theme (dark/light)?\n" +
      "3. Should it support keyboard input?\n\n" +
      "Or type 'auto' and I'll decide everything for you."
    );
  }

  if (lowered.includes("todo") || lowered.includes("task")) {
    return (
      "I'll build the task manager. Quick questions:\n" +
      "1. Should tasks have priorities (high/medium/low)?\n" +
      "2. Do you need due dates or deadlines?\n" +
      "3. Should tasks persist after browser refresh (localStorage)?\n" +
      "4. Any categories or tags for tasks?\n\n" +
      "Or type 'auto' and I'll pick sensible defaults."
    );
  }

  if (lowered.includes("quiz")) {
    return (
      "I'll build the quiz app. A few details:\n" +
      "1. What topic should the questions be about (general knowledge, coding, math, etc.)?\n" +
      "2. How many questions (5, 10, 15)?\n" +
      "3. Should there be a timer per question?\n" +
      "4. Show correct answer after wrong choice, or only at the end?\n\n" +
      "Or type 'auto' to let me decide."
    );
  }

  if (lowered.includes("weather")) {
    return (
      "I'll build the weather app. Quick questions:\n" +
      "1. Mock data only, or try to call a real API (OpenWeatherMap)?\n" +
      "2. Which cities should be pre-loaded?\n" +
      "3. Should there be a 5-day forecast section?\n" +
      "4. Dark or light theme?\n\n" +
      "Or type 'auto' and I'll use sensible mock data."
    );
  }

  if (lowered.includes("portfolio")) {
    return (
      "I'll build the portfolio page. I need a few details:\n" +
      "1. Your name and job title?\n" +
      "2. Which sections: About, Skills, Projects, Contact? (or all?)\n" +
      "3. Any preferred color scheme or style (dark, light, minimal, vibrant)?\n" +
      "4. Any specific skills or project names to include?\n\n" +
      "Or type 'auto' for a generic professional template."
    );
  }

  if (lowered.includes("game")) {
    return (
      "I'll build the game. Let me know:\n" +
      "1. Which game exactly? (Tic-Tac-Toe, Snake, Memory Card, Pong, 2048, etc.)\n" +
      "2. Single player or two players?\n" +
      "3. Any specific difficulty levels or score tracking?\n\n" +
      "Or type 'auto' and I'll pick a classic game."
    );
  }

  if (lowered.includes("chat")) {
    return (
      "I'll build the chat UI. A few questions:\n" +
      "1. User-to-user, or user-to-bot (mock AI responses)?\n" +
      "2. Should messages persist after refresh?\n" +
      "3. Any specific features: emoji picker, typing indicator, timestamps?\n\n" +
      "Or type 'auto' for a clean mock chat demo."
    );
  }

  if (lowered.includes("dashboard")) {
    return (
      "I'll build the dashboard. Quick questions:\n" +
      "1. What kind of data to display? (Sales, Analytics, Fitness, Finance, etc.)\n" +
      "2. What charts? (Bar, Line, Pie, or mixed?)\n" +
      "3. Should it have a sidebar navigation?\n" +
      "4. Dark or light theme?\n\n" +
      "Or type 'auto' for a sample analytics dashboard."
    );
  }

  // Generic fallback requirements question
  return (
    `I'll build your ${input.replace(/build|create|make|develop/gi, "").trim()}. Before I start:\n` +
    "1. What are the 2-3 most important features you need?\n" +
    "2. Any specific UI style preference (dark/light/colorful)?\n" +
    "3. Should data persist between sessions (localStorage)?\n\n" +
    "Or type 'auto' and I'll make all design decisions for you."
  );
}

// ── Routing hint for the LLM ───────────────────────────────────────────────────
function buildRoutingHint(input) {
  const text = String(input || "").toLowerCase();

  if (BOTH_KEYWORDS.test(text)) {
    return " This wants BOTH requirements AND implementation. Route MUST be 'both'.";
  }
  if (TEST_KEYWORDS.test(text) && !BUILD_KEYWORDS.test(text)) {
    return " This is a testing request. Route MUST be 'tester'.";
  }
  if (REQ_KEYWORDS.test(text) && !BUILD_KEYWORDS.test(text)) {
    return " This is a requirements/planning request. Route MUST be 'requirements'.";
  }
  if (BUILD_KEYWORDS.test(text)) {
    // Route to 'gather' so requirements are collected before building
    return " The user wants to BUILD something. Route MUST be 'gather' (not developer).";
  }
  return "";
}

// ── Parse LLM routing decision ─────────────────────────────────────────────────
function parseDecision(text) {
  if (!text) {
    return { route: "requirements", reason: "Default fallback — empty response." };
  }

  const cleaned = String(text)
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const matches = cleaned.match(/\{[\s\S]*?\}/g) || [];
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(matches[i]);
      const routeRaw = String(parsed.route || "").toLowerCase().trim();
      const reason = String(parsed.reason || parsed.rationale || "").trim();
      if (VALID_ROUTES.has(routeRaw)) {
        return { route: routeRaw, reason: reason || "AI decision." };
      }
    } catch {
      // Keep searching
    }
  }

  const routeMatch = cleaned.match(
    /route\s*[:=]\s*"?(requirements|developer|tester|both|clarify)"?/i
  );
  if (routeMatch) {
    return { route: routeMatch[1].toLowerCase(), reason: "Parsed route from text." };
  }

  return { route: "requirements", reason: "Fallback: could not parse LLM response." };
}

// ── Main supervisor function ───────────────────────────────────────────────────
async function supervisorAgent({ input, memory, hasExistingApp = false, hasUploadedDoc = false, uploadedDoc = null }) {
  const safeMemory = Array.isArray(memory) ? memory : [];

  // 0a. DOCUMENT Q&A — highest priority: if a doc is loaded and user isn't vague, answer from it.
  //     This fires BEFORE vague-check so the user doesn't get "please clarify" when asking
  //     a question about an uploaded document.
  if (hasUploadedDoc && !isVagueRequest(input)) {
    // Only route to qa if it looks like a question, not a new build request
    if (QA_KEYWORDS.test(input) || !BUILD_KEYWORDS.test(input)) {
      return {
        route: "qa",
        reason: "Document is active — answering from uploaded content.",
      };
    }
  }

  // 0b. REFINE: if there's an existing app and the user is asking to change it
  if (hasExistingApp && isRefinementRequest(input)) {
    return {
      route: "refine",
      reason: `Refining existing app: "${input.trim()}"`,
    };
  }

  // 1. Totally vague → ask what they want
  if (isVagueRequest(input)) {
    return {
      route: "clarify",
      reason: "What would you like to build? Please describe a specific app or feature. (Add 'auto' to skip questions and let me decide everything.)",
    };
  }

  // 2. AUTO mode → skip requirements gathering, run full pipeline
  if (isAutoMode(input)) {
    if (TEST_KEYWORDS.test(input)) {
      return { route: "tester", reason: "Auto mode — running tester workflow autonomously." };
    }
    return {
      route: "both",
      reason: "Auto mode — running requirements + development autonomously without asking questions.",
    };
  }

  // 3. If supervisor previously asked for requirements AND user just answered →
  //    proceed to build with the enriched context (don't ask again)
  if (wasAskedForRequirements(safeMemory) && !isVagueRequest(input)) {
    // User has answered the requirements question, now build
    if (TEST_KEYWORDS.test(input)) {
      return { route: "tester", reason: "Proceeding to test after requirements discussion." };
    }
    return {
      route: "developer",
      reason: "Requirements gathered from user. Proceeding to build.",
    };
  }

  // 4. Build intent detected → ask requirements first (interactive mode)
  // BUT: if an uploaded doc is active and user is asking questions → route to qa
  if (uploadedDoc && QA_KEYWORDS.test(input)) {
    return {
      route: "qa",
      reason: "Answering question from uploaded document context.",
    };
  }

  if (BUILD_KEYWORDS.test(input) && !TEST_KEYWORDS.test(input) && !REQ_KEYWORDS.test(input)) {
    const question = buildRequirementsQuestion(input);
    return {
      route: "gather",   // Special route: ask user for requirements
      reason: question,
    };
  }

  // 5. Explicit test or requirements requests → route directly
  if (TEST_KEYWORDS.test(input)) {
    return { route: "tester", reason: "Routing to tester based on keyword analysis." };
  }
  if (REQ_KEYWORDS.test(input)) {
    return { route: "requirements", reason: "Routing to requirements agent." };
  }

  // 6. Uploaded document test report generation
  if (DOC_KEYWORDS.test(input) && uploadedDoc) {
    return {
      route: "document",
      reason: "Generating structured test report from uploaded document."
    };
  }

  // 7. Fall back to LLM for ambiguous cases
  const messages = [{ role: "system", content: SUPERVISOR_SYSTEM }];
  const recentMemory = safeMemory.slice(-4);
  messages.push(...recentMemory);

  if (!recentMemory.length || recentMemory[recentMemory.length - 1].role !== "user") {
    messages.push({ role: "user", content: input });
  }

  const hint = buildRoutingHint(input);
  messages.push({
    role: "user",
    content: `Classify this request and return the route.${hint} Reply with JSON ONLY.`,
  });

  const response = await callOllamaChat({
    messages,
    role: "supervisor",
    temperature: 0.05,
    numPredict: 200,
  });

  const decision = parseDecision(response);

  // Safety: if LLM routes to clarify but request is clearly specific enough to build
  if (decision.route === "clarify" && BUILD_KEYWORDS.test(input) && input.trim().split(/\s+/).length >= 4) {
    const question = buildRequirementsQuestion(input);
    return { route: "gather", reason: question };
  }

  return decision;
}

module.exports = {
  supervisorAgent,
};
