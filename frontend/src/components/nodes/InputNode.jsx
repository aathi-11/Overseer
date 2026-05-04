import { Handle, Position } from "reactflow";

export default function InputNode({ data }) {
  return (
    <div className="node-card node-input">
      <div className="node-title">{data.title || "Client Input"}</div>
      <div className="node-content">{data.content}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
