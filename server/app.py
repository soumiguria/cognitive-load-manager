"""
server/app.py — single entry point for CLM OpenEnv server.

Imports the FastAPI app built in backend/main.py and exposes it for:
  - Dockerfile: uvicorn server.app:app --host 0.0.0.0 --port 7860
  - openenv.yaml: app: server.app:app

All route logic lives in backend/main.py. This file is intentionally thin.
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.main import app  # single source of truth for the FastAPI app

__all__ = ["app"]


def main():
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7860)


if __name__ == "__main__":
    main()
