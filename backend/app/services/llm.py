import asyncio
from contextvars import ContextVar
from typing import Annotated, Literal

from langchain_core.tools import tool
from langchain_core.messages import HumanMessage, AIMessageChunk
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.graph import StateGraph, MessagesState
from langgraph.prebuilt import ToolNode, tools_condition
from qdrant_client import models as qmodels

from ..core.config import settings
from .vector_store import get_global_vectorstore, get_session_vectorstore

# ContextVar to store thread_id for the current request
session_context = ContextVar("session_context", default=None)

# --- Tools ---

@tool
def search_global_knowledge(query: str):
    """
    Searches the global/admin knowledge base for general information.
    Use this for questions about the core dataset or general topics.
    """
    vectorstore = get_global_vectorstore()
    # Retrieve top 4 documents
    results = vectorstore.similarity_search(query, k=4)
    return "\n\n".join([doc.page_content for doc in results])

@tool
def search_session_knowledge(query: str):
    """
    Searches the session-specific documents uploaded by the user.
    Use this when the user asks about a file they just uploaded.
    """
    thread_id = session_context.get()
    if not thread_id:
        return "No session context found. Cannot search session documents."

    try:
        vectorstore = get_session_vectorstore()
        
        # Filter by session_id in metadata
        # We must use qdrant_client.models.Filter for the filter argument
        results = vectorstore.similarity_search(
            query, 
            k=4, 
            filter=qmodels.Filter(
                must=[
                    qmodels.FieldCondition(
                        key="metadata.session_id",
                        match=qmodels.MatchValue(value=thread_id)
                    )
                ]
            )
        )
        
        if not results:
            return "No relevant information found in session documents."
            
        return "\n\n".join([doc.page_content for doc in results])
    except Exception as e:
        # Gracefully handle errors (e.g. collection missing, connection error)
        # so the LLM can fall back to the context provided in the prompt
        return f"Error searching session documents: {str(e)}"

# --- Graph Setup ---

llm = ChatGoogleGenerativeAI(model=settings.LLM_MODEL, temperature=0.5)
tools = [search_global_knowledge, search_session_knowledge]
llm_with_tools = llm.bind_tools(tools)

class State(MessagesState):
    pass

async def agent_node(state: State):
    messages = state["messages"]
    print(f"\n--- AGENT NODE MESSAGES (Full Context) ---\n{messages}\n------------------------------------------\n")
    response = await llm_with_tools.ainvoke(messages)
    return {"messages": [response]}

tool_node = ToolNode(tools=tools)

workflow = StateGraph(State)
workflow.add_node("agent", agent_node)
workflow.add_node("tools", tool_node)
workflow.set_entry_point("agent")
workflow.add_conditional_edges("agent", tools_condition)
workflow.add_edge("tools", "agent")

# Compile graph once
_graph = workflow.compile()

def get_graph():
    return _graph
