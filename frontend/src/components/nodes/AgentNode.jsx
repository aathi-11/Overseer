import { useState } from "react";
import { Handle, Position } from "reactflow";

const ROLE_LABELS = {
  requirements: "Requirements",
  developer: "Developer",
  tester: "Tester",
};

export default function AgentNode({ data }) {
  const [expanded, setExpanded] = useState(false);
  const role = data.role || "agent";
  const content = (data.content || "").replace(/```[\s\S]*?```/g, "").trim();

  return (
    <div
      className={`node-card node-${role} node-card--interactive`}
      role="button"
      tabIndex={0}
      onClick={() => setExpanded((value) => !value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setExpanded((value) => !value);
        }
      }}
    >
      <div className="node-title">
        {ROLE_LABELS[role] || "Agent"}
        {data.title ? ` / ${data.title}` : ""}
      </div>
      <div
        className={`node-content node-content--clamp ${expanded ? "expanded" : ""}`}
      >
        {content || "[No output]"}
      </div>
      <div className="node-expand-hint">
        {expanded ? "Click to collapse" : "Click to expand"}
      </div>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
