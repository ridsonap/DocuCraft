"""DocuCraft API - PDF Editor Backend."""

import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.pdf.routes import router as pdf_router

app = FastAPI(
    title="DocuCraft API",
    description="Production-grade PDF editor backend powered by PyMuPDF and FastAPI",
    version="1.0.0",
)

# CORS configuration
raw_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,*")
allowed_origins = [origin.strip() for origin in raw_origins.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins if "*" not in allowed_origins else ["*"],
    allow_credentials=True if "*" not in allowed_origins else False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

# Mount routes
app.include_router(pdf_router)


@app.get("/")
async def root():
    return {
        "name": "DocuCraft API",
        "status": "online",
        "version": "1.0.0",
        "docs": "/docs",
    }


@app.get("/health")
async def root_health():
    return {
        "status": "healthy",
        "app": "DocuCraft PDF Editor Backend",
    }
