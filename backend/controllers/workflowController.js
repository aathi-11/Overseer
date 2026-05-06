const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { supervisorAgent } = require("../agents/supervisorAgent");
const { runRequirementsWorkflow } = require("../agents/requirementsAgent");
const { runDeveloperWorkflow } = require("../agents/developerAgent");
const { runTesterWorkflow } = require("../agents/testerAgent");
const { queryRAG, storeRAG, buildRAGContext } = require("../agents/ragClient");
const {
  extractHTML,
  repairHTML,
  sanitizeHTML: domSanitizeHTML,
  stripHtmlToText,
} = require("../utils/htmlUtils");

const MEMORY_LIMIT = Number(process.env.MEMORY_LIMIT || 8);
const OUTPUT_DIR = path.resolve(__dirname, "../../../generated_code");
const VALID_ROUTES = new Set(["requirements", "developer", "tester", "both", "clarify"]);
const FALLBACK_CALCULATOR_PATH = path.resolve(__dirname, "../templates/fallback-calculator.html");

const JUNK_PATTERNS = [
  /\[HTML generated\]/gi,
  /\[Code Review\].*/gi,
  /\[System Design\].*/gi,
  /\{"name":\s*".*"\}/gi,
  /end of (the )?(html )?(head|body|style|script|content).*/gi,
  /(start|beginning) of (the )?(html )?(head|body|style|script|content).*/gi,
  /\.\.\.\s*(rest|more|continue|add|insert|include|styles?|scripts?|code|content).*/gi,
  /(rest|remainder) of (the )?(html|code|styles?|scripts?|content).*/gi,
  /(add|insert|place|put) (your )?(styles?|scripts?|content|html|code) here.*/gi,
  /html (head|body) (content|section) (ends?|starts?|here).*/gi,
  /\[?\s*(truncated|abbreviated|shortened|omitted|etc\.?)+\s*\]?/gi,
  /^\s*\.\.\.\s*$/gm,
];

let fallbackCalculatorCache = null;

function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

function getFallbackCalculatorHTML() {
  if (fallbackCalculatorCache) return fallbackCalculatorCache;
  try {
    fallbackCalculatorCache = fs.readFileSync(FALLBACK_CALCULATOR_PATH, "utf8");
  } catch (err) {
    console.warn("fallback calculator missing:", err && err.message ? err.message : err);
    fallbackCalculatorCache = null;
  }
  return fallbackCalculatorCache;
}

function isCalculatorRequest(text) {
  return /\bcalculator\b/i.test(String(text || ""));
}

