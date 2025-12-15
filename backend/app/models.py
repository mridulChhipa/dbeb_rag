from pydantic import BaseModel
from typing import Optional

class StreamRequest(BaseModel):
    thread_id: Optional[str] = None
    text: str
    context: Optional[str] = None
