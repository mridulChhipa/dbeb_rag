"""
Agent Router Service
Classifies user intent and routes to appropriate handlers.
"""
import json
import re
from typing import Literal, Optional, List, Dict, Any
from dataclasses import dataclass
from langchain_google_genai import ChatGoogleGenerativeAI
from ..core.config import settings


@dataclass
class IntentClassification:
    intent: Literal["chat", "ingest", "evaluate"]
    confidence: float
    reasoning: str


CLASSIFICATION_PROMPT = """You are an intent classifier for a document intelligence system.

Based on the user's message and the types of files they've attached, classify their intent into one of these categories:

1. **chat** - The user wants to ask questions, have a conversation, get information from the knowledge base, or discuss uploaded documents. This is the default for most queries.

2. **ingest** - The user explicitly wants to ADD documents to the permanent/global knowledge base. They might say things like:
   - "Add this to the database"
   - "Ingest this document"
   - "Store this in the knowledge base"
   - "Upload this to the system permanently"
   
3. **evaluate** - The user wants to evaluate candidates against criteria. They typically provide:
   - A criteria/requirements document (PDF/TXT)
   - A CSV file with candidate information
   - A ZIP file containing resumes
   They might say: "Evaluate these candidates", "Screen these resumes", "Check if candidates meet requirements"

User Message: {message}

Attached Files: {files}

Respond with a JSON object:
{{
    "intent": "chat" | "ingest" | "evaluate",
    "confidence": 0.0-1.0,
    "reasoning": "brief explanation"
}}

Only respond with the JSON object, nothing else.
"""


async def classify_intent(
    message: str,
    file_names: List[str]
) -> IntentClassification:
    """Classify user intent based on message and attached files."""
    
    llm = ChatGoogleGenerativeAI(model=settings.LLM_MODEL, temperature=0)
    
    files_desc = ", ".join(file_names) if file_names else "None"
    
    prompt = CLASSIFICATION_PROMPT.format(
        message=message,
        files=files_desc
    )
    
    try:
        response = await llm.ainvoke(prompt)
        content = response.content
        
        # Extract JSON from response
        if isinstance(content, list):
            content = "".join(
                block.get("text", "") if isinstance(block, dict) else str(block)
                for block in content
            )
        
        # Clean up response - remove markdown code blocks if present
        content = content.strip()
        if content.startswith("```"):
            content = re.sub(r"^```(?:json)?\s*", "", content)
            content = re.sub(r"\s*```$", "", content)
        
        data = json.loads(content)
        
        return IntentClassification(
            intent=data.get("intent", "chat"),
            confidence=float(data.get("confidence", 0.8)),
            reasoning=data.get("reasoning", "")
        )
    except Exception as e:
        # Default to chat on any error
        return IntentClassification(
            intent="chat",
            confidence=0.5,
            reasoning=f"Classification failed, defaulting to chat: {str(e)}"
        )


def detect_intent_heuristic(
    message: str,
    file_names: List[str]
) -> Optional[IntentClassification]:
    """
    Fast heuristic-based intent detection.
    Returns None if uncertain, allowing fallback to LLM classification.
    """
    message_lower = message.lower()
    
    # Check for evaluate intent
    has_csv = any(f.lower().endswith(".csv") for f in file_names)
    has_zip = any(f.lower().endswith(".zip") for f in file_names)
    evaluate_keywords = ["evaluate", "screen", "assess", "candidate", "resume", "hiring", "recruit"]
    
    if has_csv and has_zip and any(kw in message_lower for kw in evaluate_keywords):
        return IntentClassification(
            intent="evaluate",
            confidence=0.95,
            reasoning="CSV + ZIP files with evaluation keywords detected"
        )
    
    # Check for ingest intent
    ingest_keywords = ["ingest", "add to database", "add to knowledge", "store permanently", 
                       "upload to system", "add this document", "save to database"]
    if any(kw in message_lower for kw in ingest_keywords):
        return IntentClassification(
            intent="ingest",
            confidence=0.9,
            reasoning="Explicit ingest keywords detected"
        )
    
    # If just chatting with optional context document
    if not file_names or len(file_names) == 1:
        chat_keywords = ["what", "how", "why", "explain", "tell me", "summarize", "?"]
        if any(kw in message_lower for kw in chat_keywords):
            return IntentClassification(
                intent="chat",
                confidence=0.85,
                reasoning="Question/chat pattern detected"
            )
    
    # Uncertain - let LLM decide
    return None


async def route_intent(
    message: str,
    file_names: List[str]
) -> IntentClassification:
    """
    Route user intent using heuristics first, then LLM if uncertain.
    """
    # Try fast heuristic first
    heuristic_result = detect_intent_heuristic(message, file_names)
    if heuristic_result and heuristic_result.confidence >= 0.85:
        return heuristic_result
    
    # Fall back to LLM classification
    return await classify_intent(message, file_names)
