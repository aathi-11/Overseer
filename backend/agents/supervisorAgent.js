const { callOllamaChat } = require("./ollamaClient");

const SUPERVISOR_SYSTEM =
  "You are a Supervisor Agent for a local SDLC simulator. " +
  "Decide whether a request should go to requirements, developer, tester, or both. " +
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
  const mentionsReq = lowered.includes("requirement") || lowered.includes("gather");
  const mentionsDev = lowered.includes("developer") || lowered.includes("develop");
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

  messages.push({
    role: "user",
    content:
      "Decide the route for the latest request. Reply with JSON only.",
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
