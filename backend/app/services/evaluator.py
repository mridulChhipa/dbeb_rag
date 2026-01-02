import asyncio
import json
from pathlib import Path
from typing import Any, Dict

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_community.document_loaders import PyPDFLoader

from .llm import llm

MAX_RESUME_CHARS = 6000


async def extract_pdf_text(path: Path) -> str:
    """Extracts text from a PDF file asynchronously."""
    def _load() -> str:
        loader = PyPDFLoader(str(path))
        pages = loader.load()
        return "\n\n".join(page.page_content for page in pages)

    return await asyncio.to_thread(_load)


async def read_text_file(path: Path) -> str:
    """Reads a plain-text file asynchronously."""
    def _read() -> str:
        return path.read_text(encoding="utf-8", errors="ignore")

    return await asyncio.to_thread(_read)


def _truncate(text: str, max_chars: int = MAX_RESUME_CHARS) -> str:
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "\n...[truncated]"


async def evaluate_candidate(criteria_text: str, candidate_row: Dict[str, Any], resume_text: str) -> Dict[str, Any]:
    """Uses the shared LLM to decide if a candidate meets the minimum requirements."""
    system_prompt = (
        "You are an assistant helping a hiring panel evaluate candidates. "
        "Carefully read the selection criteria and the candidate information. "
        "Decide if the candidate meets ALL minimum requirements. "
        "Return a JSON object with keys: 'meets_requirements' (true/false), "
        "'reasoning' (short explanation), 'missing_criteria' (array of strings describing any gaps), "
        "and 'codeforces_rating' (numeric rating if found, otherwise null)."
    )

    candidate_json = json.dumps(candidate_row, ensure_ascii=True)
    trimmed_resume = _truncate(resume_text.strip())

    human_prompt = (
        "Selection Criteria:\n"
        f"{criteria_text.strip()}\n\n"
        "Candidate Record (CSV Row as JSON):\n"
        f"{candidate_json}\n\n"
        "Resume Extract:\n"
        f"{trimmed_resume}\n\n"
        "Respond with only the JSON object."
    )

    response = await llm.ainvoke([
        SystemMessage(content=system_prompt),
        HumanMessage(content=human_prompt),
    ])

    content = response.content
    if isinstance(content, list):
        content_text = "".join(
            part.get("text", "") if isinstance(part, dict) else str(part)
            for part in content
        )
    else:
        content_text = str(content)

    # Strip markdown code fences if present
    content_text = content_text.strip()
    if content_text.startswith("```"):
        # Remove opening fence (```json or ```)
        first_newline = content_text.find("\n")
        if first_newline != -1:
            content_text = content_text[first_newline + 1:]
        # Remove closing fence
        if content_text.endswith("```"):
            content_text = content_text[:-3].strip()

    try:
        parsed = json.loads(content_text)
    except Exception:
        parsed = {
            "meets_requirements": None,
            "reasoning": content_text.strip(),
            "missing_criteria": [],
            "codeforces_rating": None,
        }

    parsed.setdefault("raw_response", content_text.strip())
    parsed.setdefault("codeforces_rating", None)
    return parsed
