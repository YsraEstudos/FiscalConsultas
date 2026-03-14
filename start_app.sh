#!/bin/bash
export PYTHONPATH=/app
cd backend && uv sync --group dev
uv run uvicorn backend.server.app:app --port 8000 &
cd ../client && npm ci
npm run dev -- --port 5173 &
