import { useMemo, useState } from "react";
import { useAgentStore } from "../store/useAgentStore.js";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "requirements", label: "Requirements" },
  { id: "developer", label: "Developer" },
  { id: "tester", label: "Tester" },
];

const ROLE_LABELS = {
  requirements: "Requirements",
  developer: "Developer",
  tester: "Tester",
};

export default function OutputPanel() {
  const outputs = useAgentStore((state) => state.agentOutputs);
  const [activeFilter, setActiveFilter] = useState("all");

  const filteredOutputs = useMemo(() => {
    if (activeFilter === "all") {
      return outputs;
    }
    return outputs.filter((output) => output.agent === activeFilter);
  }, [outputs, activeFilter]);

  return (
    <div className="output-panel">
      <div className="chat-header">
        <h2>Agent Output</h2>
        <div className="output-tabs">
          {FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              className={`output-tab ${activeFilter === filter.id ? "active" : ""}`}
              onClick={() => setActiveFilter(filter.id)}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      <div className="output-list">
        {filteredOutputs.length === 0 ? (
          <div className="chat-empty">Agent outputs will appear here.</div>
        ) : (
          filteredOutputs.map((output) => (
            <article
              key={output.id}
              className={`output-card ${output.agent || ""}`}
            >
              <header className="output-card__header">
                <div className="output-card__label">
                  {ROLE_LABELS[output.agent] || "Agent"}
                </div>
                <div className="output-card__phase">
                  {output.phase || "Step"}
                </div>
              </header>
              <div className="output-card__body">{output.content}</div>
            </article>
          ))
        )}
      </div>
    </div>
  );
}
