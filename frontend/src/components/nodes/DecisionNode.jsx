import { Handle, Position } from "reactflow";

export default function DecisionNode({ data }) {
  return (
    <div className="node-card node-decision">
      <div className="node-title">{data.title || "Supervisor Decision"}</div>
      <div className="node-content">
        <div>Route: {data.route || "developer"}</div>
        {data.reason ? <div>{data.reason}</div> : null}
      </div>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
