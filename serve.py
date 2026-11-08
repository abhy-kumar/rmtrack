"""Local run: API plus the static site on one port.

    python serve.py              http://127.0.0.1:8000
    python serve.py --lan        also reachable from your phone on the same wifi
    python serve.py --fake       no network needed, canned data (for working on the pages)
"""
import sys

import uvicorn
from fastapi.staticfiles import StaticFiles

if "--fake" in sys.argv:
    from tests import fake
    fake.install()

from app.main import app  # noqa: E402

app.mount("/", StaticFiles(directory="public", html=True), name="site")

if __name__ == "__main__":
    host = "0.0.0.0" if "--lan" in sys.argv else "127.0.0.1"
    port = 8000
    print(f"rmtrack on http://{'<this-pc-ip>' if host == '0.0.0.0' else host}:{port}")
    uvicorn.run(app, host=host, port=port, log_level="warning")
