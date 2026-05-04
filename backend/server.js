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
}

function cleanOutput(text) {
  const rawText = String(text || "");
  const cleanedLines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) {
        return true;
      }
      if (/^\[.*?\]/.test(line)) {
        return false;
      }
      if (/^(as the|i am the) .* agent[:,-]?\s*/i.test(line)) {
        return false;
      }
      return true;
    });

  return cleanedLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function extractHTML(text) {
  const raw = String(text || "");
  // Look for full DOCTYPE HTML
  const doctypeMatch = raw.match(/<!DOCTYPE html>[\s\S]*?(?:<\/html>|$)/i);
  if (doctypeMatch) return doctypeMatch[0];

  // Fallback: any <html>...</html> or <body>...</body>
  const htmlTagMatch = raw.match(/<html[\s\S]*?(?:<\/html>|$)/i);
  if (htmlTagMatch) return htmlTagMatch[0];
  const bodyMatch = raw.match(/<body[\s\S]*?(?:<\/body>|$)/i);
  if (bodyMatch) return `<!DOCTYPE html>\n<html>\n${bodyMatch[0]}\n</html>`;

  // Fallback: fenced code block with html language
  const htmlCodeBlock = raw.match(/```html\s*\n([\s\S]*?)(?:```|$)/i);
  if (htmlCodeBlock && htmlCodeBlock[1]) return htmlCodeBlock[1].trim();

  // Fallback: Any other code block, wrap in styled <pre> so it still shows up
  const anyCodeBlock = raw.match(/```(?:\w+)?\s*\n([\s\S]*?)(?:```|$)/i);
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

        const decision = await supervisorAgent({ input: text, memory });
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

        let needsReq = route === "requirements";
        let needsDev = route === "requirements" || route === "developer" || route === "both";
        let needsTest = route === "requirements" || route === "tester" || route === "both";

        let currentMemory = [...memory];

        if (needsReq) {
          const reqResults = await runRequirementsWorkflow({
            input: text,
            memory: currentMemory,
            onStep: async (step) => {
              const content = cleanOutput(step.content);
              saveGeneratedCode(content, step.title);
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
            input: text,
            memory: currentMemory,
            onStep: async (step) => {
              // If this is the Implement step, try to extract HTML and emit preview
              try {
                if (/implement/i.test(step.title || "")) {
                  const html = extractHTML(step.content);
                  if (html) {
                    socket.emit("app_preview", { html, label: step.title || "Implement" });
                  }
                }
              } catch (err) {
                // non-fatal; continue
                console.warn("app_preview extraction error:", err && err.message ? err.message : err);
              }

              const content = cleanOutput(step.content);
              saveGeneratedCode(content, step.title);
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
            input: text,
            memory: currentMemory,
            onStep: async (step) => {
              const content = cleanOutput(step.content);
              saveGeneratedCode(content, step.title);
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
