const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { supervisorAgent } = require("../agents/supervisorAgent");
const { runRequirementsWorkflow } = require("../agents/requirementsAgent");
const { runDeveloperWorkflow, refineApp } = require("../agents/developerAgent");
const { runTesterWorkflow } = require("../agents/testerAgent");
const { runDocumentAgent } = require("../agents/documentAgent");
const { runQAAgent } = require("../agents/qaAgent");
const { buildTestReportHTML } = require("../utils/reportBuilder");
const { queryRAG, storeRAG, buildRAGContext, checkRAGHealth } = require("../agents/ragClient");
const {
  extractHTML,
  repairHTML,
  sanitizeHTML: domSanitizeHTML,
  stripHtmlToText,
} = require("../utils/htmlUtils");

const MEMORY_LIMIT = Number(process.env.MEMORY_LIMIT || 8);
const OUTPUT_DIR = path.resolve(__dirname, "../../../generated_code");
const VALID_ROUTES = new Set(["requirements", "developer", "tester", "both", "clarify", "gather", "refine", "document", "qa"]);
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
  // Check RAG health once on startup
  checkRAGHealth();

  io.on("connection", (socket) => {
    socket.data.memory = [];
    socket.data.isBusy = false;
    socket.data.lastHTML = null;   // For refine mode
    socket.data.docId = null;      // Uploaded doc ID for Q&A
    socket.data.hasUploadedDoc = false;

    socket.on("disconnect", () => {
      socket.data.memory = [];
      socket.data.isBusy = false;
      socket.data.lastHTML = null;
      socket.data.docId = null;
      socket.data.hasUploadedDoc = false;
    });

    // Frontend sends this when user clicks the ✕ on the doc banner
    socket.on("doc:clear", () => {
      socket.data.docId = null;
      socket.data.hasUploadedDoc = false;
      console.log(`[doc:clear] Socket ${socket.id} cleared uploaded doc.`);
    });

    socket.on("chat:message", async (payload) => {
      const text = payload && payload.text ? payload.text.trim() : "";
      const uploadedDoc = payload && payload.uploadedDoc ? payload.uploadedDoc : null;
      if (!text || socket.data.isBusy) {
        return;
      }

      const BUILD_KEYWORDS = /\b(build|create|make|generate|develop|implement|code)\b/i;

      // ── FAST PATH: doc uploaded → skip supervisor, canvas, RAG node entirely ───────────
      // This eliminates ~3-8s supervisor LLM call and all canvas render overhead.
      // Fast QA path — only if doc active AND not a build request
      if (socket.data.hasUploadedDoc && socket.data.docId && !BUILD_KEYWORDS.test(text)) {
        socket.data.isBusy = true;
        socket.emit("chat:busy", { busy: true });
        try {
          const qaMem = socket.data.memory || [];
          let qaAnswer = "";

          await runQAAgent({
            input: text,
            memory: qaMem,
            docId: socket.data.docId,
            onStep: async ({ content }) => {
              qaAnswer = content;
              // Emit chat:answer — bypasses canvas/edges entirely
              socket.emit("chat:answer", {
                role: "qa",
                title: "Answer",
                content,
              });
            },
          });

          // Update memory with this Q&A exchange
          socket.data.memory = trimMemory([
            ...qaMem,
            { role: "user", content: text },
            { role: "assistant", content: qaAnswer },
          ]);
        } catch (err) {
          console.error("[QA fast path] error:", err);
          socket.emit("chat:error", { message: err.message });
        } finally {
          socket.data.isBusy = false;
          socket.emit("chat:done", { ok: true });
        }
        return; // ← never reaches supervisor or any other agent
      }
      // ── END FAST PATH ───────────────────────────────────────────────────────

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

        let ragChunksFound = 0;
        // Skip the general RAG lookup when a document is uploaded.
        // The global query has no doc_id filter, so it would return old session
        // memory (e.g. compound interest test cases) instead of the uploaded file.
        // The qaAgent runs its own targeted query scoped to socket.data.docId.
        if (!socket.data.hasUploadedDoc) {
          try {
            const generalRag = await queryRAG(text, 2);
            ragChunksFound = generalRag.found || 0;
            if (ragChunksFound > 0) {
              socket.emit("node:add", createNodePayload({
                type: "rag",
                role: "rag",
                title: "RAG: " + ragChunksFound + " memory chunk" + (ragChunksFound !== 1 ? "s" : "") + " retrieved",
                content: generalRag.chunks.map((c, i) => "[" + (i + 1) + "] " + c).join("\n\n"),
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
        } else {
          // Show a neutral node so the canvas still has a RAG lane entry
          socket.emit("node:add", createNodePayload({
            type: "rag",
            role: "rag",
            title: "RAG: Document mode",
            content: `Skipping global memory — querying uploaded doc (${socket.data.docId || "unknown"}) directly.`,
          }));
        }

        // Supervisor gets CLEAN input — no RAG injection to avoid routing confusion.
        // Pass hasExistingApp so the supervisor can detect refinement requests.
        // Pass uploadedDoc so supervisor can detect Q&A vs report-generation intent.
        const decision = await supervisorAgent({
          input: text,
          memory,
          hasExistingApp: Boolean(socket.data.lastHTML),
          hasUploadedDoc: Boolean(socket.data.hasUploadedDoc),
          uploadedDoc: uploadedDoc || (socket.data.hasUploadedDoc ? { docId: socket.data.docId } : null),
        });

        const route = normalizeRoute(decision.route);
        const decisionReason = String(decision.reason || "Routing decision").trim();

        // For gather/clarify, only show a short label in the decision node.
        // The full question text will appear once in its own dedicated node below.
        const decisionSummary =
          route === "gather" ? "Gathering requirements from user before building." :
          route === "clarify" ? "Request needs clarification before routing." :
          decisionReason;

        const decisionNode = createNodePayload({
          type: "decision",
          role: "supervisor",
          title: "Supervisor Decision",
          content: `Route: ${route}\n${decisionSummary}`,
          route,
          reason: decisionSummary,
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

        // GATHER: Supervisor is asking the user for requirements before building.
        // Store the question in memory so the next user reply triggers the build.
        if (route === "gather") {
          const question = decision.reason || "What specific features and preferences do you have for this app?";
          socket.emit("node:add", createNodePayload({
            type: "agent",
            role: "supervisor",
            title: "Requirements Gathering",
            content: question,
          }));
          // Tag the message so wasAskedForRequirements() detects it on the next turn
          memory.push({
            role: "assistant",
            content: `Supervisor Question: ${question}`,
          });
          socket.data.memory = trimMemory(memory);
          socket.emit("chat:done", { ok: true });
          socket.data.isBusy = false;
          return;
        }

        // ── REFINE ROUTE ─────────────────────────────────────────────────────
        // User is patching the existing generated app — not rebuilding from scratch.
        if (route === "refine") {
          const existingHTML = socket.data.lastHTML;
          if (!existingHTML) {
            // Safety: no HTML in state, fall through to build instead
            socket.emit("node:add", createNodePayload({
              type: "agent",
              role: "supervisor",
              title: "No App to Refine",
              content: "No existing app found to refine. Please build an app first, then request changes.",
            }));
            socket.emit("chat:done", { ok: true });
            socket.data.isBusy = false;
            return;
          }

          socket.emit("node:add", createNodePayload({
            type: "agent",
            role: "developer",
            title: "Refine: Patching App",
            content: `Applying change: "${text}"`,
          }));

          await refineApp({
            existingHTML,
            instruction: text,
            onStep: async (step) => {
              let html;
              try {
                html = sanitizePreviewHTML(extractHTML(step.content));
              } catch (e) { /* ignore */ }

              if (html) {
                socket.data.lastHTML = html;  // Update stored HTML with the patched version
                socket.emit("app_preview", { html, label: "Refined" });
                socket.emit("node:add", createNodePayload({
                  type: "agent",
                  role: "developer",
                  title: "Refine: Done",
                  content: `Change applied: "${text}"\n\n[Updated preview — see live preview panel]`,
                }));
              } else {
                socket.emit("node:add", createNodePayload({
                  type: "agent",
                  role: "developer",
                  title: "Refine: Could Not Parse",
                  content: "Model did not return valid HTML. Try rephrasing the change request.",
                }));
              }
            },
          });

          memory.push({ role: "user", content: text });
          memory.push({ role: "assistant", content: `Applied change: ${text}` });
          socket.data.memory = trimMemory(memory);
          socket.data.lastRoute = "refine";
          socket.emit("chat:done", { ok: true });
          socket.data.isBusy = false;
          return;
        }

        // Declare currentMemory once, here — used by document, qa, and all agent routes below.
        let currentMemory = buildWorkflowMemory(memory, route, lastRoute);

        // ── DOCUMENT ROUTE ─────────────────────────────────────────────────────
        if (route === "document" && uploadedDoc) {
          const docResults = await runDocumentAgent({
            input: text,
            memory: currentMemory,
            onStep: async (step) => {
              const content = cleanOutput(step.content);
              outputs.push({ role: "document", title: step.title, content });
              socket.emit(
                "node:add",
                createNodePayload({
                  type: "agent",
                  role: "requirements", // using requirements style for document node
                  title: step.title,
                  content,
                })
              );
            },
          });

          // Build HTML report
          const htmlReport = buildTestReportHTML(docResults, { filename: uploadedDoc.name });
          socket.data.lastHTML = htmlReport;
          socket.emit("app_preview", { html: htmlReport, label: "Test Report" });
          
          docResults.forEach((r) => {
            currentMemory.push({ role: "assistant", content: cleanOutput(r.content) });
          });
          
          memory.push({ role: "user", content: text });
          memory.push({ role: "assistant", content: "Generated test report from uploaded document." });
          socket.data.memory = trimMemory(memory);
          socket.data.lastRoute = "document";
          socket.emit("chat:done", { ok: true });
          socket.data.isBusy = false;
          return;
        }

        // ── QA ROUTE ───────────────────────────────────────────────────────
        // Pure document Q&A — no HTML, no preview, no developer agent.
        if (route === "qa") {
          const docId = socket.data.docId ||
            (uploadedDoc && uploadedDoc.docId) ||
            null;

          await runQAAgent({
            input: text,
            memory: currentMemory,
            docId,
            onStep: async ({ title, content }) => {
              socket.emit("node:add", createNodePayload({
                type: "agent",
                role: "qa",
                title,
                content,
              }));
              currentMemory.push({ role: "assistant", content });
            },
          });

          memory.push({ role: "user", content: text });
          socket.data.memory = trimMemory(currentMemory);
          socket.data.lastRoute = "qa";
          socket.emit("chat:done", { ok: true });
          socket.data.isBusy = false;
          return; // ← completely skips developer, preview, tester
        }

        let needsReq = route === "requirements" || route === "both";
        let needsDev = route === "developer" || route === "both";
        let needsTest = route === "tester" || route === "both";

        // currentMemory already declared above — do NOT re-declare here

        if (needsReq) {
          // Per-agent RAG: requirements agent gets requirement patterns
          let reqInput = text;
          try {
            const reqRag = await queryRAG(text, 2, { type: "requirement" });
            if (reqRag.found > 0) {
              reqInput = buildRAGContext(reqRag.chunks, "requirements") + "User Request: " + text;
            }
          } catch (e) { /* non-fatal */ }

          const reqResults = await runRequirementsWorkflow({
            input: reqInput,
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
          // Per-agent RAG: developer agent gets code patterns
          let devInput = text;
          try {
            const devRag = await queryRAG(text, 3, { type: "pattern" });
            if (devRag.found > 0) {
              devInput = buildRAGContext(devRag.chunks, "developer") + "User Request: " + text;
            }
          } catch (e) { /* non-fatal */ }

          const devResults = await runDeveloperWorkflow({
            input: devInput,
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
                    socket.data.lastHTML = html;  // Save for refine mode
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
          // Per-agent RAG: tester agent gets test patterns
          let testInput = text;
          try {
            const testRag = await queryRAG(text, 2, { type: "test" });
            if (testRag.found > 0) {
              testInput = buildRAGContext(testRag.chunks, "tester") + "User Request: " + text;
            }
          } catch (e) { /* non-fatal */ }

          await runTesterWorkflow({
            input: testInput,
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
          for (const o of filteredOutputs) {
            const rawContent = String(o.content || "");
            const isHTML = /<!DOCTYPE|<html\b/i.test(rawContent);
            let snippet = "";
            if (isHTML) {
              snippet = stripHtmlToText(rawContent).slice(0, 600);
            } else {
              snippet = cleanOutput(rawContent).slice(0, 600).replace(/\n/g, " ");
            }
            if (!snippet || snippet.trim().length < 20) continue;

            const storeContent = `${o.role} / ${o.title}: ${snippet}`;
            const storeId = "session-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
            await storeRAG(storeId, storeContent, {
              route,
              type: "session",
              agent: o.role,
              step: o.title,
              input: text.slice(0, 200),
              timestamp: new Date().toISOString(),
            });
            console.log("[RAG] stored session output, agent:", o.role, "step:", o.title);
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
