import ReactFlow, { Background, Controls, MarkerType } from "reactflow";
import { useMemo } from "react";
import { useAgentStore } from "../store/useAgentStore.js";
import InputNode from "./nodes/InputNode.jsx";
import DecisionNode from "./nodes/DecisionNode.jsx";
import AgentNode from "./nodes/AgentNode.jsx";

export default function AgentCanvas() {
  const nodes = useAgentStore((state) => state.nodes);
  const edges = useAgentStore((state) => state.edges);
  const onNodesChange = useAgentStore((state) => state.onNodesChange);

  const nodeTypes = useMemo(
    () => ({
      inputNode: InputNode,
      decisionNode: DecisionNode,
      agentNode: AgentNode,
    }),
    []
  );

  return (
    <div className="canvas-wrap">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          type: "straight",
          style: { stroke: "#8a7765", strokeWidth: 1.6 },
          markerEnd: { type: MarkerType.ArrowClosed },
        }}
      >
        <Background gap={18} size={1} color="rgba(120, 100, 82, 0.15)" />
        <Controls position="bottom-right" />
      </ReactFlow>
    </div>
  );
}
