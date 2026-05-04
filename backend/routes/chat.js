function registerChatRoutes(app) {
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  app.get("/api/info", (req, res) => {
    res.json({
      model: process.env.OLLAMA_MODEL || "llama3",
      url: process.env.OLLAMA_URL || "http://localhost:11434",
    });
  });
}

module.exports = {
  registerChatRoutes,
};
