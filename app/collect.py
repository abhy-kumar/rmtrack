"""
Archive job. Saves every finished match and a daily news snapshot as plain
JSON under public/data/, which the site then serves as static files.

    python -m app.collect                 # matches, all teams
    python -m app.collect men             # just one team
    python -m app.collect --news          # matches + today's news snapshot

Runs from .github/workflows/collect.yml (matches hourly, news once a day).
Safe to run as often as you like: matches already on disk are skipped.
"""
import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from . import espn, news, season
from .net import client

ROOT = Path(__file__).resolve().parent.parent / "public" / "data"


def _load(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return default


def _save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)


async def team_archive(key):
    team = espn.team(key)
    idx_path = ROOT / key / "index.json"
    idx = _load(idx_path, {"team": key, "matches": [], "names": {}})
    have = {m["id"] for m in idx["matches"]}
    rows = await season.schedule(key)
    new = 0
    for f in rows:
        if f["status"]["state"] != "post" or f["id"] in have or f["league"] in season.FRIENDLY:
            continue
        try:
            m = await season.match(f["league"], f["id"])
        except Exception as e:
            print(f"  {f['id']}: {e}")
            continue
        if not m["rated"] or not (m["home"]["xi"] or m["away"]["xi"]):
            continue
        _save(ROOT / key / "m" / f"{m['id']}.json", m)
        c, names = season.compact(m, team["id"])
        idx["matches"].append(c)
        for pid, v in names.items():
            if pid not in idx["names"] or (v[1] and not idx["names"][pid][1]):
                idx["names"][pid] = v
        new += 1
        print(f"  saved {m['id']} {m['home']['abbr']} {m['home']['score']}-{m['away']['score']} {m['away']['abbr']}")
    if new:
        idx["matches"].sort(key=lambda c: c["date"] or "")
        idx["updated"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        _save(idx_path, idx)
    return new


async def news_snapshot(key):
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    path = ROOT / key / "news" / f"{day}.json"
    feed = await news.collect(key)
    old = _load(path, {"items": []})
    seen = {i["id"] for i in old["items"]}
    merged = old["items"] + [i for i in feed["items"] if i["id"] not in seen]
    merged.sort(key=lambda i: i["published"] or "", reverse=True)
    if len(merged) != len(old["items"]):
        _save(path, {"day": day, "items": merged[:300]})
        days = sorted(p.stem for p in (ROOT / key / "news").glob("*.json"))
        _save(ROOT / key / "news" / "days.json", days[-120:])
        return len(merged) - len(old["items"])
    return 0


async def main(keys, with_news):
    for key in keys:
        print(f"{key}:")
        try:
            print(f"  {await team_archive(key)} new match(es)")
        except Exception as e:
            print(f"  archive failed: {e}")
        if not with_news:
            continue
        try:
            print(f"  {await news_snapshot(key)} new news item(s)")
        except Exception as e:
            print(f"  news failed: {e}")
    await client().aclose()


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    asyncio.run(main([a for a in args if a in espn.TEAMS] or list(espn.TEAMS), "--news" in sys.argv))