function validateCalculatorHTML(html) {
  if (!html) return false;
  const lower = String(html).toLowerCase();
  if (/(sorry|apolog)/i.test(html)) return false;
  if (!/<input[^>]+id=["']display["']/.test(lower)) return false;
  if (!/function\s+appendnumber\b/.test(lower)) return false;
  if (!/function\s+(operation|setoperator)\b/.test(lower)) return false;
  if (!/function\s+calculateresult\b/.test(lower)) return false;
  if (!/function\s+cleardisplay\b/.test(lower)) return false;
  return true;
}

function cleanOutput(text) {
  let rawText = String(text || "");

  for (const pattern of JUNK_PATTERNS) {
    rawText = rawText.replace(pattern, "");
  }

  if (/<(!DOCTYPE|html|body|head)\b/i.test(rawText)) {
    return rawText.trim();
  }

  const cleanedLines = rawText
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (/^\[.*?\]/.test(trimmed)) return false;
      if (/^(as the|i am the) .* agent[:,-]?\s*/i.test(trimmed)) return false;
      return true;
    });

  return cleanedLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function sanitizePreviewHTML(html) {
  if (!html) return html;
  let cleaned = String(html);
  for (const pattern of JUNK_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }
  cleaned = repairHTML(cleaned);
  return domSanitizeHTML(cleaned);
}

function saveGeneratedCode(content, title) {
  const codeRegex = /```(\w*)\n([\s\S]*?)```/g;
  let match;
  let index = 1;
  while ((match = codeRegex.exec(content)) !== null) {
    let ext = match[1].trim() || "txt";
    if (ext === "javascript") ext = "js";
    if (ext === "python") ext = "py";
    const code = match[2];
    const timestamp = Date.now();
    const safeTitle = title.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
    const filename = `code_${safeTitle}_${timestamp}_${index}.${ext}`;
    const filepath = path.join(OUTPUT_DIR, filename);
    fs.writeFileSync(filepath, code, "utf8");
    index++;
  }
  if (index === 1) {
    try {
      const html = sanitizePreviewHTML(extractHTML(content));
      if (html) {
        const timestamp = Date.now();
        const safeTitle = (title || "output").replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
        const filename = `code_${safeTitle}_${timestamp}_1.html`;
        const filepath = path.join(OUTPUT_DIR, filename);
        fs.writeFileSync(filepath, html, "utf8");
      }
    } catch (err) {
      console.warn("saveGeneratedCode: html extraction failed:", err && err.message ? err.message : err);
    }
  }
}

function createNodePayload({ type, role, title, content, route, reason }) {
  return {
    id: crypto.randomUUID(),
    type,
    role,
    title,
    content,
    route,
    reason,
    timestamp: new Date().toISOString(),
  };
}

function buildSummary(outputs) {
  if (!outputs.length) {
    return "";
  }

  const byRole = outputs.reduce((acc, item) => {
    if (!acc[item.role]) {
      acc[item.role] = [];
    }
    acc[item.role].push(item);
    return acc;
  }, {});

  const sections = [];
  if (byRole.requirements) {
    sections.push("Requirements Agent:");
    byRole.requirements.forEach((step, index) => {
      sections.push(`${index + 1}) ${step.title}: ${step.content}`);
    });
  }
  if (byRole.developer) {
    sections.push("Developer Agent:");
    byRole.developer.forEach((step, index) => {
      sections.push(`${index + 1}) ${step.title}: ${step.content}`);
    });
  }
  if (byRole.tester) {
    sections.push("Tester Agent:");
    byRole.tester.forEach((step, index) => {
      sections.push(`${index + 1}) ${step.title}: ${step.content}`);
    });
  }

  return sections.join("\n");
}

function normalizeRoute(route) {
  const normalized = String(route || "").toLowerCase().trim();
  return VALID_ROUTES.has(normalized) ? normalized : "requirements";
}

function buildWorkflowMemory(memory, route, lastRoute) {
  const userOnly = memory.filter((item) => item && item.role === "user");
  if (route === "requirements") {
    return userOnly.slice(-1);
  }
  if (lastRoute === "tester" && route === "developer") {
    return userOnly.slice(-1);
  }
  if (lastRoute && lastRoute !== route && route !== "both") {
    return userOnly.slice(-1);
  }
  return [...memory];
}

function trimMemory(memory) {
  return memory.slice(-MEMORY_LIMIT);
}

function registerWorkflowHandlers(io) {
  ensureOutputDir();

  io.on("connection", (socket) => {
    socket.data.memory = [];
    socket.data.isBusy = false;

    socket.on("disconnect", () => {
      socket.data.memory = [];
      socket.data.isBusy = false;
    });

    socket.on("chat:message", async (payload) => {
      const text = payload && payload.text ? payload.text.trim() : "";
      if (!text || socket.data.isBusy) {
        return;
      }

      socket.data.isBusy = true;
      socket.emit("chat:busy", { busy: true });

      try {
        const memory = socket.data.memory || [];
        memory.push({ role: "user", content: text });

        const inputNode = createNodePayload({
          type: "input",
          role: "user",
          title: "Client Input",
          content: text,
        });
        socket.emit("node:add", inputNode);

        let enrichedText = text;
        let ragChunksFound = 0;
        try {
          const ragResult = await queryRAG(text, 3);
          ragChunksFound = ragResult.found || 0;
          if (ragChunksFound > 0) {
            const ragContext = buildRAGContext(ragResult.chunks);
            enrichedText = ragContext + "User Request: " + text;
            socket.emit("node:add", createNodePayload({
              type: "rag",
              role: "rag",
              title: "RAG: " + ragChunksFound + " memory chunk" + (ragChunksFound !== 1 ? "s" : "") + " retrieved",
              content: ragResult.chunks.map((c, i) => "[" + (i + 1) + "] " + c).join("\n\n"),
            }));
          } else {
            socket.emit("node:add", createNodePayload({
              type: "rag",
              role: "rag",
              title: "RAG: No memory yet",
              content: "No relevant past context found. Agents will rely on model knowledge only.",
            }));
          }
        } catch (ragErr) {
          console.warn("[RAG] retrieval error (non-fatal):", ragErr.message);
        }

        const decision = await supervisorAgent({ input: text, memory });
        const route = normalizeRoute(decision.route);
        const decisionReason = String(decision.reason || "Routing decision").trim();
        const decisionNode = createNodePayload({
          type: "decision",
          role: "supervisor",
          title: "Supervisor Decision",
          content: `Route: ${route}\n${decisionReason}`,
          route,
          reason: decisionReason,
        });
        socket.emit("node:add", decisionNode);

        const outputs = [];
        const lastRoute = socket.data.lastRoute || null;

        if (route === "clarify") {
          const question = decision.reason || "Could you please provide more details about your request?";
          socket.emit("node:add", createNodePayload({
            type: "agent",
            role: "supervisor",
            title: "Question for Client",
            content: question,
          }));
          memory.push({ role: "assistant", content: `Supervisor Question: ${question}` });
          socket.data.memory = trimMemory(memory);
          socket.emit("chat:done", { ok: true });
          socket.data.isBusy = false;
          return;
        }

        let needsReq = route === "requirements" || route === "both";
        let needsDev = route === "developer" || route === "both";
        let needsTest = route === "tester" || route === "both";

        let currentMemory = buildWorkflowMemory(memory, route, lastRoute);

        if (needsReq) {
          const reqResults = await runRequirementsWorkflow({
            input: enrichedText,
            memory: currentMemory,
            onStep: async (step) => {
              const content = cleanOutput(step.content);
              saveGeneratedCode(step.content, step.title);
              outputs.push({ role: "requirements", title: step.title, content });
              socket.emit(
                "node:add",
                createNodePayload({
                  type: "agent",
                  role: "requirements",
                  title: step.title,
                  content,
                })
              );
            },
          });
          reqResults.forEach((r) => {
            currentMemory.push({ role: "assistant", content: cleanOutput(r.content) });
          });
        }

        if (needsDev) {
          const devResults = await runDeveloperWorkflow({
            input: enrichedText,
            rawInput: text,
            memory: currentMemory,
            onStep: async (step) => {
              const isImplement = /implement/i.test(step.title || "");
              let content;
              let html;

              try {
                if (isImplement) {
                  html = sanitizePreviewHTML(extractHTML(step.content));
                  if (isCalculatorRequest(text) && !validateCalculatorHTML(html)) {
                    const fallback = getFallbackCalculatorHTML();
                    html = fallback || html;
                  }
                  if (html) {
                    socket.emit("app_preview", { html, label: step.title || "Implement" });
                    content = `${html.slice(0, 300)}\n\n[Full HTML - see live preview]`;
                  } else {
                    content = "[Model returned no HTML - try rephrasing]";
                  }
                }
              } catch (err) {
                console.warn("app_preview extraction error:", err && err.message ? err.message : err);
              }

              if (!content) {
                content = cleanOutput(step.content);
              }

              saveGeneratedCode(html || step.content, step.title);
              outputs.push({ role: "developer", title: step.title, content });
              socket.emit(
                "node:add",
                createNodePayload({
                  type: "agent",
                  role: "developer",
                  title: step.title,
                  content,
                })
              );
            },
          });
          devResults.forEach((r) => {
            currentMemory.push({ role: "assistant", content: cleanOutput(r.content) });
          });
        }

        if (needsTest) {
          await runTesterWorkflow({
            input: enrichedText,
            memory: currentMemory,
            onStep: async (step) => {
              const content = cleanOutput(step.content);
              saveGeneratedCode(step.content, step.title);
              outputs.push({ role: "tester", title: step.title, content });
              socket.emit(
                "node:add",
                createNodePayload({
                  type: "agent",
                  role: "tester",
                  title: step.title,
                  content,
                })
              );
            },
          });
        }

        const summary = buildSummary(outputs);
        if (summary) {
          memory.push({ role: "assistant", content: summary });
        }

        socket.data.memory = trimMemory(memory);
        socket.data.lastRoute = route;

        try {
          const filteredOutputs = outputs.filter((o) =>
            o && o.title && o.content && !/the\s*user\s*request\s*was\s*to/i.test(o.content)
          );
          const ragSummary = filteredOutputs
            .map((o) => {
              const rawContent = String(o.content || "");
              const isHTML = /<(!DOCTYPE|html)\b/i.test(rawContent);
              let snippet = "";
              if (isHTML) {
                snippet = stripHtmlToText(rawContent).slice(0, 200);
              } else {
                snippet = cleanOutput(rawContent).slice(0, 200).replace(/\n/g, " ");
              }
              if (!snippet) return null;
              return `${o.role} / ${o.title}: ${snippet}`;
            })
            .filter(Boolean)
            .join("\n");
          if (ragSummary && ragSummary.trim().length > 20) {
            const storeId = "session-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
            await storeRAG(storeId, ragSummary, {
              route: route,
              input: text.slice(0, 120),
              timestamp: new Date().toISOString(),
            });
            console.log("[RAG] stored session summary, id:", storeId);
          }
        } catch (storeErr) {
          console.warn("[RAG] store session error (non-fatal):", storeErr.message);
        }

        socket.emit("chat:done", { ok: true });
      } catch (error) {
        socket.emit("chat:error", {
          message: error && error.message ? error.message : "Server error",
        });
        socket.emit("chat:done", { ok: false });
      } finally {
        socket.data.isBusy = false;
      }
    });
  });
}

module.exports = {
  registerWorkflowHandlers,
};
