import { create } from "zustand";
import { io } from "socket.io-client";
import { applyNodeChanges } from "reactflow";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:3001";
const LANE_ORDER = [
  "input",
  "rag",
  "decision",
  "requirements",
  "developer",
  "tester",
];
const LANE_GAP_Y = 220;
const LANE_MIN_GAP_X = 150;
const LANE_PADDING_X = 40;
const APP_PADDING_X = 48;
const PANEL_WIDTHS = 320 + 360;
const GRID_GAPS_X = 16 * 2;
const MOBILE_BREAKPOINT = 980;
const DEFAULT_CANVAS_WIDTH = 900;

function getCanvasWidth() {
  if (typeof window === "undefined") {
    return DEFAULT_CANVAS_WIDTH;
  }

  const width = window.innerWidth || DEFAULT_CANVAS_WIDTH;
  if (width <= MOBILE_BREAKPOINT) {
    return Math.max(width - APP_PADDING_X, 600);
  }

  const canvasWidth = width - APP_PADDING_X - PANEL_WIDTHS - GRID_GAPS_X;
  return Math.max(canvasWidth, 600);
}

function getLaneXPositions() {
  const width = getCanvasWidth();
  const laneCount = LANE_ORDER.length;
  const minWidth = LANE_MIN_GAP_X * (laneCount - 1);
  const usable = Math.max(width - LANE_PADDING_X * 2, minWidth);
  const gap = Math.max(LANE_MIN_GAP_X, Math.floor(usable / (laneCount - 1)));

  return LANE_ORDER.reduce((acc, lane, index) => {
    acc[lane] = LANE_PADDING_X + index * gap;
    return acc;
  }, {});
}

function getLane(payload) {
  if (payload.type === "input") {
    return "input";
  }
  if (payload.type === "decision") {
    return "decision";
  }
  if (payload.role === "requirements") {
    return "requirements";
  }
  if (payload.role === "tester") {
    return "tester";
  }
  if (payload.role === "rag") return "rag";
  return "developer";
}

function getNodeType(payload) {
  if (payload.type === "input") {
    return "inputNode";
  }
  if (payload.type === "decision") {
    return "decisionNode";
  }
  if (payload.type === "rag") return "ragNode";
  return "agentNode";
}

export const useAgentStore = create((set, get) => ({
  socket: null,
  isConnected: false,
  isBusy: false,
  lastError: null,
  nodes: [],
  edges: [],
  messages: [],
  agentOutputs: [],
  laneCounts: {
    input: 0,
    rag: 0,
    decision: 0,
    requirements: 0,
    developer: 0,
    tester: 0,
  },
  lastNodeByLane: {
    input: null,
    rag: null,
    decision: null,
    requirements: null,
    developer: null,
    tester: null,
  },
  lastInputId: null,
  lastDecisionId: null,
  lastRagId: null,
  resetCanvas: () => {
    set({
      nodes: [],
      edges: [],
      messages: [],
      agentOutputs: [],
      laneCounts: {
        input: 0,
        rag: 0,
        decision: 0,
        requirements: 0,
        developer: 0,
        tester: 0,
      },
      lastNodeByLane: {
        input: null,
        rag: null,
        decision: null,
        requirements: null,
        developer: null,
        tester: null,
      },
      lastInputId: null,
      lastDecisionId: null,
      lastRagId: null,
    });
  },
  onNodesChange: (changes) => {
    set({
      nodes: applyNodeChanges(changes, get().nodes),
    });
  },
  initSocket: () => {
    if (get().socket) {
      return;
    }

    const socket = io(SOCKET_URL, { transports: ["websocket"] });

    socket.on("connect", () => {
      set({ isConnected: true, lastError: null });
    });

    socket.on("disconnect", () => {
      set({ isConnected: false });
    });

    socket.on("node:add", (payload) => {
      get().addNode(payload);
    });

    socket.on("chat:busy", (payload) => {
      set({ isBusy: Boolean(payload && payload.busy) });
    });

    socket.on("chat:done", () => {
      set({ isBusy: false });
    });

    socket.on("chat:error", (payload) => {
      set({
        isBusy: false,
        lastError: payload && payload.message ? payload.message : "Server error",
      });
    });

    set({ socket });
  },
  sendMessage: (text) => {
    const socket = get().socket;
    if (!socket || !text) {
      return;
    }
    set({ isBusy: true, lastError: null });
    socket.emit("chat:message", { text });
  },
  addNode: (payload) => {
    if (!payload || !payload.id) {
      return;
    }

    set((state) => {
      const lane = getLane(payload);
      const laneIndex = (state.laneCounts[lane] || 0) + 1;
      const nodeType = getNodeType(payload);
      const lanePositions = getLaneXPositions();
      const position = {
        x: lanePositions[lane],
        y: (laneIndex - 1) * LANE_GAP_Y + 40,
      };

      const node = {
        id: payload.id,
        type: nodeType,
        position,
        data: payload,
      };

      const edges = [...state.edges];
      if (payload.type === "decision" && (state.lastRagId || state.lastInputId)) {
        const src = state.lastRagId || state.lastInputId;
        edges.push({
          id: `e-${src}-${payload.id}`,
          source: src,
          target: payload.id,
        });
      }
      if (payload.type === "rag" && state.lastInputId) {
        edges.push({
          id: `e-${state.lastInputId}-${payload.id}`,
          source: state.lastInputId,
          target: payload.id,
        });
      }
      if (payload.type === "agent") {
        const laneLastAgentId = state.lastNodeByLane[lane];
        const sourceId = laneLastAgentId || state.lastDecisionId || state.lastInputId;
        if (sourceId) {
          edges.push({
            id: `e-${sourceId}-${payload.id}`,
            source: sourceId,
            target: payload.id,
          });
        }
      }

      const messages = [
        ...state.messages,
        {
          id: payload.id,
          role: payload.role,
          title: payload.title,
          content: payload.content || "",
        },
      ];

      const agentOutputs =
        payload.type === "agent"
          ? [
              ...state.agentOutputs,
              {
                id: payload.id,
                agent: payload.role,
                phase: payload.title || "Step",
                content: payload.content || "",
              },
            ]
          : state.agentOutputs;

      const nextLastNodeByLane = {
        ...state.lastNodeByLane,
        [lane]: payload.id,
      };

      return {
        nodes: [...state.nodes, node],
        edges,
        messages,
        agentOutputs,
        laneCounts: {
          ...state.laneCounts,
          [lane]: laneIndex,
        },
        lastNodeByLane: nextLastNodeByLane,
        lastInputId:
          payload.type === "input" ? payload.id : state.lastInputId,
        lastDecisionId:
          payload.type === "decision" ? payload.id : state.lastDecisionId,
        lastRagId: payload.type === "rag" ? payload.id : state.lastRagId,
      };
    });
  },
}));
