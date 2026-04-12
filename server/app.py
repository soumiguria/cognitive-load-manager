import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.main import app

# Expose app at module level for uvicorn: server.app:app
__all__ = ["app"]
