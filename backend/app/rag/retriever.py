from typing import List, Dict, Any
from app.rag.document_loader import load_default_runbooks

class RunbookRetriever:
    """Retrieve operational runbooks relevant to an incident query."""

    def __init__(self):
        self.runbooks = load_default_runbooks()

    def search_runbooks(self, query: str, top_k: int = 2) -> List[Dict[str, Any]]:
        query_words = set(query.lower().split())
        scored = []
        
        for doc in self.runbooks:
            doc_text = f"{doc['title']} {doc['category']} {doc['content']}".lower()
            score = sum(1 for w in query_words if w in doc_text)
            if score > 0:
                scored.append((score, doc))

        scored.sort(key=lambda x: x[0], reverse=True)
        results = [item[1] for item in scored[:top_k]]
        return results if results else self.runbooks[:1]

runbook_retriever = RunbookRetriever()
