"""
Unified Agent Endpoint
Handles all user interactions through a single intelligent agent.
"""
import os
import uuid
import json
import shutil
import asyncio
import csv
import tempfile
import zipfile
from pathlib import Path
from typing import AsyncGenerator, Dict, List, Optional

from fastapi import APIRouter, Request, UploadFile, File, Form, HTTPException
from fastapi.responses import StreamingResponse
from langchain_core.messages import HumanMessage, AIMessageChunk
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter

from ..services.agent_router import route_intent, IntentClassification
from ..services.llm import get_graph, session_context
from ..services.vector_store import get_global_vectorstore, add_session_documents
from ..services.evaluator import extract_pdf_text, read_text_file, evaluate_candidate

router = APIRouter()


async def _extract_file_text(file_path: Path) -> str:
    """Extract text from a file based on its extension."""
    suffix = file_path.suffix.lower()
    if suffix == ".pdf":
        return await extract_pdf_text(file_path)
    elif suffix in {".txt", ".md"}:
        return await read_text_file(file_path)
    else:
        return file_path.read_text(encoding="utf-8", errors="ignore")


async def _handle_chat(
    request: Request,
    message: str,
    thread_id: str,
    context: Optional[str] = None
) -> AsyncGenerator[bytes, None]:
    """Handle chat intent - Q&A with RAG."""
    graph = get_graph()
    config = {"configurable": {"thread_id": thread_id}}
    
    full_content = message
    if context:
        full_content = f"Context from uploaded document:\n{context}\n\nUser question: {message}"
    
    token = session_context.set(thread_id)
    try:
        msg = HumanMessage(content=full_content)
        async for event in graph.astream_events({"messages": [msg]}, config, version="v2"):
            if await request.is_disconnected():
                break
            
            kind = event.get("event")
            if kind == "on_chat_model_stream":
                chunk = event["data"]["chunk"]
                if isinstance(chunk, AIMessageChunk) and not chunk.tool_call_chunks:
                    content = chunk.content
                    if isinstance(content, list):
                        data = "".join(
                            block.get("text", "") if isinstance(block, dict) else str(block)
                            for block in content
                        )
                    else:
                        data = str(content) if content else ""
                    
                    if data:
                        yield f"event: token\ndata: {data}\n\n".encode("utf-8")
        
        yield b"event: done\ndata: [DONE]\n\n"
    except Exception as e:
        err = str(e).replace("\n", " ")
        yield f"event: error\ndata: {err}\n\n".encode("utf-8")
    finally:
        session_context.reset(token)


async def _handle_ingest(
    file_paths: List[Path],
    message: str
) -> AsyncGenerator[bytes, None]:
    """Handle ingest intent - add documents to global knowledge base."""
    yield f"event: status\ndata: {json.dumps({'type': 'ingest', 'status': 'starting'})}\n\n".encode("utf-8")
    
    try:
        all_splits = []
        text_splitter = RecursiveCharacterTextSplitter(chunk_size=400, chunk_overlap=200)
        
        for file_path in file_paths:
            if file_path.suffix.lower() == ".pdf":
                loader = PyPDFLoader(str(file_path))
                docs = await asyncio.to_thread(loader.load)
                splits = text_splitter.split_documents(docs)
                all_splits.extend(splits)
                yield f"event: progress\ndata: {json.dumps({'file': file_path.name, 'chunks': len(splits)})}\n\n".encode("utf-8")
            elif file_path.suffix.lower() in {".txt", ".md"}:
                text = await read_text_file(file_path)
                from langchain_core.documents import Document
                doc = Document(page_content=text, metadata={"source": file_path.name})
                splits = text_splitter.split_documents([doc])
                all_splits.extend(splits)
                yield f"event: progress\ndata: {json.dumps({'file': file_path.name, 'chunks': len(splits)})}\n\n".encode("utf-8")
        
        if not all_splits:
            yield f"event: error\ndata: No documents to ingest\n\n".encode("utf-8")
            return
        
        total_chunks = len(all_splits)
        yield f"event: status\ndata: {json.dumps({'status': 'ingesting', 'total_chunks': total_chunks})}\n\n".encode("utf-8")
        
        vectorstore = get_global_vectorstore()
        batch_size = 20
        
        for i in range(0, total_chunks, batch_size):
            batch = all_splits[i:i+batch_size]
            await asyncio.to_thread(vectorstore.add_documents, batch)
            current = min(i + batch_size, total_chunks)
            yield f"event: progress\ndata: {json.dumps({'current': current, 'total': total_chunks})}\n\n".encode("utf-8")
            await asyncio.sleep(0.01)
        
        # Send a chat-like completion message
        yield f"event: token\ndata: ✅ Successfully ingested {len(file_paths)} document(s) with {total_chunks} chunks into the knowledge base.\n\n".encode("utf-8")
        yield b"event: done\ndata: [DONE]\n\n"
        
    except Exception as e:
        yield f"event: error\ndata: {str(e)}\n\n".encode("utf-8")


