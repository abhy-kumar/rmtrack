"""Local run: API plus the static site on one port.

    python serve.py              http://127.0.0.1:8000
    python serve.py --lan        also reachable from your phone on the same wifi
    python serve.py --fake       no network needed, canned data (for working on the pages)
"""
import json
import logging
import sys
from pathlib import Path

import uvicorn
from fastapi.staticfiles import StaticFiles

if "--fake" in sys.argv:
    from tests import fake
    fake.install()

from app.main import app

# Same security headers Vercel sends, so a policy problem shows up locally first.
SITE_HEADERS = next(r["headers"] for r in json.loads(Path("vercel.json").read_text())["headers"] if r["source"] == "/(.*)")


@app.middleware("http")
async def site_headers(request, call_next):
    response = await call_next(request)
    for h in SITE_HEADERS:
        response.headers.setdefault(h["key"], h["value"])
    return response


app.mount("/", StaticFiles(directory="public", html=True), name="site")

if __name__ == "__main__":
    host = "0.0.0.0" if "--lan" in sys.argv else "127.0.0.1"
    port = 8000
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    print(f"rmtrack on http://{'<this-pc-ip>' if host == '0.0.0.0' else host}:{port}")
    uvicorn.run(app, host=host, port=port, log_level="warning")
