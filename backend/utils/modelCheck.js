// backend/utils/modelCheck.js
// On startup, checks that all models referenced in the MODELS registry are
// actually pulled in Ollama. Logs a clear warning for any that are missing
// so the user knows why a particular agent would fail.

const { MODELS } = require("../agents/ollamaClient");

const OLLAMA_BASE_URL = (process.env.OLLAMA_URL || "http://localhost:11434")
  .replace(/\/+$/, "")
  .replace(/\/api\/(chat|embeddings)$/i, "");

async function checkModels() {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    if (!response.ok) {
      console.warn(
        `[modelCheck] Could not reach Ollama at ${OLLAMA_BASE_URL} — skipping model check.`
      );
      return;
    }

    const data = await response.json();
    // /api/tags returns { models: [ { name: "qwen2.5-coder:3b", ... }, ... ] }
    const pulledNames = new Set(
      (data.models || []).map((m) => String(m.name || "").toLowerCase())
    );

    // Deduplicate: same model may appear under multiple roles
    const uniqueModels = new Map();
    for (const [role, modelName] of Object.entries(MODELS)) {
      const key = modelName.toLowerCase();
      if (!uniqueModels.has(key)) {
        uniqueModels.set(key, []);
      }
      uniqueModels.get(key).push(role);
    }

    let allOk = true;
    for (const [modelName, roles] of uniqueModels) {
      const hasTag = modelName.includes(":");
      const searchNames = hasTag ? [modelName] : [modelName, `${modelName}:latest`];
      const isPulled = searchNames.some((n) => pulledNames.has(n));

      if (!isPulled) {
        allOk = false;
        console.warn(
          `[modelCheck] ⚠️  Model NOT pulled: "${modelName}" (used by: ${roles.join(", ")})\n` +
          `             Run: ollama pull ${modelName}`
        );
      } else {
        console.log(
          `[modelCheck] ✓  Model ready: "${modelName}" (${roles.join(", ")})`
        );
      }
    }

    // Also check embed model from env
    const embedModelRaw = (process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text").toLowerCase();
    const embedHasTag = embedModelRaw.includes(":");
    const embedSearchNames = embedHasTag ? [embedModelRaw] : [embedModelRaw, `${embedModelRaw}:latest`];
    const embedIsPulled = embedSearchNames.some((n) => pulledNames.has(n));

    if (!embedIsPulled) {
      allOk = false;
      console.warn(
        `[modelCheck] ⚠️  Embed model NOT pulled: "${embedModelRaw}"\n` +
        `             Run: ollama pull ${embedModelRaw}`
      );
    } else {
      console.log(`[modelCheck] ✓  Embed model ready: "${embedModelRaw}"`);
    }

    if (allOk) {
      console.log("[modelCheck] All models are available. ✓");
    } else {
      console.warn(
        "[modelCheck] Some models are missing — affected agents will fail. " +
        "Pull them with the commands above."
      );
    }
  } catch (err) {
    console.warn("[modelCheck] Model check failed (non-fatal):", err.message);
  }
}

module.exports = { checkModels };
