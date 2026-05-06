const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const { registerChatRoutes } = require("./routes/chat");
const { registerWorkflowHandlers } = require("./controllers/workflowController");

const PORT = process.env.PORT || 3001;
const DEFAULT_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];
const EXTRA_ORIGINS = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const ALLOWED_ORIGINS = Array.from(new Set([...DEFAULT_ORIGINS, ...EXTRA_ORIGINS]));

function isOriginAllowed(origin) {
  if (!origin) return true;
  return ALLOWED_ORIGINS.includes(origin);
}

const corsOptions = {
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST"],
  credentials: true,
};

function startServer() {
  const app = express();
  app.use(cors(corsOptions));
  registerChatRoutes(app);

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: ALLOWED_ORIGINS,
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  registerWorkflowHandlers(io);

  server.listen(PORT, () => {
    console.log(`Supervisor Agent backend running on ${PORT}`);
  });
}

module.exports = { startServer };

if (require.main === module) {
  startServer();
}
