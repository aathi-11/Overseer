import { useEffect, useState } from "react";
import AgentCanvas from "./components/AgentCanvas.jsx";
import ChatPanel from "./components/ChatPanel.jsx";
import { useAgentStore } from "./store/useAgentStore.js";

export default function App() {
  const initSocket = useAgentStore((state) => state.initSocket);
  const socket = useAgentStore((s) => s.socket);

  const [previewHTML, setPreviewHTML] = useState("");
  const [previewHistory, setPreviewHistory] = useState([]);
  const [activePreview, setActivePreview] = useState(-1);

  useEffect(() => {
    initSocket();
  }, [initSocket]);

  useEffect(() => {
    if (!socket) return;
    const handler = (payload) => {
      const html = (payload && payload.html) || "";
      const label = (payload && payload.label) || "preview";
      const time = new Date().toISOString();
      setPreviewHistory((h) => [{ html, label, time }, ...h]);
      setPreviewHTML(html);
      setActivePreview(0);
    };

    socket.on("app_preview", handler);
    return () => socket.off("app_preview", handler);
  }, [socket]);

  function saveHTML() {
    if (!previewHTML) return;
    const blob = new Blob([previewHTML], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "app.html";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function selectVersion(index) {
    const item = previewHistory[index];
    if (item) {
      setActivePreview(index);
      setPreviewHTML(item.html);
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <div className="title">Supervisor Agent</div>
          <div className="subtitle">Local SDLC canvas with agent routing</div>
        </div>
        <div className="badge">Ollama Local</div>
      </header>
      <main className="app-body">
        <section className="panel">
          <ChatPanel />
        </section>
        <section className="canvas">
          <AgentCanvas />
        </section>
        <section className="panel">
          <div className="output-panel preview-panel">
            <div className="preview-header chat-header">
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div className="preview-dots">
                  <span style={{ background: "#ef4444" }} className="preview-dot" />
                  <span style={{ background: "#f59e0b" }} className="preview-dot" />
                  <span style={{ background: "#10b981" }} className="preview-dot" />
                </div>
                <div className="preview-url">agent://live-preview</div>
              </div>
              <div>
                <button className="preview-save-btn output-tab" onClick={saveHTML}>
                  ⬇ Save
                </button>
              </div>
            </div>

            {previewHistory.length > 1 && (
              <div className="preview-tabs output-tabs" style={{ marginBottom: 8 }}>
                {previewHistory.map((p, i) => (
                  <button
                    key={i}
                    className={`output-tab ${i === activePreview ? "active" : ""}`}
                    onClick={() => selectVersion(i)}
                  >
                    {`v${previewHistory.length - i} • ${new Date(p.time).toLocaleTimeString()}`}
                  </button>
                ))}
              </div>
            )}

            <div style={{ flex: 1, minHeight: 200 }}>
              {previewHTML ? (
                <iframe
                  title="app-preview"
                  srcDoc={previewHTML}
                  sandbox="allow-scripts allow-forms allow-modals"
                  className="preview-iframe"
                  style={{ width: "100%", height: "100%", border: "0", borderRadius: 12 }}
                />
              ) : (
                <div className="preview-placeholder chat-empty" style={{ height: 260, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontSize: 36 }}>⚡</div>
                  <div style={{ fontWeight: 700 }}>Your generated app will live preview here</div>
                  <div style={{ color: "var(--ink-soft)", fontSize: 13 }}>Try: build me a task planner</div>
                </div>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
