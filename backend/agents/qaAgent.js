const { callOllamaChat } = require("./ollamaClient");
const { queryRAG } = require("./ragClient");

async function runQAAgent({ input, memory, docId, onStep }) {
  let ragContext = "(No document context found — the file may not have been indexed yet.)";
  try {
    const filter = docId ? { doc_id: docId } : { doc_type: "uploaded" };
    const ragResult = await queryRAG(input, 10, filter);
    if (ragResult && ragResult.found > 0) {
      ragContext = ragResult.chunks.join("\n\n");
    }
  } catch (e) {
    console.warn("[qaAgent] RAG query failed:", e.message);
  }

  const safeMemory = Array.isArray(memory) ? memory : [];
  const messages = [
    {
      role: "system",
      content:
        "You are a helpful document assistant. Answer questions using ONLY the provided context from the uploaded file. " +
        "The file could be a PDF, CSV, Excel, Word doc, image, JSON, or plain text. " +
        "Rules:\n" +
        "- Answer only from the context. Do not make up information.\n" +
        "- If context has tables or code, reproduce them clearly.\n" +
        "- If the answer is not in the context, say: 'This information is not found in the uploaded document.'\n" +
        "- Use markdown (bullets, bold, tables, code blocks) to format answers.\n" +
        "- Never use general knowledge if the context does not support it.",
    },
    ...safeMemory.slice(-4),
    {
      role: "user",
      content: `Relevant excerpts from the uploaded document:\n\n${ragContext}\n\n---\n\nQuestion: ${input}`,
    },
  ];

  const response = await callOllamaChat({
    messages,
    role: "qa",
    temperature: 0.1,
    numPredict: 1200,
    stream: false,
  });

  const output = {
    title: "Answer",
    content: String(response || "No answer generated.").trim(),
  };

  if (onStep) await onStep(output);
  return output;
}

module.exports = { runQAAgent };
