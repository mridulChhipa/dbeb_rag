import os
import uuid
import json
import shutil
import asyncio
import csv
import tempfile
import zipfile
from pathlib import Path
from typing import AsyncGenerator, Dict, List

from fastapi import APIRouter, Request, UploadFile, File, Header, HTTPException, Form
from fastapi.responses import StreamingResponse
from langchain_core.messages import HumanMessage, AIMessageChunk
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter

from ..models import StreamRequest
from ..core.config import settings
from ..services.llm import get_graph, session_context
from ..services.vector_store import get_global_vectorstore, add_session_documents
from ..services.evaluator import (
    extract_pdf_text,
    read_text_file,
    evaluate_candidate,
)

router = APIRouter()

@router.get("/health")
async def health():
    return {"status": "ok"}

@router.post("/stream")
async def stream(request: Request, body: StreamRequest) -> StreamingResponse:
    if not body.text:
        async def err():
            yield b"event: sse-error\n"
            yield b"data: Missing 'text' field\n\n"
        return StreamingResponse(err(), media_type="text/event-stream")

    thread_id = body.thread_id or str(uuid.uuid4())
    
    graph = get_graph()
    config = {"configurable": {"thread_id": thread_id}}

    # Construct message
    full_content = body.text
    if body.context:
        full_content = f"Context from uploaded document:\n{body.context}\n\nUser question: {body.text}"

    print(f"\n=== PROMPT TO LLM (Initial) ===\n{full_content}\n===============================\n")

    async def event_generator() -> AsyncGenerator[bytes, None]:
        # Set the context var for the session retriever tool inside the generator
        token = session_context.set(thread_id)
        try:
            message = HumanMessage(content=full_content)
            async for event in graph.astream_events({"messages": [message]}, config, version="v2"):
                if await request.is_disconnected():
                    break
                
                kind = event.get("event")
                if kind == "on_chat_model_stream":
                    chunk = event["data"]["chunk"]
                    if isinstance(chunk, AIMessageChunk) and not chunk.tool_call_chunks:
                        content = chunk.content
                        # Handle Gemini content blocks
                        if isinstance(content, list):
                            data = "".join(
                                block.get("text", "") if isinstance(block, dict) else str(block)
                                for block in content
                            )
                        else:
                            data = str(content) if content else ""
                            
                        if data:
                            yield f"event: token\n".encode("utf-8")
                            yield f"data: {data}\n\n".encode("utf-8")
            
            yield b"event: done\n"
            yield b"data: [DONE]\n\n"
            
        except Exception as e:
            err = str(e).replace("\n", " ")
            yield b"event: sse-error\n"
            yield f"data: {err}\n\n".encode("utf-8")
        finally:
            # Reset context var
            session_context.reset(token)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

@router.post("/upload-session")
async def upload_session_file(
    file: UploadFile = File(...),
    thread_id: str = Form(...)
):
    """Uploads a file to the session-specific knowledge base."""
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    temp_file_path = f"temp_session_{uuid.uuid4()}.pdf"
    try:
        with open(temp_file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        loader = PyPDFLoader(temp_file_path)
        docs = await asyncio.to_thread(loader.load)
        
        text_splitter = RecursiveCharacterTextSplitter(chunk_size=400, chunk_overlap=200)
        splits = text_splitter.split_documents(docs)
        
        # Add to session vector store
        await add_session_documents(splits, thread_id)
        
        return {"status": "ok", "message": f"Processed {len(splits)} chunks for session {thread_id}"}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)

@router.post("/upload")
async def upload_admin_file(
    file: UploadFile = File(...),
    x_admin_key: str = Header(..., alias="X-Admin-Key")
):
    """Admin upload to global knowledge base."""
    if x_admin_key != settings.ADMIN_KEY:
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
            docs = await asyncio.to_thread(loader.load)
            
            text_splitter = RecursiveCharacterTextSplitter(chunk_size=400, chunk_overlap=200)
            splits = text_splitter.split_documents(docs)
            
            total_chunks = len(splits)
            yield f"event: init\ndata: {json.dumps({'total': total_chunks})}\n\n".encode("utf-8")
            
            batch_size = 20
            vectorstore = get_global_vectorstore()
            
            for i in range(0, total_chunks, batch_size):
                batch = splits[i:i+batch_size]
                await asyncio.to_thread(vectorstore.add_documents, batch)
                
                current = min(i + batch_size, total_chunks)
                yield f"event: progress\ndata: {json.dumps({'current': current, 'total': total_chunks})}\n\n".encode("utf-8")
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
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


