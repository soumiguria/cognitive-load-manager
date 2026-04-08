import uvicorn
import sys
import os

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from backend.main import app

def main():
    uvicorn.run("backend.main:app", host="0.0.0.0", port=7860)

if __name__ == "__main__":
    main()
