import torch
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_qdrant import QdrantVectorStore
from qdrant_client import QdrantClient
from qdrant_client.models import VectorParams, Distance
from ..core.config import settings

# Initialize Embeddings
device = "cuda" if torch.cuda.is_available() else "cpu"
embeddings = HuggingFaceEmbeddings(
    model_name=settings.EMBEDDING_MODEL,
    model_kwargs={"device": device},
)

# Initialize Qdrant Client
qdrant_client = QdrantClient(
    url=settings.QDRANT_URL, 
    prefer_grpc=False, 
    api_key=settings.QDRANT_API_KEY if settings.QDRANT_API_KEY else None,
    check_compatibility=False
)

def ensure_collections_exist():
    """Ensures that the required collections exist in Qdrant."""
    try:
        collections = qdrant_client.get_collections().collections
        collection_names = [c.name for c in collections]
        
        # Dimension for all-MiniLM-L6-v2 is 384
        vector_size = 384
        
        if "dbeb" not in collection_names:
            print("Creating 'dbeb' collection...")
            qdrant_client.create_collection(
                collection_name="dbeb",
                vectors_config=VectorParams(size=vector_size, distance=Distance.COSINE)
            )
            
        if "dbeb_sessions" not in collection_names:
            print("Creating 'dbeb_sessions' collection...")
            qdrant_client.create_collection(
                collection_name="dbeb_sessions",
                vectors_config=VectorParams(size=vector_size, distance=Distance.COSINE)
            )
            
        # Ensure payload index exists for session_id
        # This is required for filtering by metadata.session_id
        print("Ensuring index for 'metadata.session_id'...")
        qdrant_client.create_payload_index(
            collection_name="dbeb_sessions",
            field_name="metadata.session_id",
            field_schema="keyword"
        )
            
    except Exception as e:
        print(f"Error checking/creating collections: {e}")

def get_global_vectorstore() -> QdrantVectorStore:
    """Returns the global admin knowledge base."""
    return QdrantVectorStore(
        client=qdrant_client,
        collection_name="dbeb",
        embedding=embeddings,
    )

def get_session_vectorstore() -> QdrantVectorStore:
    """Returns the session-specific knowledge base."""
    return QdrantVectorStore(
        client=qdrant_client,
        collection_name="dbeb_sessions",
        embedding=embeddings,
    )

async def add_session_documents(documents, thread_id: str):
    """Adds documents to the session collection with thread_id metadata."""
    # Add metadata to all documents
    for doc in documents:
        doc.metadata["session_id"] = thread_id
    
    vectorstore = get_session_vectorstore()
    await vectorstore.aadd_documents(documents)
