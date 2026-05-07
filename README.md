# Supervisor Agent SDLC Canvas

Supervisor Agent SDLC Canvas is a local AI workflow simulator. A client requirement is sent to a backend over Socket.IO, a Supervisor agent decides whether the request should go to requirements, developer, tester, or a combination, and each step is rendered as a node on a React Flow canvas.

## What It Does

- Accepts a short feature request, bug description, or test request from the chat panel
- **Agentic RAG**: Automatically retrieves relevant past context or patterns from a vector database before processing
- Uses a Supervisor agent to route the request based on the enriched context
- Runs one or more SDLC-style agent workflows through Ollama
- Shows each stage as a visual node on the canvas, including RAG memory hits
- **Persistent Memory**: Saves session summaries into vector storage for future retrieval across sessions
- Keeps the conversation and node flow in memory for the current browser session

The backend currently includes these workflows:

- Requirements agent: Analyze Needs, Draft User Stories, Finalize Requirements
- Developer agent: Gather Requirements, Design, Implement, Review
- Tester agent: Understand Feature, Write Test Cases, Edge Cases, Test Report

## Tech Used

- Frontend: React 18, Vite, React Flow, Zustand, Socket.IO client
- Backend: Node.js, Express, Socket.IO
- **RAG Server**: Python, FastAPI, ChromaDB (Vector DB)
- AI: Ollama via the local `/api/chat` and `/api/embeddings` endpoints

The default model is `qwen2.5-coder:3b`, but you can override it with environment variables.

## Prerequisites

- Node.js 16 or later
- Ollama installed and running locally

If you do not already have a model, pull one before running the app:

```bash
ollama serve
ollama pull qwen2.5-coder:3b
ollama pull nomic-embed-text
```

## Install

From the project root:

```bash
cd backend
npm install

cd ../frontend
npm install
```

## Run the App

Start the RAG server (Python):

```bash
cd rag
pip install -r requirements.txt
uvicorn rag_server:app --port 8000 --reload
```

(Optional) Seed the RAG server with starter knowledge:

```bash
cd rag
python seed_knowledge.py
```

Start the backend in another terminal:

```bash
cd backend
npm run dev
```

Start the frontend in another terminal:

```bash
cd frontend
npm run dev
```

Open the Vite URL shown in the terminal, usually [http://localhost:5173](http://localhost:5173).

## Environment Variables

Backend:

```bash
PORT=3001
OLLAMA_MODEL=qwen2.5-coder:7b
OLLAMA_URL=http://localhost:11434/api/chat
```

Frontend:

```bash
VITE_SOCKET_URL=http://localhost:3001
```

If `VITE_SOCKET_URL` is not set, the frontend connects to `http://localhost:3001`.

## How To Use

1. Open the app in your browser.
2. Type a requirement, bug, or test need into the chat panel.
3. Press Send or use Enter.
4. Watch the chat and canvas fill with the client input, supervisor decision, and agent steps.

Examples you can try:

- Build a login form
- Write tests for the payment flow
- Fix the search results bug

## Project Structure

```text
rag/
  rag_server.py
  seed_knowledge.py
  requirements.txt

frontend/
  src/
    App.jsx
    components/
      ChatPanel.jsx
      AgentCanvas.jsx
      nodes/
        RagNode.jsx
    store/
      useAgentStore.js

backend/
  server.js
  agents/
    ragClient.js
    supervisorAgent.js
    requirementsAgent.js
    developerAgent.js
    testerAgent.js
    ollamaClient.js
```

## Notes

- Chat history is stored in memory for the active socket session only.
- The canvas is visual and non-editable; it reflects the agent flow as messages arrive.
- This project is intended as a local learning/demo tool, not a production workflow engine.
