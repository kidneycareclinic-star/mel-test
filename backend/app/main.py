from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import router
from .config import get_settings

settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["Content-Type", "X-Dev-Principal"],
)

@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "nephrology-agentic-harness-api",
        "environment": settings.environment,
        "version": "0.1.0",
    }

app.include_router(router)
