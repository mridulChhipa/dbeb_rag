# DBEB

Interactive Retrieval-Augmented Generation (RAG) system combining a Python LangGraph backend with a Next.js 15 frontend.

## Project Layout
- `backend/app/`
	- `main.py`: FastAPI entrypoint (`uvicorn backend.app.main:app`).
	- `api/endpoints.py`: SSE chat stream, admin upload, and session upload routes.
	- `services/`: LangGraph agent and Qdrant helpers.
	- `core/config.py`: Environment loading (`backend/.env`).
- `dbebui/`: Next.js UI (chat at `/chat`, admin upload at `/admin`).
- `Dataset_Extractor/`: Utilities for ingesting source PDFs.
- `agent.py`: CLI helper for the LangGraph workflow (optional).

## Requirements
- Python 3.10+
- Node.js 18+
- Qdrant instance (local or remote). The backend auto-creates collections `dbeb` and `dbeb_sessions` plus payload indexes when it starts.
- Google Generative AI API key with access to Gemini Flash (`GOOGLE_API_KEY`).

## Backend Setup (Windows `cmd`)
```bat
cd d:\ARIES\DBEB_RAG\backend
python -m venv .venv
.venv\Scripts\activate
pip install -r ..\requirements.txt
uvicorn backend.app.main:app --reload --port 8000
```

Environment variables are read from `backend/.env`. Minimum keys:
```
GOOGLE_API_KEY=...
ADMIN_KEY=...
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=
```

### API Endpoints
- `POST /stream` — Streams chat tokens (`event: token|done|sse-error`). Pass `thread_id` to reuse a session.
- `POST /upload` — Admin-only PDF ingestion into the global knowledge base (`X-Admin-Key` header).
- `POST /upload-session` — Uploads a PDF for the active chat session (form fields `file`, `thread_id`). Documents are stored in the temporary `dbeb_sessions` collection using metadata filters.

## Frontend Setup
```bat
cd d:\ARIES\DBEB_RAG\dbebui
npm install
npm run dev
```

Open `http://localhost:3000/chat` to use the chatbot. The admin panel is available at `http://localhost:3000/admin`.

## Notes
- The chat UI supports drag-and-drop PDF uploads; the frontend should call `/upload-session` with the current `thread_id` for per-session context.
- Admin uploads stream two progress indicators: raw upload and Qdrant ingestion.
- Console logging is enabled on the backend (`PROMPT TO LLM`, `AGENT NODE MESSAGES`) for debugging.
