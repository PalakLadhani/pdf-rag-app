"""
main.py
=======
FastAPI server that exposes the RAG agent over HTTP.

ENDPOINTS:
  GET  /health         -> liveness check (returns {"status": "ok"})
  POST /upload         -> accepts a PDF, returns a document_id
  POST /chat           -> {document_id, question} -> {answer}

WHY A SEPARATE PYTHON SERVICE?
------------------------------
LangGraph / LangChain / Chroma are Python-first. Rather than fight
unreliable JS ports, we run Python as a microservice and let CAP
(Node.js) talk to it over plain HTTP. This is a common enterprise
pattern: CAP handles persistence + business logic, Python handles AI.
"""

import os
import uuid
import logging
from typing import Dict

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from rag_agent import RAGAgent

# --- Logging --------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)
log = logging.getLogger("pdf-rag-api")

# --- FastAPI app ----------------------------------------------------
app = FastAPI(title="PDF RAG Agent API", version="1.0.0")

# CORS: lets the CAP backend (and the UI directly during dev) call us.
# In production we'd narrow allow_origins to specific domains.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory registry: document_id -> RAGAgent instance.
# Each uploaded PDF gets its own RAGAgent so vector stores are isolated.
# NOTE: dies on process restart. For production use Redis / a database.
AGENTS: Dict[str, RAGAgent] = {}

# Temp folder for incoming PDFs while we ingest them
TMP_DIR = "/tmp/pdf-rag"
os.makedirs(TMP_DIR, exist_ok=True)


# --- Request / response schemas -------------------------------------
class ChatRequest(BaseModel):
    document_id: str
    question: str


class ChatResponse(BaseModel):
    answer: str


class UploadResponse(BaseModel):
    document_id: str
    filename: str
    chunks: int
    message: str


# --------------------------------------------------------------------
@app.get("/health")
def health():
    """Tiny endpoint to confirm the server is up."""
    return {"status": "ok", "agents_loaded": len(AGENTS)}


# --------------------------------------------------------------------
@app.post("/upload", response_model=UploadResponse)
async def upload_pdf(file: UploadFile = File(...)):
    """
    Accept a PDF, build a RAG agent for it, return a document_id
    that the caller will use for subsequent chat requests.
    """
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted.")

    # Save upload to a temp path
    document_id = str(uuid.uuid4())
    tmp_path = os.path.join(TMP_DIR, f"{document_id}.pdf")
    try:
        contents = await file.read()
        with open(tmp_path, "wb") as f:
            f.write(contents)
        log.info(f"Saved upload {file.filename} -> {tmp_path} ({len(contents)} bytes)")

        # Build & populate the RAG agent
        agent = RAGAgent()
        n_chunks = agent.ingest_pdf(tmp_path)
        AGENTS[document_id] = agent
        log.info(f"Indexed {n_chunks} chunks for document_id={document_id}")

        return UploadResponse(
            document_id=document_id,
            filename=file.filename,
            chunks=n_chunks,
            message=f"Indexed {n_chunks} chunks. Ready to chat.",
        )
    except Exception as e:
        log.exception("Upload failed")
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")
    finally:
        # Cleanup temp file (vectors are already in memory)
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


# --------------------------------------------------------------------
@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    """
    Answer a question about a previously uploaded PDF.
    """
    agent = AGENTS.get(req.document_id)
    if agent is None:
        raise HTTPException(
            status_code=404,
            detail=f"No agent for document_id={req.document_id}. Upload a PDF first.",
        )

    log.info(f"Q (doc={req.document_id[:8]}...): {req.question[:80]}")
    try:
        answer = agent.query(req.question)
        log.info(f"A: {answer[:80]}...")
        return ChatResponse(answer=answer)
    except Exception as e:
        log.exception("Chat failed")
        raise HTTPException(status_code=500, detail=f"Chat failed: {str(e)}")


# --------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("AI_SERVICE_PORT", "8000"))
    log.info(f"Starting PDF RAG API on port {port}")
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)