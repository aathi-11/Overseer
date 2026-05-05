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

const TEMPLATES = [
  {
    id: "crud",
    label: "Build a CRUD feature for...",
    template: "Build a CRUD feature for [describe entity/domain]",
    agents: ["developer", "tester"],
  },
  {
    id: "tests",
    label: "Write tests for...",
    template: "Write comprehensive tests for [describe component/module]",
    agents: ["tester"],
  },
  {
    id: "app",
    label: "I need an app that...",
    template: "I need an app that [describe the purpose and main features]",
    agents: ["requirements", "developer", "tester"],
  },
  {
    id: "bug",
    label: "Fix the bug where...",
    template: "Fix the bug where [describe the issue and when it happens]",
    agents: ["developer", "tester"],
  },
  {
    id: "refactor",
    label: "Refactor...",
    template: "Refactor [describe component/module] for better [performance/readability/maintainability]",
    agents: ["developer"],
  },
  {
    id: "doc",
    label: "Document...",
    template: "Document [describe component/feature] including [what aspects]",
    agents: ["requirements"],
  },
  {
    id: "feature",
    label: "Add a feature that...",
    template: "Add a feature that [describe what users can do with it]",
    agents: ["requirements", "developer", "tester"],
  },
];

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

  const chatMessages = messages;

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
        <div className="chat-input__templates">
          <label htmlFor="template-select" className="chat-input__label">
            Quick Start:
          </label>
          <select
            id="template-select"
            className="chat-input__select"
            onChange={(e) => {
              const templateId = e.target.value;
              if (templateId) {
                const template = TEMPLATES.find((t) => t.id === templateId);
                if (template) {
                  handleTemplateSelect(template);
                }
              }
              e.target.value = "";
            }}
            disabled={!isConnected || isBusy}
          >
            <option value="">Choose a template...</option>
            {TEMPLATES.map((template) => (
              <option key={template.id} value={template.id}>
                {template.label}
              </option>
            ))}
          </select>
        </div>

        {selectedTemplate && (
          <div className="chat-input__agents">
            <span className="chat-input__agents-label">Involves:</span>
            {selectedTemplate.agents.map((agent) => (
              <span
                key={agent}
                className="chat-input__agent-tag"
                style={{ borderColor: AGENT_COLORS[agent] }}
              >
                <span
                  className="chat-input__agent-dot"
                  style={{ backgroundColor: AGENT_COLORS[agent] }}
                />
                {AGENT_NAMES[agent]}
              </span>
            ))}
          </div>
        )}

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
