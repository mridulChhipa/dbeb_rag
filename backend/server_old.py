import os
import uuid
import asyncio
import shutil
import json
from typing import AsyncGenerator

from fastapi import FastAPI, Request, UploadFile, File, Header, HTTPException
from pydantic import BaseModel
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
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter

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
api_key = os.getenv("QDRANT_API_KEY", "")
qdrant_client = QdrantClient(url=qdrant_url, prefer_grpc=False, api_key=api_key)
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

class StreamRequest(BaseModel):
    thread_id: str | None = None
    text: str
    context: str | None = None

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
            {"method": "POST", "path": "/stream", "desc": "SSE token stream (JSON body: thread_id, text, context)"},
        ],
    }

@app.post("/stream")
async def stream(request: Request, body: StreamRequest) -> StreamingResponse:
    if not body.text:
        # Return 400-like SSE error
        async def err() -> AsyncGenerator[bytes, None]:
            yield b"event: sse-error\n"
            yield b"data: Missing 'text' field\n\n"
        return StreamingResponse(err(), media_type="text/event-stream")

    thread_id = body.thread_id
    if thread_id is None or thread_id.strip() == "":
        thread_id = str(uuid.uuid4())

    config = {"configurable": {"thread_id": thread_id}}
    graph = await get_graph()

    # Construct message with optional document context
    if body.context:
        full_content = f"Context from uploaded document:\n{body.context}\n\nUser question: {body.text}"
    else:
        full_content = body.text

    async def event_generator() -> AsyncGenerator[bytes, None]:
        try:
            message = HumanMessage(content=full_content)
            async for event in graph.astream_events({"messages": [message]}, config, version="v2"):
                # Client disconnect check
                if await request.is_disconnected():
                    break
                kind = event.get("event")
                if kind == "on_chat_model_stream":
                    chunk = event["data"]["chunk"]
                    if isinstance(chunk, AIMessageChunk) and not chunk.tool_call_chunks:
                        content = chunk.content
                        # Handle Gemini's content block format: [{'type': 'text', 'text': '...'}]
                        if isinstance(content, list):
                            # Extract text from content blocks
                            data = "".join(
                                block.get("text", "") if isinstance(block, dict) else str(block)
                                for block in content
                            )
                        else:
                            data = str(content) if content else ""
                        if data:  # Only yield if there's actual text content
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

@app.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    x_admin_key: str = Header(..., alias="X-Admin-Key")
):
    admin_key = os.getenv("ADMIN_KEY", "secret-default")
    if x_admin_key != admin_key:
        raise HTTPException(status_code=401, detail="Invalid admin key")

    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    temp_file_path = f"temp_{uuid.uuid4()}.pdf"
    try:
        with open(temp_file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")

    async def process_stream():
        try:
            loader = PyPDFLoader(temp_file_path)
            # Run heavy loading in thread pool
            docs = await asyncio.to_thread(loader.load)
            
            text_splitter = RecursiveCharacterTextSplitter(chunk_size=400, chunk_overlap=200)
            splits = text_splitter.split_documents(docs)
            
            total_chunks = len(splits)
            yield f"event: init\ndata: {json.dumps({'total': total_chunks})}\n\n".encode("utf-8")
            
            batch_size = 20
            for i in range(0, total_chunks, batch_size):
                batch = splits[i:i+batch_size]
                # Run vector store addition in thread pool to avoid blocking
                await asyncio.to_thread(vectorstore.add_documents, batch)
                
                current = min(i + batch_size, total_chunks)
                yield f"event: progress\ndata: {json.dumps({'current': current, 'total': total_chunks})}\n\n".encode("utf-8")
                # Yield control to event loop
                await asyncio.sleep(0.01)
            
            yield f"event: done\ndata: {json.dumps({'message': f'Successfully processed {file.filename}'})}\n\n".encode("utf-8")
        
        except Exception as e:
            yield f"event: error\ndata: {json.dumps({'detail': str(e)})}\n\n".encode("utf-8")
        
        finally:
            if os.path.exists(temp_file_path):
                os.remove(temp_file_path)

    return StreamingResponse(
        process_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

# Optional startup to warm graph
@app.on_event("startup")
async def on_startup():
    await get_graph()
