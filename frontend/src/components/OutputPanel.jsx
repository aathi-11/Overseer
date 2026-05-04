import { useState } from "react";
import { useAgentStore } from "../store/useAgentStore.js";

const ROLE_LABELS = {
  requirements: "Requirements Analyst",
  developer: "Developer",
  tester: "Tester",
};

const TABS = ["all", "requirements", "developer", "tester"];

export default function OutputPanel() {
  const [activeTab, setActiveTab] = useState("all");
  const agentOutputs = useAgentStore((state) => state.agentOutputs);

  const visibleOutputs =
    activeTab === "all"
      ? agentOutputs
      : agentOutputs.filter((output) => output.agent === activeTab);

  const renderContent = (text) => {
    if (!text) return "";
    const parts = text.split(/(```[\s\S]*?```)/g);
    return parts.map((part, index) => {
      if (part.startsWith("```")) {
        const code = part.replace(/```\w*\n?/, "").replace(/```$/, "");
        return (
          <pre
            key={index}
            style={{
              backgroundColor: "#1e1e1e",
              color: "#d4d4d4",
              padding: "12px",
              borderRadius: "8px",
              overflowX: "auto",
              margin: "8px 0",
              fontFamily: "monospace",
              fontSize: "13px",
            }}
          >
            <code>{code}</code>
          </pre>
        );
      }
      return <span key={index}>{part}</span>;
    });
  };

  return (
    <div className="chat output-panel">
      <div className="chat-header">
        <h2>Agent Outputs</h2>
        <div className="output-tabs" role="tablist" aria-label="Agent outputs filter">
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              className={`output-tab ${activeTab === tab ? "active" : ""}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="output-list">
        {visibleOutputs.length === 0 ? (
          <div className="chat-empty">
            Agent output will appear here as the workflows run.
          </div>
        ) : (
          visibleOutputs.map((output) => (
            <article key={output.id} className={`output-card ${output.agent}`}>
              <div className="output-card__header">
                <div className="output-card__label">
                  {ROLE_LABELS[output.agent] || "Agent"}
                </div>
                <div className="output-card__phase">{output.phase}</div>
              </div>
              <div className="output-card__body">{renderContent(output.content)}</div>
            </article>
          ))
        )}
      </div>
    </div>
  );
}
