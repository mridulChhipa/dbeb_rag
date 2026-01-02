# DBEB Agent

Unified AI Agent for document intelligence built with FastAPI + LangGraph backend and Next.js 15 frontend.

## Key Features

- **Unified AI Agent**: Single chat interface that automatically routes to the right workflow based on your intent.
- **Smart Intent Classification**: The agent understands whether you want to chat, ingest documents, or evaluate candidates.
- **RAG-Powered Chat**: Retrieval-augmented responses using LangGraph orchestration and Gemini Flash.
- **Document Ingestion**: Add PDFs to the permanent knowledge base through natural conversation.
- **Candidate Evaluation**: Upload CSV + resumes ZIP and get automated screening with LLM-backed reasoning.
- **Streaming Responses**: Real-time token streaming for all operations.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (Next.js)                        │
│                     Single Page AI Agent UI                      │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    POST /agent (Unified Endpoint)                │
├─────────────────────────────────────────────────────────────────┤
│  1. Receive message + files                                      │
│  2. Classify intent (heuristics + LLM fallback)                  │
│  3. Route to handler:                                            │
│     ├─ chat → RAG pipeline with LangGraph                        │
│     ├─ ingest → Add documents to Qdrant                          │
│     └─ evaluate → Batch candidate screening                      │
│  4. Stream results back                                          │
└─────────────────────────────────────────────────────────────────┘
```

## Project Layout

```
backend/app/
├── main.py                  # FastAPI entrypoint
├── api/
│   ├── agent_endpoint.py    # Unified /agent endpoint
│   └── endpoints.py         # Legacy endpoints
└── services/
    ├── agent_router.py      # Intent classification
    ├── llm.py               # LangGraph workflow
    ├── evaluator.py         # Candidate evaluation
    └── vector_store.py      # Qdrant integration

dbebui/                      # Next.js single-page agent UI
```

## Requirements

- Python 3.10+
- Node.js 18+
- Qdrant instance (local or remote)
- Google Generative AI API key (`GOOGLE_API_KEY`)

## Backend Setup

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -r ../requirements.txt
uvicorn backend.app.main:app --reload --port 8000
```

Environment variables in `backend/.env`:
```
GOOGLE_API_KEY=...
ADMIN_KEY=...
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=
```

## API Endpoints

### Primary Endpoint

**POST /agent** — Unified AI agent endpoint

Form fields:
- `message`: Your text prompt
- `thread_id` (optional): Session ID for conversation continuity
- `files` (optional): One or more file uploads

The agent classifies your intent and routes to:
- **chat**: RAG-powered Q&A
- **ingest**: Add documents to knowledge base
- **evaluate**: Batch candidate screening

Response: Server-Sent Events stream with `intent`, `token`, `results`, `done` events.

### Legacy Endpoints

- `POST /stream` — Direct chat stream
- `POST /upload` — Admin PDF ingestion (requires `X-Admin-Key` header)
- `POST /evaluate-candidates` — Direct candidate evaluation

## Frontend Setup

```bash
cd dbebui
npm install
npm run dev
```

Open `http://localhost:3000` to use the unified agent interface.

## Usage

### Chat / Q&A
Just type your question. The agent will search the knowledge base and respond.

### Ingest Documents
Upload a PDF and say "Add this to the knowledge base" or "Ingest this document".

### Evaluate Candidates
Upload three files:
1. **Criteria document** (PDF/TXT): Selection requirements
2. **Candidates CSV**: Must include `resume_filename` column
3. **Resumes ZIP**: Archive containing the resume files

Then say "Evaluate these candidates" and the agent will process each one.
