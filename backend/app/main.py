import nest_asyncio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .api.endpoints import router
from .api.agent_endpoint import router as agent_router
from .services.vector_store import ensure_collections_exist

# Apply nest_asyncio for LangGraph/Jupyter compatibility if needed
nest_asyncio.apply()

app = FastAPI(title="DBEB RAG Backend")

@app.on_event("startup")
async def startup_event():
    ensure_collections_exist()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
app.include_router(agent_router)

@app.get("/")
async def index():
    return {
        "service": "DBEB RAG Agent Backend",
        "status": "ok",
        "endpoints": [
            {"method": "GET", "path": "/health", "desc": "Service health"},
            {"method": "POST", "path": "/agent", "desc": "Unified AI agent endpoint"},
            {"method": "POST", "path": "/stream", "desc": "Legacy chat stream"},
        ],
    }
