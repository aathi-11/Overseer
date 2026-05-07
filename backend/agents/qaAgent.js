// backend/agents/qaAgent.js
// Lightweight document Q&A agent — no HTML, no preview, just answers.
// Uses RAG to fetch only relevant chunks from an uploaded document,
// then asks the LLM to answer with a tiny token budget (~400 tokens).

const { callOllamaChat } = require("./ollamaClient");
const { queryRAG } = require("./ragClient");

async function runQAAgent({ input, memory, docId, onStep }) {
  // 1. Query RAG with the user's question — filter to uploaded docs only
  let ragContext = "(No document context found)";
  try {
    const filter = docId
      ? { doc_id: docId }           // Scope to the specific uploaded doc
      : { doc_type: "uploaded" };   // Fall back to any uploaded doc

    // Use 8 chunks for large docs (annual reports, whitepapers) to get enough context
    const ragResult = await queryRAG(input, 8, filter);
    if (ragResult && ragResult.found > 0) {
      ragContext = ragResult.chunks.join("\n\n");
    }
  } catch (e) {
    console.warn("[qaAgent] RAG query failed (non-fatal):", e.message);
  }

  // 2. Build a minimal, focused message array
  const safeMemory = Array.isArray(memory) ? memory : [];
  const messages = [
    {
      role: "system",
      content:
        "You are an expert financial document assistant. Answer questions using ONLY the provided context. " +
        "If the user asks about revenue, tables, or financial data, provide a clear, well-structured summary. " +
        "You may use markdown (bullet points, bold text) to make the data easy to read. " +
        "Never reply with just a date or number alone — always explain it with context from the document. " +
        "If the answer is not in the context, say clearly: 'The document does not contain this information.' " +
        "Be helpful and detailed when summarizing data.",
    },
    // Last 2 memory items — enough for one follow-up, minimal token overhead
    ...safeMemory.slice(-2),
    {
      role: "user",
      content: `Context from document:\n${ragContext}\n\nQuestion: ${input}`,
    },
  ];

  // 3. Call Ollama — sufficient token budget for summaries, deterministic temperature, no streaming
  const response = await callOllamaChat({
    messages,
    role: "qa",         // → gemma3:4b for richer document reasoning
    temperature: 0.1,   // Factual answers only
    numPredict: 800,    // Increased to allow for detailed summaries of revenue/tables
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
