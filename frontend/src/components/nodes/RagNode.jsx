import { Handle, Position } from "reactflow";
import { useState } from "react";

export default function RagNode({ data }) {
  const [expanded, setExpanded] = useState(false);
  const content = data.content || "";
  const isHit = !content.includes("No relevant past context");

  return (
    <div
      style={{
        background: isHit ? "#fefce8" : "#f8fafc",
        border: "2px solid " + (isHit ? "#f59e0b" : "#94a3b8"),
        borderRadius: 14,
        padding: "10px 14px",
        minWidth: 200,
        maxWidth: 280,
        fontSize: 12,
        fontFamily: "Space Grotesk, sans-serif",
        boxShadow: "0 2px 10px rgba(0,0,0,0.08)",
        cursor: content.length > 120 ? "pointer" : "default",
      }}
      onClick={() => setExpanded((e) => !e)}
    >
      <Handle type="target" position={Position.Left} />
      <div
        style={{
          fontWeight: 700,
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: isHit ? "#92400e" : "#64748b",
          marginBottom: 4,
        }}
      >
        {isHit ? "🔍 RAG Memory" : "🔍 RAG Memory"}
      </div>
      <div
        style={{
          fontWeight: 600,
          color: isHit ? "#78350f" : "#475569",
          marginBottom: 6,
          fontSize: 12,
        }}
      >
        {data.title || "Retrieved Context"}
      </div>
      <div
        style={{
          color: isHit ? "#92400e" : "#64748b",
          fontSize: 11,
          whiteSpace: "pre-wrap",
          lineHeight: 1.5,
          maxHeight: expanded ? "none" : 72,
          overflow: "hidden",
        }}
      >
        {content}
      </div>
      {content.length > 120 && (
        <div
          style={{
            marginTop: 6,
            fontSize: 10,
            color: isHit ? "#b45309" : "#94a3b8",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          {expanded ? "▲ collapse" : "▼ expand"}
        </div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
