const { callOllamaChat } = require("./ollamaClient");
const { queryRAG } = require("./ragClient");

const DOC_SECTIONS = [
  "Document Overview",
  "Key Data & Findings",
  "Detailed Analysis",
  "Issues & Gaps",
  "Summary & Recommendations",
];

async function runDocumentAgent({ input, memory, docId, onStep }) {
  const results = [];

  for (const section of DOC_SECTIONS) {
    let ragContext = "";
    try {
      const filter = docId ? { doc_id: docId } : { doc_type: "uploaded" };
      const reqRag = await queryRAG(`${section} ${input}`, 6, filter);
      if (reqRag && reqRag.found > 0) {
        ragContext = reqRag.chunks.join("\n\n");
      }
    } catch (e) {
      console.warn("documentAgent RAG error:", e);
    }

    const safeMemory = Array.isArray(memory) ? memory : [];
    const messages = [
      {
        role: "system",
        content:
          "You are a document analysis specialist. " +
          "Write structured report sections based ONLY on the provided document context. " +
          "The document could be any type: report, data file, spec, research paper, etc. " +
          "Be specific and data-driven. Use bullet points. No filler text. Plain text only.",
      },
      ...safeMemory.slice(-4),
      {
        role: "user",
        content:
          `Context from uploaded document:\n${ragContext || "(No specific context found)"}\n\n` +
          `Write the "${section}" section for a report about: ${input}\n` +
          `Be concise and specific. Max 200 words.`,
      },
    ];

    const response = await callOllamaChat({
      messages,
      temperature: 0.2,
      numPredict: 500,
    });

    const output = { title: section, content: response };
    results.push(output);
    if (onStep) await onStep(output);
  }

  return results;
}

module.exports = { runDocumentAgent };
