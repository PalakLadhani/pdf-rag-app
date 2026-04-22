"""
rag_agent.py
============
The RAG (Retrieval-Augmented Generation) agent built with LangGraph.

WHAT IS RAG?
------------
Large language models like Gemini are smart but they don't know about
YOUR PDF. RAG fixes that:

  1. INGEST: Split the PDF into small chunks and turn each chunk into a
     vector (a list of numbers that captures meaning). Store all vectors
     in a "vector database" (Chroma).
  2. ANSWER: When the user asks a question, also turn the question into
     a vector. Find the chunks whose vectors are closest to the question
     vector — those are the most relevant pieces of the PDF. Send those
     chunks + the question to Gemini and let it write an answer.

WHY LANGGRAPH?
--------------
LangGraph models the agent as a STATE MACHINE: each step is a "node",
and edges define the order. Today our flow is simple:
    retrieve --> generate --> END
But this design lets us later add nodes like "grade relevance" or
"rewrite query" without rewriting everything.
"""

import os
from typing import TypedDict, List
from dotenv import load_dotenv

# LangChain / Google Gemini wrappers
from langchain_google_genai import (
    ChatGoogleGenerativeAI,            # Wrapper for Gemini chat models
    GoogleGenerativeAIEmbeddings,      # Wrapper for Gemini embedding models
)

# Chroma = small in-memory vector database (no separate server needed)
from langchain_community.vectorstores import Chroma

# PyPDFLoader extracts text from PDFs, one Document per page
from langchain_community.document_loaders import PyPDFLoader

# Splits long text into overlapping chunks
from langchain.text_splitter import RecursiveCharacterTextSplitter

# LangGraph primitives
from langgraph.graph import StateGraph, END

# Load .env file -> os.environ
load_dotenv()


# ----------------------------------------------------------------------
# AgentState: the shared "memory" passed between nodes in the graph
# ----------------------------------------------------------------------
# TypedDict gives us type hints while still being a regular dict.
class AgentState(TypedDict):
    question: str        # The user's question
    documents: List      # Chunks retrieved from the vector DB
    answer: str          # Final answer from the LLM


class RAGAgent:
    """
    One RAGAgent instance = one uploaded PDF. We keep them isolated so
    multiple users / documents don't pollute each other's vector stores.
    """

    def __init__(self):
        # ---- Read config from .env ----------------------------------
        api_key = os.getenv("GOOGLE_API_KEY")
        if not api_key or api_key.startswith("AIzaSy__REPLACE"):
            raise RuntimeError(
                "GOOGLE_API_KEY is missing or still set to the placeholder. "
                "Edit python-ai/.env and put your real Gemini API key."
            )

        chat_model      = os.getenv("GEMINI_MODEL",   "gemini-2.5-flash")
        embedding_model = os.getenv("EMBEDDING_MODEL","models/text-embedding-004")

        # ---- The chat LLM that writes final answers -----------------
        # temperature=0.2 -> mostly factual, a tiny bit of variety
        self.llm = ChatGoogleGenerativeAI(
            model=chat_model,
            temperature=0.2,
            google_api_key=api_key,
        )

        # ---- Embedding model that turns text into vectors -----------
        self.embeddings = GoogleGenerativeAIEmbeddings(
            model=embedding_model,
            google_api_key=api_key,
        )

        # Will hold the Chroma vector DB after ingest_pdf() runs
        self.vectorstore = None

        # Build the LangGraph state machine once; reuse for every query
        self.graph = self._build_graph()

    # ------------------------------------------------------------------
    # INGESTION: PDF -> chunks -> embeddings -> vector DB
    # ------------------------------------------------------------------
    def ingest_pdf(self, file_path: str) -> int:
        """
        Read a PDF, split into chunks, embed, and store in Chroma.
        Returns the number of chunks (useful for logs/UI).
        """

        # 1. Load PDF -> one LangChain Document per page
        loader = PyPDFLoader(file_path)
        pages = loader.load()

        # 2. Split each page into smaller overlapping chunks.
        #    chunk_size = max characters per chunk (~250 tokens).
        #    chunk_overlap = preserves context across boundaries so a
        #    sentence cut in half still appears whole in one chunk.
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200,
        )
        chunks = splitter.split_documents(pages)

        # 3. Embed all chunks and store in Chroma. Chroma.from_documents
        #    calls self.embeddings on every chunk under the hood.
        #    No persist_directory => everything lives in RAM (fine for
        #    a demo; for production you'd persist to disk).
        self.vectorstore = Chroma.from_documents(
            documents=chunks,
            embedding=self.embeddings,
        )
        return len(chunks)

    # ------------------------------------------------------------------
    # LANGGRAPH NODES
    # ------------------------------------------------------------------
    # Each node is a function: state -> partial state update.
    # LangGraph merges the returned dict into the overall state.

    def _retrieve(self, state: AgentState) -> dict:
        """Node 1: find the top-k most relevant chunks for the question."""
        question = state["question"]
        # k=4 -> return the 4 most semantically similar chunks
        docs = self.vectorstore.similarity_search(question, k=4)
        return {"documents": docs}

    def _generate(self, state: AgentState) -> dict:
        """Node 2: feed retrieved chunks + question to the LLM."""
        question = state["question"]
        docs = state["documents"]

        # Combine all chunk texts into one context block
        context = "\n\n---\n\n".join(d.page_content for d in docs)

        # Prompt engineering:
        #  - tell the model it's a Q&A assistant
        #  - instruct it to ONLY use the provided context (reduces hallucination)
        #  - tell it to admit when it doesn't know
        prompt = f"""You are a helpful assistant that answers questions about a PDF document.
Use ONLY the context below to answer. If the answer is not in the context,
reply: "I could not find this in the document."

Context:
{context}

Question: {question}

Answer in clear, concise language."""

        response = self.llm.invoke(prompt)
        # response is a LangChain AIMessage; .content is the plain text
        return {"answer": response.content}

    # ------------------------------------------------------------------
    # GRAPH DEFINITION
    # ------------------------------------------------------------------
    def _build_graph(self):
        """Wire the nodes into a state machine."""
        workflow = StateGraph(AgentState)

        # Register nodes by name
        workflow.add_node("retrieve", self._retrieve)
        workflow.add_node("generate", self._generate)

        # Control flow: start -> retrieve -> generate -> END
        workflow.set_entry_point("retrieve")
        workflow.add_edge("retrieve", "generate")
        workflow.add_edge("generate", END)

        # .compile() turns the definition into something we can .invoke()
        return workflow.compile()

    # ------------------------------------------------------------------
    # PUBLIC API
    # ------------------------------------------------------------------
    def query(self, question: str) -> str:
        """Run the full graph for one user question and return the answer."""
        if self.vectorstore is None:
            return "No document has been ingested yet."

        initial_state: AgentState = {
            "question": question,
            "documents": [],
            "answer": "",
        }
        final_state = self.graph.invoke(initial_state)
        return final_state["answer"]