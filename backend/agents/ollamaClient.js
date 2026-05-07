const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "qwen2.5-coder:3b";
const DEFAULT_BASE_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const DEFAULT_NUM_PREDICT = 1024;
// Force CPU-only inference: GTX 1650 has only 4 GB VRAM which is insufficient
// for larger models. Setting num_gpu=0 bypasses CUDA entirely and uses the CPU
// backend — slower but stable, and safe for the hardware. Using 3B for faster inference.
const FORCE_CPU = process.env.OLLAMA_FORCE_CPU !== "false";

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
        num_ctx: 4096,
        // num_gpu: 0 forces llama.cpp to use CPU only.
        // Remove this (or set OLLAMA_FORCE_CPU=false) if you upgrade to
        // a GPU with enough VRAM (>=6 GB) to run the model fully on GPU.
        num_gpu: FORCE_CPU ? 0 : undefined,
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
};