async def _load_text_from_path(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return await extract_pdf_text(path)
    if suffix in {".txt", ".md"}:
        return await read_text_file(path)
    raise HTTPException(status_code=400, detail=f"Unsupported criteria file type: {suffix}")


async def _load_resume_text(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return await extract_pdf_text(path)
    if suffix in {".txt", ".md"}:
        return await read_text_file(path)
    raise HTTPException(status_code=400, detail=f"Unsupported resume file type: {suffix}")


def _save_upload(upload: UploadFile, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("wb") as buffer:
        shutil.copyfileobj(upload.file, buffer)


@router.post("/evaluate-candidates")
async def evaluate_candidates(
    criteria: UploadFile = File(...),
    candidates_csv: UploadFile = File(...),
    resumes_zip: UploadFile = File(...),
):
    """Evaluates each candidate against selection criteria using the LLM."""

    temp_dir = Path(tempfile.mkdtemp(prefix="candidate_eval_"))
    resumes_dir = temp_dir / "resumes"

    criteria_path = temp_dir / (criteria.filename or "criteria")
    csv_path = temp_dir / "candidates.csv"
    resumes_archive_path = temp_dir / (resumes_zip.filename or "resumes.zip")

    try:
        _save_upload(criteria, criteria_path)
        criteria.file.close()

        _save_upload(candidates_csv, csv_path)
        candidates_csv.file.close()

        _save_upload(resumes_zip, resumes_archive_path)
        resumes_zip.file.close()

        if resumes_archive_path.suffix.lower() != ".zip":
            raise HTTPException(status_code=400, detail="Resumes archive must be a .zip file")

        with zipfile.ZipFile(resumes_archive_path, "r") as archive:
            archive.extractall(resumes_dir)

        criteria_text = await _load_text_from_path(criteria_path)

        # Build resume lookup (case-insensitive)
        resume_lookup: Dict[str, Path] = {}
        for file_path in resumes_dir.rglob("*"):
            if file_path.is_file():
                resume_lookup[file_path.name.lower()] = file_path

        with csv_path.open("r", encoding="utf-8-sig", newline="") as csv_file:
            reader = csv.DictReader(csv_file)
            if not reader.fieldnames:
                raise HTTPException(status_code=400, detail="CSV file is empty or missing headers")
            if "resume_filename" not in reader.fieldnames:
                raise HTTPException(status_code=400, detail="CSV must include a 'resume_filename' column")

            candidate_rows: List[Dict[str, str]] = list(reader)

        if not candidate_rows:
            raise HTTPException(status_code=400, detail="No candidate rows found in CSV")

        results = []
        for row in candidate_rows:
            resume_name = (row.get("resume_filename") or "").strip()
            candidate_id = row.get("candidate_id") or row.get("id") or row.get("name")

            if not resume_name:
                results.append({
                    "candidate_id": candidate_id,
                    "row": row,
                    "error": "Missing resume_filename in CSV row"
                })
                continue

            resume_path = resume_lookup.get(resume_name.lower())
            if not resume_path or not resume_path.exists():
                results.append({
                    "candidate_id": candidate_id,
                    "row": row,
                    "error": f"Resume file '{resume_name}' not found in archive"
                })
                continue

            try:
                resume_text = await _load_resume_text(resume_path)
                evaluation = await evaluate_candidate(criteria_text, row, resume_text)
                results.append({
                    "candidate_id": candidate_id,
                    "resume_filename": resume_name,
                    "row": row,
                    "evaluation": evaluation,
                })
            except HTTPException as http_err:
                results.append({
                    "candidate_id": candidate_id,
                    "row": row,
                    "error": http_err.detail,
                })
            except Exception as exc:
                results.append({
                    "candidate_id": candidate_id,
                    "row": row,
                    "error": str(exc),
                })

        return {
            "status": "ok",
            "criteria_summary_chars": len(criteria_text),
            "evaluated_candidates": results,
        }

    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
