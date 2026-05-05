const RAG_URL = process.env.RAG_URL || "http://localhost:8000";
const RAG_TIMEOUT_MS = 5000;

async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timer);
        return res;
    } catch (err) {
        clearTimeout(timer);
        throw err;
    }
}

async function queryRAG(query, nResults = 3) {
    try {
        const res = await fetchWithTimeout(
            `${RAG_URL}/query`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query, n_results: nResults }),
            },
            RAG_TIMEOUT_MS
        );
        if (!res.ok) return { chunks: [], found: 0 };
        const data = await res.json();
        return { chunks: data.chunks || [], found: data.found || 0 };
    } catch (err) {
        console.warn("[RAG] query failed (non-fatal, continuing without context):", err.message);
        return { chunks: [], found: 0 };
    }
}

async function storeRAG(id, content, metadata = {}) {
    try {
        if (!content || content.trim().length < 10) return { stored: false };
        const MAX_LEN = 6000;
        let storeContent = content;
        if (content.length > MAX_LEN) {
            console.warn(`[RAG] content truncated from ${content.length} to ${MAX_LEN} chars for id: ${id}`);
            storeContent = content.slice(0, MAX_LEN);
        }
        const res = await fetchWithTimeout(
            `${RAG_URL}/store`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id, content: storeContent, metadata }),
            },
            RAG_TIMEOUT_MS
        );
        if (!res.ok) return { stored: false };
        return await res.json();
    } catch (err) {
        console.warn("[RAG] store failed (non-fatal):", err.message);
        return { stored: false };
    }
}

function buildRAGContext(chunks) {
    if (!chunks || chunks.length === 0) return "";
    return (
        "\n\n=== RELEVANT KNOWLEDGE FROM MEMORY ===\n" +
        chunks.map((c, i) => `[Memory ${i + 1}]: ${c}`).join("\n\n") +
        "\n=== END OF KNOWLEDGE ===\n\n"
    );
}

module.exports = { queryRAG, storeRAG, buildRAGContext };
