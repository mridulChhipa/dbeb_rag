import os
from dotenv import load_dotenv

# Load .env from the backend root (parent of app)
# backend/app/core/config.py -> backend/app/core -> backend/app -> backend -> .env
load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))), "backend", ".env"))

# Fallback: try loading from current working directory if running from root
load_dotenv()

class Settings:
    GOOGLE_API_KEY: str = os.getenv("GOOGLE_API_KEY", "")
    QDRANT_URL: str = os.getenv("QDRANT_URL", "http://localhost:6333")
    QDRANT_API_KEY: str = os.getenv("QDRANT_API_KEY", "")
    ADMIN_KEY: str = os.getenv("ADMIN_KEY", "secret-default")
    
    # Model Config
    EMBEDDING_MODEL: str = "sentence-transformers/all-MiniLM-L6-v2"
    LLM_MODEL: str = "gemini-2.5-flash"

settings = Settings()

if not settings.GOOGLE_API_KEY:
    # Don't raise error immediately on import to allow build/test without env
    print("Warning: GOOGLE_API_KEY environment variable is not set.")
