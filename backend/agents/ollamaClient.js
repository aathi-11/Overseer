const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "phi3";
const DEFAULT_BASE_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const DEFAULT_NUM_PREDICT = 1024;

function normalizeOllamaBaseUrl(url) {
  const trimmed = String(url || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "http://localhost:11434";
  return trimmed.replace(/\/api\/(chat|embeddings)$/i, "");
}

const OLLAMA_BASE_URL = normalizeOllamaBaseUrl(DEFAULT_BASE_URL);

function buildOllamaUrl(path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${OLLAMA_BASE_URL}${normalizedPath}`;
}

function insertBeforeClosing(html, closeTag, beforeTag) {
  const beforeRegex = new RegExp(`</${beforeTag}>`, "i");
  if (beforeRegex.test(html)) {
    return html.replace(beforeRegex, `</${closeTag}>\n</${beforeTag}>`);
  }
  return `${html}\n</${closeTag}>`;
}

function repairHTML(html) {
  if (!html) return html;

  let repaired = String(html);
  const hasDoctype = /<!doctype html>/i.test(repaired);
  if (!hasDoctype && /<html\b/i.test(repaired)) {
    repaired = `<!DOCTYPE html>\n${repaired}`;
  }

  if (/<script\b/i.test(repaired) && !/<\/script>/i.test(repaired)) {
    repaired = insertBeforeClosing(repaired, "script", "body");
  }
  if (/<style\b/i.test(repaired) && !/<\/style>/i.test(repaired)) {
    repaired = insertBeforeClosing(repaired, "style", "head");
  }
  if (/<head\b/i.test(repaired) && !/<\/head>/i.test(repaired)) {
    repaired = insertBeforeClosing(repaired, "head", "body");
  }
  if (/<body\b/i.test(repaired) && !/<\/body>/i.test(repaired)) {
    repaired = insertBeforeClosing(repaired, "body", "html");
  }
  if (/<html\b/i.test(repaired) && !/<\/html>/i.test(repaired)) {
    repaired = `${repaired}\n</html>`;
  }

  return repaired;
}

async function readOllamaStream(response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const payload = JSON.parse(trimmed);
        if (payload.message && payload.message.content) {
          content += payload.message.content;
        }
        if (payload.done) {
          return content.trim();
        }
      } catch (err) {
        // Ignore malformed stream chunks; keep buffering.
      }
    }
  }

  if (buffer.trim()) {
    try {
      const payload = JSON.parse(buffer.trim());
      if (payload.message && payload.message.content) {
        content += payload.message.content;
      }
    } catch (err) {
      // Ignore trailing non-JSON content.
    }
  }

  return content.trim();
}

async function callOllamaChat({
  messages,
  model = DEFAULT_MODEL,
  temperature = 0.2,
  numPredict = DEFAULT_NUM_PREDICT,
  stream = false,
}) {
  const response = await fetch(buildOllamaUrl("/api/chat"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: Boolean(stream),
      options: {
        temperature,
        num_predict: numPredict,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama error: ${response.status} ${errorText}`);
  }

  if (stream) {
    return await readOllamaStream(response);
  }

  const data = await response.json().catch(() => {
    throw new Error("Ollama returned non-JSON");
  });
  return (data.message && data.message.content ? data.message.content : "").trim();
}

module.exports = {
  callOllamaChat,
  repairHTML,
};
