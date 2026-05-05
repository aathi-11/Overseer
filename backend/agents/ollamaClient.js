const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "phi3";
const DEFAULT_URL = process.env.OLLAMA_URL || "http://localhost:11434/api/chat";

async function callOllamaChat({
  messages,
  model = DEFAULT_MODEL,
  temperature = 0.2,
  numPredict = 260,
}) {
  const response = await fetch(DEFAULT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
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

  const data = await response.json().catch(() => {
    throw new Error("Ollama returned non-JSON");
  });
  return (data.message && data.message.content ? data.message.content : "").trim();
}

module.exports = {
  callOllamaChat,
};
