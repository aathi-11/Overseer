const { callOllamaChat } = require("./ollamaClient");

const SUPERVISOR_SYSTEM =
  "You are a Supervisor Agent for a local SDLC simulator. " +
  "Decide the best route for the user request using these rules:\n" +
  "- 'developer': user wants to BUILD, CREATE, MAKE, or GENERATE something (e.g. 'build a login page', 'make a todo app', 'create a calculator'). This is the most common route.\n" +
  "- 'tester': user wants tests, test cases, QA, or bug reports written.\n" +
  "- 'requirements': user ONLY wants to gather or document requirements, user stories, or specs — not build anything.\n" +
  "- 'both': user wants BOTH requirements AND implementation together.\n" +
  "When in doubt for any 'build/create/make' request, always choose 'developer'.\n" +
  "Return JSON only in the shape {\"route\":\"requirements|developer|tester|both\",\"reason\":\"short sentence\"}.";

function parseDecision(text) {
  if (!text) {
    return { route: "developer", reason: "Default route" };
  }

  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      const routeRaw = String(parsed.route || "").toLowerCase();
      const reason = String(parsed.reason || parsed.rationale || "").trim();
      if (routeRaw === "requirements" || routeRaw === "developer" || routeRaw === "tester" || routeRaw === "both") {
        return { route: routeRaw, reason: reason || "AI decision" };
      }
    } catch (error) {
      // Fallback to heuristic parsing below.
    }
  }

  const lowered = text.toLowerCase();
  const mentionsReq = lowered.includes("requirement") || lowered.includes("gather") || lowered.includes("user stor");
  const mentionsDev = lowered.includes("developer") || lowered.includes("develop") || lowered.includes("build") || lowered.includes("creat") || lowered.includes("implement") || lowered.includes("generat");
  const mentionsTest = lowered.includes("tester") || lowered.includes("test");
  let route = "developer";

  if (mentionsReq) {
    route = "requirements";
  } else if (mentionsDev && mentionsTest) {
    route = "both";
  } else if (mentionsTest) {
    route = "tester";
  }

  return { route, reason: text.trim().slice(0, 180) };
}

async function supervisorAgent({ input, memory }) {
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
    numPredict: 120,
  });

  return parseDecision(response);
}

module.exports = {
  supervisorAgent,
};
