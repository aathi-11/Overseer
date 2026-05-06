import { useState } from "react";
import { useAgentStore } from "../store/useAgentStore.js";

const ROLE_LABELS = {
  user: "Client",
  supervisor: "Supervisor",
  requirements: "Requirements Analyst",
  developer: "Developer",
  tester: "Tester",
  rag: "RAG Memory",
};

const ROLE_COLORS = {
  user: "#7c3aed",
  supervisor: "#0f766e",
  requirements: "#2563eb",
  developer: "#16a34a",
  tester: "#ef4444",
  rag: "#f59e0b",
};



const AGENT_COLORS = {
  requirements: "#2563eb",
  developer: "#16a34a",
  tester: "#ef4444",
};

const AGENT_NAMES = {
  requirements: "Requirements",
  developer: "Developer",
  tester: "Tester",
};

export default function ChatPanel() {
  const [draft, setDraft] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const messages = useAgentStore((state) => state.messages);
  const sendMessage = useAgentStore((state) => state.sendMessage);
  const isConnected = useAgentStore((state) => state.isConnected);
  const isBusy = useAgentStore((state) => state.isBusy);
  const lastError = useAgentStore((state) => state.lastError);

  const handleTemplateSelect = (template) => {
    setDraft(template.template);
    setSelectedTemplate(template);
  };

  const shouldShowInChat = (message) => {
    if (!message || !message.role) return false;
    if (message.role === "user") return true;
    if (message.role !== "supervisor") return false;

    const title = String(message.title || "").toLowerCase();
    const content = String(message.content || "").toLowerCase();
    return title.includes("question") || content.includes("?");
  };

  const chatMessages = messages.filter(shouldShowInChat);

  const handleSend = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      return;
    }
    sendMessage(trimmed);
    setDraft("");
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const handleDraftChange = (value) => {
    setDraft(value);
    if (selectedTemplate && !value.includes(selectedTemplate.template)) {
      setSelectedTemplate(null);
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
            >
              <div className="meta">
                {ROLE_LABELS[message.role] || "Agent"}
                {message.title ? ` / ${message.title}` : ""}
              </div>
              <div className="content">{message.content}</div>
            </div>
          ))
        )}
      </div>

      <div className="chat-input">




        <textarea
          value={draft}
          onChange={(event) => handleDraftChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe the feature, bug, or test need..."
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
