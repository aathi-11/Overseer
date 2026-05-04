import { Handle, Position } from "reactflow";

export default function DecisionNode({ data }) {
  return (
    <div className="node-card node-decision">
      <div className="node-title">{data.title || "Supervisor Decision"}</div>
      <div className="node-content">
        Route: {data.route || "developer"}
        {data.reason ? `\n${data.reason}` : ""}
      </div>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
