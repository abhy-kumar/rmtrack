"""Outbound HTTP plus a small in-process cache.

On Vercel a warm instance keeps this cache between requests; the CDN in
front (see cdn() in main.py) does the heavy lifting. Locally it's all we
have, and it's plenty.
"""
import asyncio
import time

import httpx

UA = "rmtrack/1.0 (+https://github.com/abhy-kumar/rmtrack)"
_client = None
_store = {}
_locks = {}


def client():
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(8.0, connect=4.0),
            headers={"User-Agent": UA, "Accept-Language": "en,es;q=0.8"},
            follow_redirects=True,
            http2=False,
        )
    return _client


async def get_json(url, **params):
    r = await client().get(url, params=params or None)
    r.raise_for_status()
    return r.json()


async def get_text(url, **params):
    r = await client().get(url, params=params or None)
    r.raise_for_status()
    return r.text


async def cached(key, ttl, make):
    """
    Return a fresh value for key, building it with `make()` when stale.
    Only one build per key runs at a time. If a rebuild fails and we have
    an old value, the old value is returned instead of an error.
    """
    hit = _store.get(key)
    now = time.monotonic()
    if hit and now - hit[0] < ttl:
        return hit[1]
    lock = _locks.setdefault(key, asyncio.Lock())
    async with lock:
        hit = _store.get(key)
        if hit and time.monotonic() - hit[0] < ttl:
            return hit[1]
        try:
            val = await make()
        except Exception:
            if hit:
                return hit[1]
            raise
        _store[key] = (time.monotonic(), val)
        if len(_store) > 600:
            for k, _ in sorted(_store.items(), key=lambda kv: kv[1][0])[:200]:
                _store.pop(k, None)
        return val


def peek(key, ttl):
    hit = _store.get(key)
    if hit and time.monotonic() - hit[0] < ttl:
        return hit[1]
    return None


def put(key, val):
    _store[key] = (time.monotonic(), val)
