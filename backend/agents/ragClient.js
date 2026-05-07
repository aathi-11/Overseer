const crypto = require("crypto");

const RAG_URL = process.env.RAG_URL || "http://localhost:8000";
const RAG_TIMEOUT_MS = 60000;

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

/**
 * Query the RAG knowledge base.
 * @param {string} query - The search query
 * @param {number} nResults - Max number of chunks to return
 * @param {object} where - Optional ChromaDB metadata filter e.g. { type: "pattern" }
 */
async function queryRAG(query, nResults = 3, where = {}) {
    try {
        const body = { query, n_results: nResults };
        if (where && Object.keys(where).length > 0) {
            body.where = where;
        }
        const res = await fetchWithTimeout(
            `${RAG_URL}/query`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
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

/**
 * Store a document in the RAG knowledge base.
 * Uses a content hash to prevent near-duplicate entries from the same session.
 */
async function storeRAG(id, content, metadata = {}) {
    try {
        if (!content || content.trim().length < 10) return { stored: false };

        // Truncate very large content to avoid oversized embeddings
        const MAX_LEN = 20000;
        let storeContent = content;
        if (content.length > MAX_LEN) {
            console.warn(`[RAG] content truncated from ${content.length} to ${MAX_LEN} chars for id: ${id}`);
            storeContent = content.slice(0, MAX_LEN);
        }

        // Generate a content-hash suffix to prevent identical duplicates
        const contentHash = crypto
            .createHash("md5")
            .update(storeContent.slice(0, 150))
            .digest("hex")
            .slice(0, 8);
        const dedupeId = id.endsWith(`-${contentHash}`) ? id : `${id}-${contentHash}`;

        const res = await fetchWithTimeout(
            `${RAG_URL}/store`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: dedupeId, content: storeContent, metadata }),
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

/**
 * Build the RAG context block to inject into a prompt.
 * @param {string[]} chunks - Retrieved document chunks
 * @param {string} role - Agent role to tailor the instruction
 */
function buildRAGContext(chunks, role = "agent") {
    if (!chunks || chunks.length === 0) return "";

    const roleInstructions = {
        developer:
            "IMPORTANT — apply these coding patterns directly in your implementation:",
        requirements:
            "Use these past requirement patterns as a reference when structuring your output:",
        tester:
            "Apply these test patterns to produce thorough test cases:",
        default:
            "Reference these relevant past outputs where applicable:",
    };
    const instruction = roleInstructions[role] || roleInstructions.default;

    return (
        `\n\n${instruction}\n` +
        chunks.map((c, i) => `[${i + 1}] ${c}`).join("\n") +
        "\n\n"
    );
}

/**
 * Check if the RAG server is up and log collection size.
 * Call this once on backend startup.
 */
async function checkRAGHealth() {
    try {
        const res = await fetchWithTimeout(
            `${RAG_URL}/health`,
            { method: "GET" },
            5000
        );
        if (res.ok) {
            const data = await res.json();
            console.log(`[RAG] Connected — ${data.count} document(s) in collection.`);
            if (data.count === 0) {
                console.warn("[RAG] Collection is empty. Run rag/seed_knowledge.py to populate it.");
            }
        } else {
            console.warn("[RAG] Health check returned non-OK status:", res.status);
        }
    } catch {
        console.warn("[RAG] WARNING: RAG server is not reachable. Agents will use model knowledge only.");
    }
}

module.exports = { queryRAG, storeRAG, buildRAGContext, checkRAGHealth };
