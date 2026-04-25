# ── Stage 1: Build React frontend ────────────────────────────────────────────
FROM node:20-slim AS frontend-builder

WORKDIR /frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ── Stage 2: Python / FastAPI backend ─────────────────────────────────────────
FROM python:3.11-slim

WORKDIR /app

# Python dependencies
COPY backend/requirements.txt .
RUN pip install uv && uv pip install --system --no-cache -r requirements.txt

# Application code
COPY backend/  /app/backend/
COPY server/   /app/server/
COPY grader/   /app/grader/
COPY models.py      /app/models.py
COPY inference.py   /app/inference.py
COPY openenv.yaml   /app/openenv.yaml

# Built React SPA – served by FastAPI at /  (assets at /assets/*)
COPY --from=frontend-builder /frontend/dist /app/frontend/dist

EXPOSE 7860

CMD ["uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "7860"]