async def _handle_evaluate(
    file_paths: List[Path],
    message: str
) -> AsyncGenerator[bytes, None]:
    """Handle evaluate intent - candidate evaluation workflow."""
    yield f"event: status\ndata: {json.dumps({'type': 'evaluate', 'status': 'starting'})}\n\n".encode("utf-8")
    
    try:
        # Find criteria, CSV, and ZIP files
        criteria_path = None
        csv_path = None
        zip_path = None
        
        for fp in file_paths:
            suffix = fp.suffix.lower()
            if suffix in {".pdf", ".txt", ".md"} and not criteria_path:
                criteria_path = fp
            elif suffix == ".csv":
                csv_path = fp
            elif suffix == ".zip":
                zip_path = fp
        
        if not criteria_path or not csv_path or not zip_path:
            missing = []
            if not criteria_path:
                missing.append("criteria document (PDF/TXT)")
            if not csv_path:
                missing.append("candidates CSV")
            if not zip_path:
                missing.append("resumes ZIP archive")
            yield f"event: token\ndata: ❌ Missing required files: {', '.join(missing)}\n\n".encode("utf-8")
            yield b"event: done\ndata: [DONE]\n\n"
            return
        
        # Extract criteria text
        criteria_text = await _extract_file_text(criteria_path)
        
        # Extract resumes from ZIP
        resumes_dir = zip_path.parent / "resumes"
        resumes_dir.mkdir(exist_ok=True)
        
        with zipfile.ZipFile(zip_path, "r") as archive:
            archive.extractall(resumes_dir)
        
        # Build resume lookup
        resume_lookup: Dict[str, Path] = {}
        for file_path in resumes_dir.rglob("*"):
            if file_path.is_file():
                resume_lookup[file_path.name.lower()] = file_path
        
        # Read CSV
        with csv_path.open("r", encoding="utf-8-sig", newline="") as csv_file:
            reader = csv.DictReader(csv_file)
            if not reader.fieldnames or "resume_filename" not in reader.fieldnames:
                yield f"event: token\ndata: ❌ CSV must include a 'resume_filename' column\n\n".encode("utf-8")
                yield b"event: done\ndata: [DONE]\n\n"
                return
            candidate_rows = list(reader)
        
        if not candidate_rows:
            yield f"event: token\ndata: ❌ No candidate rows found in CSV\n\n".encode("utf-8")
            yield b"event: done\ndata: [DONE]\n\n"
            return
        
        yield f"event: token\ndata: 📋 Evaluating {len(candidate_rows)} candidates...\n\n".encode("utf-8")
        
        results = []
        for idx, row in enumerate(candidate_rows):
            resume_name = (row.get("resume_filename") or "").strip()
            candidate_id = row.get("candidate_id") or row.get("id") or row.get("name") or f"Candidate {idx+1}"
            
            if not resume_name:
                results.append({
                    "candidate_id": candidate_id,
                    "error": "Missing resume_filename"
                })
                continue
            
            resume_path = resume_lookup.get(resume_name.lower())
            if not resume_path:
                results.append({
                    "candidate_id": candidate_id,
                    "error": f"Resume '{resume_name}' not found"
                })
                continue
            
            try:
                resume_text = await _extract_file_text(resume_path)
                evaluation = await evaluate_candidate(criteria_text, row, resume_text)
                results.append({
                    "candidate_id": candidate_id,
                    "evaluation": evaluation
                })
                
                # Stream progress - just status, not the full reasoning
                status = "✅" if evaluation.get("meets_requirements") else "❌"
                yield f"event: token\ndata: {status} {candidate_id}\n\n".encode("utf-8")
                
            except Exception as exc:
                results.append({
                    "candidate_id": candidate_id,
                    "error": str(exc)
                })
        
        # Send final summary
        passed = sum(1 for r in results if r.get("evaluation", {}).get("meets_requirements"))
        total = len(results)
        
        yield f"event: token\ndata: \n\n---\n**Summary:** {passed}/{total} candidates meet requirements.\n\n".encode("utf-8")
        yield f"event: results\ndata: {json.dumps({'evaluated_candidates': results})}\n\n".encode("utf-8")
        yield b"event: done\ndata: [DONE]\n\n"
        
    except Exception as e:
        yield f"event: error\ndata: {str(e)}\n\n".encode("utf-8")


@router.post("/agent")
async def agent_endpoint(
    request: Request,
    message: str = Form(...),
    thread_id: str = Form(None),
    files: List[UploadFile] = File(default=[])
) -> StreamingResponse:
    """
    Unified agent endpoint.
    Accepts a message and optional files, classifies intent, and routes to appropriate handler.
    """
    thread_id = thread_id or str(uuid.uuid4())
    temp_dir = Path(tempfile.mkdtemp(prefix="agent_"))
    
    try:
        # Save uploaded files
        file_paths: List[Path] = []
        file_names: List[str] = []
        
        for f in files:
            if f.filename:
                file_path = temp_dir / f.filename
                with file_path.open("wb") as buffer:
                    shutil.copyfileobj(f.file, buffer)
                file_paths.append(file_path)
                file_names.append(f.filename)
                f.file.close()
        
        # Classify intent
        intent = await route_intent(message, file_names)
        
        async def event_generator() -> AsyncGenerator[bytes, None]:
            # Send intent classification
            yield f"event: intent\ndata: {json.dumps({'intent': intent.intent, 'confidence': intent.confidence, 'reasoning': intent.reasoning})}\n\n".encode("utf-8")
            
            try:
                if intent.intent == "chat":
                    # Extract context from first uploaded file if any
                    context = None
                    if file_paths:
                        try:
                            context = await _extract_file_text(file_paths[0])
                        except Exception:
                            pass
                    
                    async for chunk in _handle_chat(request, message, thread_id, context):
                        yield chunk
                        
                elif intent.intent == "ingest":
                    async for chunk in _handle_ingest(file_paths, message):
                        yield chunk
                        
                elif intent.intent == "evaluate":
                    async for chunk in _handle_evaluate(file_paths, message):
                        yield chunk
                        
            finally:
                # Cleanup temp files
                shutil.rmtree(temp_dir, ignore_errors=True)
        
        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )
        
    except Exception as e:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=str(e))
