from fastapi import FastAPI
from pydantic import BaseModel
import chromadb
import httpx
import json
import uuid

app = FastAPI()

chroma = chromadb.PersistentClient(path="./chroma_db")
collection = chroma.get_or_create_collection("overseer_knowledge")

OLLAMA_EMBED_URL = "http://localhost:11434/api/embeddings"
EMBED_MODEL = "nomic-embed-text"

async def get_embedding(text: str):
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.post(OLLAMA_EMBED_URL, json={
            "model": EMBED_MODEL,
            "prompt": text
        })
        data = res.json()
        return data["embedding"]

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
        collection.upsert(
            ids=[req.id],
            documents=[req.content],
            embeddings=[embedding],
            metadatas=[req.metadata]
        )
        return {"stored": True, "id": req.id}
    except Exception as e:
        return {"stored": False, "error": str(e)}

@app.get("/health")
async def health():
    return {"status": "ok", "count": collection.count()}
