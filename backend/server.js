const crypto = require("crypto");
const express = require("express");
const http = require("http");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const { Server } = require("socket.io");
const { registerChatRoutes } = require("./routes/chat");
const { supervisorAgent } = require("./agents/supervisorAgent");
const { runRequirementsWorkflow } = require("./agents/requirementsAgent");
const { runDeveloperWorkflow } = require("./agents/developerAgent");
const { runTesterWorkflow } = require("./agents/testerAgent");
const { queryRAG, storeRAG, buildRAGContext } = require("./agents/ragClient");

const PORT = process.env.PORT || 3001;
const MEMORY_LIMIT = 8;
const OUTPUT_DIR = path.resolve(__dirname, "../../generated_code");

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
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
  // If no fenced code blocks were found, try to extract raw HTML and save it
  if (index === 1) {
    try {
      const html = sanitizeHTML(extractHTML(content));
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

function cleanOutput(text) {
  let rawText = String(text || "");
  
  // Apply junk pattern removal to ALL output
  const JUNK_PATTERNS = [
    /\[HTML generated\]/gi,
    /\[Code Review\].*/gi,
    /\[System Design\].*/gi,
    /\{"name":\s*".*"\}/gi, // Strip JSON-like objects
    /end of (the )?(html )?(head|body|style|script|content).*/gi,
    /(start|beginning) of (the )?(html )?(head|body|style|script|content).*/gi,
    /\.\.\.\s*(rest|more|continue|add|insert|include|styles?|scripts?|code|content).*/gi,
    /(rest|remainder) of (the )?(html|code|styles?|scripts?|content).*/gi,
    /(add|insert|place|put) (your )?(styles?|scripts?|content|html|code) here.*/gi,
    /html (head|body) (content|section) (ends?|starts?|here).*/gi,
    /\[?\s*(truncated|abbreviated|shortened|omitted|etc\.?)\s*\]?/gi,
    /^\s*\.\.\.\s*$/m, // bare ellipsis line
  ];

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

function sanitizeHTML(html) {
  if (!html) return html;

  // More aggressive patterns that can match anywhere in a line
  const JUNK_PATTERNS = [
    /\[HTML generated\]/gi,
    /\{"name":\s*".*"\}/gi,
    /end of (the )?(html )?(head|body|style|script|content).*/gi,
    /(start|beginning) of (the )?(html )?(head|body|style|script|content).*/gi,
    /\.\.\.\s*(rest|more|continue|add|insert|include|styles?|scripts?|code|content).*/gi,
    /(rest|remainder) of (the )?(html|code|styles?|scripts?|content).*/gi,
    /(add|insert|place|put) (your )?(styles?|scripts?|content|html|code) here.*/gi,
    /html (head|body) (content|section) (ends?|starts?|here).*/gi,
    /\[?\s*(truncated|abbreviated|shortened|omitted|etc\.?)\s*\]?/gi,
  ];

  let cleaned = html;
  for (const pattern of JUNK_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }

  return cleaned
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (/^\s*\.\.\.\s*$/.test(trimmed)) return false; // bare ellipsis
      if (/^<!--[\s\S]*?-->$/.test(trimmed)) return false; // single line comment
      return true;
    })
    .join("\n")
    .replace(/<!--[\s\S]*?-->/g, "") // multi-line comments
    .replace(/```\w*/g, "") // Any leftover backticks
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractHTML(text) {
  const raw = String(text || "");
  
  // 1. Try to find a clean fenced HTML block first
  const htmlCodeBlock = raw.match(/```html\s*\n([\s\S]*?)(?:\n```|$)/i);
  if (htmlCodeBlock && htmlCodeBlock[1]) return htmlCodeBlock[1].trim();

  // 2. Look for full DOCTYPE HTML
  const doctypeMatch = raw.match(/<!DOCTYPE html>[\s\S]*?(?:<\/html>|$)/i);
  if (doctypeMatch) return doctypeMatch[0];

  // 3. Fallback: any <html>...</html> or <body>...</body>
  const htmlTagMatch = raw.match(/<html[\s\S]*?(?:<\/html>|$)/i);
  if (htmlTagMatch) return htmlTagMatch[0];
  const bodyMatch = raw.match(/<body[\s\S]*?(?:<\/body>|$)/i);
  if (bodyMatch) return `<!DOCTYPE html>\n<html>\n${bodyMatch[0]}\n</html>`;

  // 4. Fallback: Any other code block, wrap it
  const anyCodeBlock = raw.match(/```(?:\w+)?\s*\n([\s\S]*?)(?:\n```|$)/i);
  if (anyCodeBlock && anyCodeBlock[1]) {
    const code = anyCodeBlock[1].replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<!DOCTYPE html>\n<html>\n<body style="background:#1e1e1e;color:#d4d4d4;padding:20px;font-family:monospace;white-space:pre-wrap;">${code}</body>\n</html>`;
  }

  return null;
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

function trimMemory(memory) {
  return memory.slice(-MEMORY_LIMIT);
}

function startServer() {
  const app = express();
  app.use(cors());
  registerChatRoutes(app);

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

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

        // RAG: retrieve relevant context before routing
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

        const decision = await supervisorAgent({ input: enrichedText, memory });
        const decisionNode = createNodePayload({
          type: "decision",
          role: "supervisor",
          title: "Supervisor Decision",
          content: `Route: ${decision.route}\n${decision.reason}`,
          route: decision.route,
          reason: decision.reason,
        });
        socket.emit("node:add", decisionNode);

        const outputs = [];
        const route = decision.route || "developer";

        if (route === "clarify") {
          const question = decision.reason || "Could you please provide more details about your request?";
          socket.emit("node:add", createNodePayload({
            type: "agent",
            role: "supervisor",
            title: "Question for Client",
            content: question,
          }));
          // Add to memory and summary so it shows in chat history
          memory.push({ role: "assistant", content: `Supervisor Question: ${question}` });
          socket.data.memory = trimMemory(memory);
          socket.emit("chat:done", { ok: true });
          socket.data.isBusy = false;
          return;
        }

        let needsReq = route === "requirements" || route === "both";
        let needsDev = route === "developer" || route === "both";
        let needsTest = route === "tester" || route === "both";

        let currentMemory = [...memory];

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
            memory: currentMemory,
            onStep: async (step) => {
              const isImplement = /implement/i.test(step.title || "");
              let content;

              try {
                if (isImplement) {
                  const html = sanitizeHTML(extractHTML(step.content));
                  if (html) {
                    socket.emit("app_preview", { html, label: step.title || "Implement" });
                    content = `${html.slice(0, 300)}\n\n[Full HTML — see live preview →]`;
                  } else {
                    content = "[Model returned no HTML — try rephrasing]";
                  }
                }
              } catch (err) {
                // non-fatal; continue
                console.warn("app_preview extraction error:", err && err.message ? err.message : err);
              }

              if (!content) {
                content = cleanOutput(step.content);
              }

              saveGeneratedCode(step.content, step.title);
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

        // RAG: store this session's summary into vector memory for future sessions
        try {
          const filteredOutputs = outputs.filter(o =>
            o && o.title && o.content && !/the\s*user\s*request\s*was\s*to/i.test(o.content)
          );
          const ragSummary = filteredOutputs
            .map((o) => {
              const isHTML = /<(!DOCTYPE|html)\b/i.test(o.content);
              const snippet = isHTML ? "[HTML generated]" : o.content.slice(0, 120).replace(/\n/g, " ");
              return `${o.role} / ${o.title}: ${snippet}`;
            })
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

  server.listen(PORT, () => {
    console.log(`Supervisor Agent backend running on ${PORT}`);
  });
}

module.exports = {
  startServer,
};

if (require.main === module) {
  startServer();
}
