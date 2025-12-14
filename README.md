<<<<<<< HEAD
# DBEB

Interactive RAG chatbot using a Python LangGraph agent and a Next.js UI.

## Components
- `agent.py`: CLI agent using LangGraph + Gemini + Qdrant.
- `server.py`: FastAPI SSE server that wraps the agent and streams responses.
- `dbebui/`: Next.js app with a chat page at `/chat` consuming the SSE stream.

## Prerequisites
- Python 3.10+
- Node.js 18+
- Qdrant running locally at `http://localhost:6333` with collection `dbeb` populated.
- A valid Google Generative AI API key in `GOOGLE_API_KEY`.

## Run (Windows, cmd.exe)

### 1) Python backend (SSE server)
```bat
cd d:\ARIES\DBEB\backend
python -m venv .venv
.venv\Scripts\activate
pip install -r ..\requirements.txt
pip install fastapi uvicorn nest_asyncio
pip install python-dotenv
rem Optional: CPU-only torch if not present
pip install torch --index-url https://download.pytorch.org/whl/cpu
copy .env.example .env
rem Edit .env and set GOOGLE_API_KEY
notepad .env
uvicorn server:app --host 127.0.0.1 --port 8000
```

### 2) Next.js frontend
```bat
cd d:\ARIES\DBEB\dbebui
npm install
npm run dev
```

Open `http://localhost:3000/chat` and start chatting.

## Notes
- CORS is enabled in `server.py` for `http://localhost:3000`.
- `server.py` streams SSE events: `token`, `done`, `error`.
- Ensure the `dbeb` Qdrant collection exists; ingestion scripts are under `Dataset_Extractor/`.
 - Backend reads environment from `backend/.env` (see `.env.example`).
=======
>>>>>>> cf09b724681b14f5fee62978d9478beacc347030
# dbeb_rag
