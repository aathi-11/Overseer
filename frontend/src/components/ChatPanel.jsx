import { useState } from "react";
import { useAgentStore } from "../store/useAgentStore.js";

const ROLE_LABELS = {
  user: "Client",
  supervisor: "Supervisor",
  requirements: "Requirements Analyst",
  developer: "Developer",
  tester: "Tester",
  rag: "RAG Memory",
  qa: "Document Q&A",
};

const ROLE_COLORS = {
  user: "#7c3aed",
  supervisor: "#0f766e",
  requirements: "#2563eb",
  developer: "#16a34a",
  tester: "#ef4444",
  rag: "#f59e0b",
  qa: "#0891b2",
};

export default function ChatPanel() {
  const [draft, setDraft] = useState("");
  const [uploadedFile, setUploadedFile] = useState(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");

  const messages = useAgentStore((state) => state.messages);
  const sendMessage = useAgentStore((state) => state.sendMessage);
  const isConnected = useAgentStore((state) => state.isConnected);
  const isBusy = useAgentStore((state) => state.isBusy);
  const lastError = useAgentStore((state) => state.lastError);
  const socket = useAgentStore((state) => state.socket);

  // Which messages appear in the chat panel
  const shouldShowInChat = (message) => {
    if (!message || !message.role) return false;
    if (message.role === "user") return true;
    if (message.role === "qa") return true;  // Q&A answers always show in chat
    if (message.role !== "supervisor") return false;
    const title = String(message.title || "").toLowerCase();
    const content = String(message.content || "").toLowerCase();
    return title.includes("question") || content.includes("?");
  };

  const chatMessages = messages.filter(shouldShowInChat);

  const handleSend = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    sendMessage(trimmed, uploadedFile);
    setDraft("");
    // Don't clear uploadedFile on send — keep doc active for follow-up Q&A
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploadLoading(true);
    setUploadProgress("");

    const formData = new FormData();
    formData.append("document", file);
    formData.append("type", "uploaded");

    try {
      const headers = {};
      // Pass socket ID so the backend can store docId on the socket session
      if (socket && socket.id) {
        headers["x-socket-id"] = socket.id;
      }

      const res = await fetch("http://localhost:3001/api/ingest", {
        method: "POST",
        body: formData,
        headers,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error || "Upload failed");
      }

      const contentType = res.headers.get("content-type") || "";

      if (contentType.includes("text/event-stream")) {
        // ── SSE stream (PDF ingest with per-page progress) ─────────────────
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let finalData = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === "progress") {
                setUploadProgress(event.message);
              } else if (event.type === "done" || event.type === "result") {
                // 'done' comes from Python RAG server directly
                // 'result' comes from the Node proxy (ingestRoute.js)
                // Both are accepted — keys may be snake_case or camelCase
                finalData = event;
              }
            } catch { /* ignore malformed events */ }
          }
        }

        if (!finalData) throw new Error("Upload stream ended without a result.");
        if (finalData.warning) console.warn("Ingest warning:", finalData.warning);

        // Normalize snake_case (Python) vs camelCase (Node proxy) key names
        const resolvedDocId    = finalData.doc_id    || finalData.docId    || null;
        const resolvedChunks   = finalData.chunk_count ?? 0;
        const resolvedTotal    = finalData.total_chunks ?? resolvedChunks;

        setUploadedFile({
          name: file.name,
          docId: resolvedDocId,
          chunks: resolvedChunks,
          total: resolvedTotal,
        });
      } else {
        // ── Plain JSON response (CSV, JSON, TXT) ─────────────────────────────
        const data = await res.json();
        setUploadedFile({
          name: file.name,
          docId: data.docId,
          chunks: data.chunk_count,
          total: data.total_chunks || data.chunk_count,
        });
      }
    } catch (err) {
      console.error("Upload failed:", err);
      alert(`Upload failed: ${err.message}`);
    } finally {
      setUploadLoading(false);
      setUploadProgress("");
      // Reset input so same file can be re-uploaded
      e.target.value = "";
    }
  };

  const handleClearDoc = () => {
    setUploadedFile(null);
    if (socket) {
      socket.emit("doc:clear");
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat">
      <div className="chat-header">
        <h2>Chat Control</h2>
        <div className={`status ${isConnected ? "on" : "off"}`}>
          <span className="status-dot" />
          {isConnected ? "Connected" : "Disconnected"}
        </div>
      </div>

      <div className="chat-messages">
        {chatMessages.length === 0 ? (
          <div className="chat-empty">
            Send a requirement to start the workflow.
          </div>
        ) : (
          chatMessages.map((message) => (
            <div
              key={message.id}
              className={`message ${message.role || "assistant"}`}
              style={{
                borderLeft: `3px solid ${ROLE_COLORS[message.role] || "#4f46e5"}`,
              }}
            >
              <div className="meta" style={{ color: ROLE_COLORS[message.role] || "#a78bfa" }}>
                {ROLE_LABELS[message.role] || "Agent"}
                {message.title ? ` / ${message.title}` : ""}
              </div>
              <div className="content">{message.content}</div>
            </div>
          ))
        )}
      </div>

      <div className="chat-input">
        {/* Active document banner */}
        {uploadedFile && (
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 10px",
            marginBottom: uploadProgress ? 0 : "8px",
            background: "rgba(8, 145, 178, 0.15)",
            border: "1px solid rgba(8, 145, 178, 0.4)",
            borderRadius: uploadProgress ? "6px 6px 0 0" : "6px",
            fontSize: "12px",
            color: "#67e8f9",
          }}>
            <span>📄 {uploadedFile.name}
              {uploadedFile.total != null && (
                <span style={{ opacity: 0.7, marginLeft: "6px" }}>
                  ({uploadedFile.chunks} embedded / {uploadedFile.total} chunks)
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={handleClearDoc}
              style={{
                background: "none",
                border: "none",
                color: "#67e8f9",
                cursor: "pointer",
                fontSize: "16px",
                lineHeight: 1,
                padding: "0 2px",
              }}
              title="Clear document"
            >
              ✕
            </button>
          </div>
        )}

        {/* Ingest progress message (PDF page-by-page processing) */}
        {uploadProgress && (
          <div style={{
            padding: "4px 10px 6px",
            marginBottom: "8px",
            background: "rgba(251, 191, 36, 0.2)",
            border: "1px solid rgba(180, 83, 9, 0.6)",
            borderTop: "none",
            borderRadius: "0 0 6px 6px",
            fontSize: "11px",
            color: "#78350f",
            fontStyle: "italic",
            fontWeight: 600,
          }}>
            ⏳ {uploadProgress}
          </div>
        )}

        {/* Attach button row */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
          <label
            className="upload-btn"
            style={{
              cursor: uploadLoading ? "wait" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              padding: "6px 12px",
              background: uploadLoading ? "#374151" : "#4f46e5",
              color: "#ffffff",
              borderRadius: "6px",
              fontSize: "13px",
              fontWeight: "500",
              transition: "background 0.2s",
              userSelect: "none",
            }}
            onMouseOver={(e) => { if (!uploadLoading) e.currentTarget.style.background = "#4338ca"; }}
            onMouseOut={(e) => { if (!uploadLoading) e.currentTarget.style.background = "#4f46e5"; }}
          >
            {uploadLoading ? "⏳ Uploading..." : "📎 Attach File"}
            <input
              type="file"
              accept=".pdf,.csv,.json,.txt,.md,.xlsx,.docx,.png,.jpg,.jpeg"
              onChange={handleFileUpload}
              disabled={uploadLoading}
              style={{ display: "none" }}
            />
          </label>

          {uploadedFile && (
            <span style={{ fontSize: "11px", color: "#10b981", opacity: 0.9 }}>
              ✓ Doc active — ask questions about it!
            </span>
          )}
        </div>

        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            uploadedFile
              ? `Ask a question about ${uploadedFile.name}, or say "build a dashboard from this data"...`
              : "Describe the feature, bug, or test need..."
          }
          disabled={!isConnected || isBusy}
        />
        <button type="button" onClick={handleSend} disabled={!isConnected || isBusy}>
          {isBusy ? "Running agents..." : "Send"}
        </button>
      </div>

      {lastError ? <div className="error-banner">{lastError}</div> : null}
    </div>
  );
}
