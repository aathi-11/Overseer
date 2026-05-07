from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import chromadb
import httpx
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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
    except Exception as e:
        logger.warning("Embedding failed: %s", e)
        return None

class QueryRequest(BaseModel):
    query: str
    n_results: int = 3
    # Optional metadata filter for per-agent RAG queries
    # e.g. {"type": "pattern"} or {"type": "test"} or {"type": "requirement"}
    where: Optional[dict] = None

class StoreRequest(BaseModel):
    id: str
    content: str
    metadata: dict = {}

@app.post("/query")
async def query_knowledge(req: QueryRequest):
    try:
        count = collection.count()
        if count == 0:
            return {"chunks": [], "ids": [], "distances": [], "found": 0}
        actual_n = min(req.n_results, count)
        embedding = await get_embedding(req.query)
        if not embedding:
            return {"chunks": [], "ids": [], "distances": [], "found": 0, "error": "embedding_failed"}

        query_kwargs = {
            "query_embeddings": [embedding],
            "n_results": actual_n,
            "include": ["documents", "distances", "metadatas"],
        }
        # Apply metadata filter only when provided and non-empty
        if req.where and isinstance(req.where, dict) and len(req.where) > 0:
            query_kwargs["where"] = req.where

        results = collection.query(**query_kwargs)
        docs = results["documents"][0] if results["documents"] else []
        ids = results["ids"][0] if results["ids"] else []
        distances = results["distances"][0] if results.get("distances") else []
        metadatas = results["metadatas"][0] if results.get("metadatas") else []

        # Filter out very low-relevance results (cosine distance > 1.5)
        filtered = [
            (d, i, m) for d, i, dist, m in zip(docs, ids, distances, metadatas)
            if dist < 1.5
        ]
        final_docs = [x[0] for x in filtered]
        final_ids = [x[1] for x in filtered]

        return {"chunks": final_docs, "ids": final_ids, "found": len(final_docs)}
    except Exception as e:
        logger.error("Query error: %s", e)
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
        logger.info("Stored document id=%s type=%s", req.id, req.metadata.get("type", "unknown"))
        return {"stored": True, "id": req.id}
    except Exception as e:
        logger.error("Store error: %s", e)
        return {"stored": False, "error": str(e)}

@app.on_event("startup")
async def on_startup():
    try:
        count = collection.count()
        logger.info("RAG server ready. Collection size: %s documents.", count)
        if count == 0:
            logger.warning("RAG collection is empty — run seed_knowledge.py to populate it.")
    except Exception as e:
        logger.warning("RAG server startup check failed: %s", e)

@app.get("/health")
async def health():
    count = collection.count()
    return {"status": "ok", "count": count}
