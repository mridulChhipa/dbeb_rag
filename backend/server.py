import os
import uuid
import asyncio
from typing import AsyncGenerator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from langgraph.prebuilt import ToolNode, tools_condition
from langgraph.graph import StateGraph, MessagesState
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from langchain_core.tools import Tool
from langchain_core.messages import HumanMessage, AIMessageChunk

from langchain_huggingface import HuggingFaceEmbeddings
from langchain_qdrant import QdrantVectorStore
from qdrant_client import QdrantClient
from langchain_google_genai import ChatGoogleGenerativeAI

import torch
import nest_asyncio
from dotenv import load_dotenv
nest_asyncio.apply()

# Environment setup
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"), override=False)
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
if not GOOGLE_API_KEY:
    raise RuntimeError("GOOGLE_API_KEY environment variable is required.")

# Initialize embeddings and vector store
if torch.cuda.is_available():
    device = "cuda"
else:
    device = "cpu"

embeddings = HuggingFaceEmbeddings(
    model_name="sentence-transformers/all-MiniLM-L6-v2",
    model_kwargs={"device": device},
)

qdrant_url = os.getenv("QDRANT_URL", "http://localhost:6333")
qdrant_client = QdrantClient(url=qdrant_url, prefer_grpc=False)
vectorstore = QdrantVectorStore(
    client=qdrant_client,
    collection_name="dbeb",
    embedding=embeddings,
)
retriever = vectorstore.as_retriever()

# LLM setup
llm = ChatGoogleGenerativeAI(model="gemini-2.5-flash", temperature=0.5)
retriever_tool = Tool(
    name="document_retriever",
    description="Searches and returns relevant information and context from a knowledge base of documents.",
    func=retriever.invoke,
)
llm_with_tools = llm.bind_tools([retriever_tool])

class State(MessagesState):
    pass

# Build graph once at startup (without persistent checkpointer to avoid thread lifecycle issues)
async def build_graph():
    workflow = StateGraph(State)

    async def agent_node(state: State):
        messages = state["messages"]
        response = await llm_with_tools.ainvoke(messages)
        return {"messages": [response]}

    tool_node = ToolNode(tools=[retriever_tool])

    workflow.add_node("agent", agent_node)
    workflow.add_node("tools", tool_node)
    workflow.set_entry_point("agent")
    workflow.add_conditional_edges("agent", tools_condition)
    workflow.add_edge("tools", "agent")

    graph = workflow.compile()
    return graph

_graph = None
_graph_lock = asyncio.Lock()

async def get_graph():
    global _graph
    async with _graph_lock:
        if _graph is None:
            _graph = await build_graph()
    return _graph

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.get("/")
async def index():
    return {
        "service": "DBEB RAG SSE backend",
        "status": "ok",
        "endpoints": [
            {"method": "GET", "path": "/health", "desc": "Service health"},
            {"method": "GET", "path": "/stream?thread_id&text", "desc": "SSE token stream"},
        ],
    }

@app.get("/stream")
async def stream(request: Request, thread_id: str | None = None, text: str | None = None) -> StreamingResponse:
    if not text:
        # Return 400-like SSE error
        async def err() -> AsyncGenerator[bytes, None]:
            yield b"event: sse-error\n"
            yield b"data: Missing 'text' query parameter\n\n"
        return StreamingResponse(err(), media_type="text/event-stream")

    if thread_id is None or thread_id.strip() == "":
        thread_id = str(uuid.uuid4())

    config = {"configurable": {"thread_id": thread_id}}
    graph = await get_graph()

    async def event_generator() -> AsyncGenerator[bytes, None]:
        try:
            message = HumanMessage(content=text)
            async for event in graph.astream_events({"messages": [message]}, config, version="v2"):
                # Client disconnect check
                if await request.is_disconnected():
                    break
                kind = event.get("event")
                if kind == "on_chat_model_stream":
                    chunk = event["data"]["chunk"]
                    if isinstance(chunk, AIMessageChunk) and not chunk.tool_call_chunks:
                        data = str(chunk.content)
                        yield f"event: token\n".encode("utf-8")
                        yield f"data: {data}\n\n".encode("utf-8")
            # done
            yield b"event: done\n"
            yield b"data: [DONE]\n\n"
        except Exception as e:
            err = str(e).replace("\n", " ")
            yield b"event: sse-error\n"
            yield f"data: {err}\n\n".encode("utf-8")

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # disable buffering on some proxies
        },
    )

# Optional startup to warm graph
@app.on_event("startup")
async def on_startup():
    await get_graph()
