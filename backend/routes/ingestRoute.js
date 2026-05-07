const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const router = express.Router();

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Accept files up to 150 MB (large annual report PDFs can be 50-100 MB)
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 150 * 1024 * 1024 },
});

// io is injected by server.js so we can access socket sessions
let _io = null;
function setIO(io) {
  _io = io;
}

router.post("/api/ingest", upload.single("document"), async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const docType = req.body.type || "uploaded";
  const socketId = req.headers["x-socket-id"];

  try {
    const { Blob } = require("buffer");
    const fileBuffer = fs.readFileSync(file.path);
    const blob = new Blob([fileBuffer]);

    const formData = new FormData();
    formData.append("file", blob, file.originalname);
    formData.append("doc_type", docType);
    formData.append("filename", file.originalname);

    // ── Long timeout for large PDFs (10 min). Vision extraction on a
    //    200-page annual report can take several minutes on CPU.
    const ragRes = await fetch("http://127.0.0.1:8000/ingest", {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });

    if (!ragRes.ok) {
      const errText = await ragRes.text();
      let detail = errText;
      try { detail = JSON.parse(errText).detail || errText; } catch {}
      throw new Error(`RAG server ${ragRes.status}: ${detail}`);
    }

    const contentType = ragRes.headers.get("content-type") || "";

    // ── SSE stream (PDF) — pipe progress events to the frontend then extract
    //    the final docId from the "done" event ────────────────────────────────
    if (contentType.includes("text/event-stream")) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      const reader = ragRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let docId = null;
      let chunkCount = 0;
      let totalChunks = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            // Forward every SSE line to the browser verbatim
            res.write(line + "\n");

            if (!line.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === "progress") {
                // Already forwarded above — nothing extra needed
              } else if (event.type === "done") {
                docId = event.doc_id;
                chunkCount = event.chunk_count || 0;
                totalChunks = event.total_chunks || chunkCount;
              }
            } catch { /* ignore malformed events */ }
          }
        }
      } finally {
        reader.releaseLock();
      }

      // Store docId on the socket session
      if (docId && socketId && _io) {
        const socket = _io.sockets.sockets.get(socketId);
        if (socket) {
          socket.data.docId = docId;
          socket.data.hasUploadedDoc = true;
          console.log(`[ingest] Socket ${socketId} → doc_id=${docId}, chunks=${chunkCount}`);
        }
      }

      // Emit a final JSON event the frontend can use to update its state
      // (mirrors the non-SSE JSON shape for compatibility)
      const finalPayload = { docId, chunk_count: chunkCount, total_chunks: totalChunks };
      res.write(`data: ${JSON.stringify({ type: "result", ...finalPayload })}\n\n`);
      res.end();

    } else {
      // ── Non-PDF: plain JSON response ─────────────────────────────────────
      const rawBody = await ragRes.text();
      const result = JSON.parse(rawBody);

      if (socketId && _io) {
        const socket = _io.sockets.sockets.get(socketId);
        if (socket) {
          socket.data.docId = result.doc_id;
          socket.data.hasUploadedDoc = true;
          console.log(`[ingest] Socket ${socketId} → doc_id=${result.doc_id}, chunks=${result.chunk_count}`);
        }
      }

      res.json({ docId: result.doc_id, chunk_count: result.chunk_count, total_chunks: result.total_chunks });
    }

  } catch (error) {
    console.error("Ingest error:", error);
    res.status(500).json({ error: "Failed to ingest document", detail: error.message });
  } finally {
    // Always clean up temp file
    if (file && fs.existsSync(file.path)) {
      try { fs.unlinkSync(file.path); } catch {}
    }
  }
});

module.exports = { router, setIO };
