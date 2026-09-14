import React, { useCallback, useMemo } from "react";
import { createRoot } from "react-dom/client";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from "reactflow";
import "reactflow/dist/style.css";

type FlowGraphPayload = {
  nodes: { id: string; path: string; layer: string; label: string }[];
  edges: { id: string; source: string; target: string }[];
  suggestedOrder: string[];
};

declare global {
  interface Window {
    __REVIEW_KIT_GRAPH__?: FlowGraphPayload;
  }
}

const vscodeApi = acquireVsCodeApi();

const layerColor: Record<string, string> = {
  controller: "#4ea1ff",
  service: "#6bcb77",
  repository: "#ffd166",
  model: "#ef476f",
  dto: "#9b5de5",
  config: "#888",
  other: "#aaa",
};

function App({ graph }: { graph: FlowGraphPayload }) {
  const [activePath, setActivePath] = React.useState<string | undefined>();

  React.useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "highlight" && event.data.path) {
        setActivePath(event.data.path as string);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const nodes: Node[] = useMemo(
    () =>
      graph.nodes.map((n, index) => ({
        id: n.id,
        data: { label: `${n.label}\n(${n.layer})` },
        position: { x: (index % 4) * 220, y: Math.floor(index / 4) * 120 },
        style: {
          border: n.path === activePath ? "2px solid #fff" : "1px solid #555",
          background: layerColor[n.layer] ?? layerColor.other,
          color: "#111",
          fontSize: 11,
          width: 180,
        },
      })),
    [graph.nodes, activePath],
  );

  const edges: Edge[] = useMemo(
    () =>
      graph.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        animated: true,
      })),
    [graph.edges],
  );

  const onNodeClick: NodeMouseHandler = useCallback((_evt, node) => {
    setActivePath(node.id);
    vscodeApi.postMessage({ type: "openFile", path: node.id });
  }, []);

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <ReactFlow nodes={nodes} edges={edges} onNodeClick={onNodeClick} fitView>
        <MiniMap />
        <Controls />
        <Background gap={16} />
      </ReactFlow>
    </div>
  );
}

const container = document.getElementById("root");
const graph = window.__REVIEW_KIT_GRAPH__;
if (container && graph) {
  createRoot(container).render(<App graph={graph} />);
}

function acquireVsCodeApi(): { postMessage: (msg: unknown) => void } {
  const w = window as unknown as { acquireVsCodeApi?: () => { postMessage: (m: unknown) => void } };
  return w.acquireVsCodeApi?.() ?? { postMessage: () => undefined };
}
