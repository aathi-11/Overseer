from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import chromadb
import httpx
import logging

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

chroma = chromadb.PersistentClient(path="./chroma_db")
collection = chroma.get_or_create_collection("overseer_knowledge")

OLLAMA_EMBED_URL = "http://localhost:11434/api/embeddings"
EMBED_MODEL = "nomic-embed-text"

async def get_embedding(text: str):
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            res = await client.post(OLLAMA_EMBED_URL, json={
                "model": EMBED_MODEL,
                "prompt": text
            })
            res.raise_for_status()
            data = res.json()
            return data.get("embedding")
    except Exception:
        return None

class QueryRequest(BaseModel):
    query: str
    n_results: int = 3

class StoreRequest(BaseModel):
    id: str
    content: str
    metadata: dict = {}

@app.post("/query")
async def query_knowledge(req: QueryRequest):
    try:
        count = collection.count()
        if count == 0:
            return {"chunks": [], "ids": [], "found": 0}
        actual_n = min(req.n_results, count)
        embedding = await get_embedding(req.query)
        if not embedding:
            return {"chunks": [], "ids": [], "found": 0, "error": "embedding_failed"}
        results = collection.query(
            query_embeddings=[embedding],
            n_results=actual_n
        )
        docs = results["documents"][0] if results["documents"] else []
        ids = results["ids"][0] if results["ids"] else []
        return {"chunks": docs, "ids": ids, "found": len(docs)}
    except Exception as e:
        return {"chunks": [], "ids": [], "found": 0, "error": str(e)}

@app.post("/store")
async def store_knowledge(req: StoreRequest):
    try:
        embedding = await get_embedding(req.content)
        if not embedding:
            return {"stored": False, "error": "embedding_failed"}
        collection.upsert(
            ids=[req.id],
            documents=[req.content],
            embeddings=[embedding],
            metadatas=[req.metadata]
        )
        return {"stored": True, "id": req.id}
    except Exception as e:
        return {"stored": False, "error": str(e)}

@app.on_event("startup")
async def on_startup():
    try:
        count = collection.count()
        logging.info("RAG server ready. Collection size: %s", count)
    except Exception as e:
        logging.warning("RAG server startup check failed: %s", e)

@app.get("/health")
async def health():
    return {"status": "ok", "count": collection.count()}
