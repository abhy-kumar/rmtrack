"""Local run: API plus the static site on one port.

    python serve.py            -> http://127.0.0.1:8000
    python serve.py 0.0.0.0    -> reachable from your phone on the same wifi
"""
import sys

import uvicorn
from fastapi.staticfiles import StaticFiles

from app.main import app

app.mount("/", StaticFiles(directory="public", html=True), name="site")

if __name__ == "__main__":
    host = sys.argv[1] if len(sys.argv) > 1 else "127.0.0.1"
    uvicorn.run(app, host=host, port=8000)
