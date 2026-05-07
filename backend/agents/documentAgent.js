// backend/agents/documentAgent.js
const { callOllamaChat } = require("./ollamaClient");
const { queryRAG } = require("./ragClient");

const DOC_SECTIONS = [
  "Executive Summary",
  "Test Coverage Analysis",
  "Defects & Findings",
  "Risk Assessment",
  "Recommendations",
];

async function runDocumentAgent({ input, memory, onStep }) {
  const results = [];

  for (const section of DOC_SECTIONS) {
    // Query RAG for relevant chunks for this section
    let ragContext = "";
    try {
      const reqRag = await queryRAG(`${section} ${input}`, 5, { doc_type: "test_report" });
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
          "You are a Senior QA Documentation Specialist. " +
          "Write professional test report sections based on the provided context. " +
          "Be specific, use real data from the context. No filler text. Plain text only.",
      },
      ...safeMemory.slice(-4),
      {
        role: "user",
        content:
          `Context from test documents:\n${ragContext || "(No specific context found, use general knowledge)"}\n\n` +
          `Write the "${section}" section of the test report for: ${input}\n` +
          `Be concise, specific, and data-driven. Max 200 words.`,
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
