const { callOllamaChat } = require("./ollamaClient");
const { SUPERVISOR_SYSTEM } = require("../config/prompts");

function isVagueRequest(input) {
  const text = String(input || "").trim().toLowerCase();
  if (!text) return true;
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (wordCount < 4) return true;
  if (/^(hi|hello|hey|yo|sup|start|go|help)$/i.test(text)) return true;
  if (/\b(build|make|create|do|design)\s+something\b/i.test(text)) return true;
  return false;
}

// SUPERVISOR_SYSTEM is sourced from config.

function parseDecision(text) {
  if (!text) {
    return { route: "requirements", reason: "Default fallback" };
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
      const routeRaw = String(parsed.route || "").toLowerCase();
      const reason = String(parsed.reason || parsed.rationale || "").trim();
      if (routeRaw === "requirements" || routeRaw === "developer" || routeRaw === "tester" || routeRaw === "both" || routeRaw === "clarify") {
        return { route: routeRaw, reason: reason || "AI decision" };
      }
    } catch (error) {
      // Continue searching other JSON blocks.
    }
  }

  const routeMatch = cleaned.match(/route\s*[:=]\s*"?(requirements|developer|tester|both|clarify)"?/i);
  if (routeMatch) {
    return { route: routeMatch[1].toLowerCase(), reason: "Parsed route from text" };
  }

  // Default fallback to avoid system crash
  return { route: "requirements", reason: "Fallback route due to parsing failure" };
}

async function supervisorAgent({ input, memory }) {
  if (isVagueRequest(input)) {
    return {
      route: "clarify",
      reason: "What would you like to build? Please name a specific app and key features.",
    };
  }
  const safeMemory = Array.isArray(memory) ? memory : [];
  const messages = [{ role: "system", content: SUPERVISOR_SYSTEM }, ...safeMemory];

  if (!safeMemory.length || safeMemory[safeMemory.length - 1].role !== "user") {
    messages.push({ role: "user", content: input });
  }

  const buildKeywords = /\b(build|create|make|generate|write|develop|implement|code|design)\b/i;
  const testKeywords = /\b(test|spec|qa|bug|edge case)\b/i;
  const reqKeywords = /\b(requirement|user stor|gather|document|spec)\b/i;

  let hint = "";
  if (buildKeywords.test(input) && !reqKeywords.test(input)) {
    hint = " The user wants to BUILD something — route should be 'developer'.";
  } else if (testKeywords.test(input)) {
    hint = " The user wants tests — route should be 'tester'.";
  }

  messages.push({
    role: "user",
    content: `Decide the route for the latest request.${hint} Reply with JSON only.`,
  });

  const response = await callOllamaChat({
    messages,
    temperature: 0.1,
    numPredict: 320,
  });

  return parseDecision(response);
}

module.exports = {
  supervisorAgent,
};
