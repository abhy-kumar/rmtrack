"""Free translation: Google's public web endpoint first, MyMemory if that fails."""
import asyncio

from .net import client

GTX = "https://translate.googleapis.com/translate_a/single"
MYMEMORY = "https://api.mymemory.translated.net/get"

_memo = {}


async def _gtx(text, target):
    r = await client().get(GTX, params={"client": "gtx", "sl": "auto", "tl": target, "dt": "t", "q": text})
    r.raise_for_status()
    j = r.json()
    out = "".join(seg[0] for seg in (j[0] or []) if seg and seg[0])
    return out, (j[2] if len(j) > 2 else None)


async def _mymemory(text, source, target):
    r = await client().get(MYMEMORY, params={"q": text[:480], "langpair": f"{source or 'es'}|{target}"})
    r.raise_for_status()
    return r.json()["responseData"]["translatedText"], source


async def one(text, target="en", source=None):
    """Returns (translated, detected_lang). Unchanged text if it's already in target."""
    text = (text or "").strip()
    if not text:
        return text, None
    key = (text, target)
    if key in _memo:
        return _memo[key]
    try:
        out = await _gtx(text, target)
    except Exception:
        try:
            out = await _mymemory(text, source, target)
        except Exception:
            return text, None
    _memo[key] = out
    if len(_memo) > 5000:
        _memo.clear()
    return out


async def many(texts, target="en"):
    """
    Translate a list in as few requests as possible: newline-joined
    batches, falling back to one-by-one if the line count comes back wrong.
    """
    todo = [t for t in dict.fromkeys(texts) if t and (t, target) not in _memo]
    i = 0
    while i < len(todo):
        batch, size = [], 0
        while i < len(todo) and size + len(todo[i]) < 3500 and len(batch) < 40:
            batch.append(todo[i].replace("\n", " "))
            size += len(todo[i]) + 1
            i += 1
        if not batch:
            batch.append(todo[i][:3500])
            i += 1
        try:
            out, lang = await _gtx("\n".join(batch), target)
            lines = [s.strip() for s in out.split("\n")]
            if len(lines) != len(batch):
                raise ValueError("line count")
            for src, dst in zip(batch, lines):
                _memo[(src, target)] = (dst, lang)
        except Exception:
            sem = asyncio.Semaphore(5)

            async def go(t, sem=sem):
                async with sem:
                    await one(t, target)
            await asyncio.gather(*(go(t) for t in batch))
    return [_memo.get((t, target), (t, None)) for t in texts]
