"""
Archive job. Saves every finished match and a daily news snapshot as plain
JSON under public/data/, which the site then serves as static files.

    python -m app.collect                 # matches, all teams
    python -m app.collect men             # just one team
    python -m app.collect --news          # matches + today's news snapshot
    python -m app.collect --leagues       # also every team and player in the
                                          # leagues in app/league.py, refits xG

Runs from .github/workflows/collect.yml (matches hourly, news once a day).
Safe to run as often as you like: matches already on disk are skipped.
"""
import asyncio
import json
import logging
import sys
from datetime import UTC, datetime
from pathlib import Path

from . import espn, news, season
from .net import client

ROOT = Path(__file__).resolve().parent.parent / "public" / "data"
log = logging.getLogger("rmtrack.collect")


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


def _upgrade(key, idx, team_id):
    """Rebuild index rows made by an older compact() from the saved matches."""
    fixed = 0
    for i, row in enumerate(idx["matches"]):
        if row.get("v") == season.COMPACT_VERSION:
            continue
        saved = _load(ROOT / key / "m" / f"{row['id']}.json", None)
        if saved:
            idx["matches"][i], _ = season.compact(saved, team_id)
            fixed += 1
    if fixed:
        log.info("%s: rebuilt %d archive rows", key, fixed)
    return fixed


async def team_archive(key):
    team = espn.team(key)
    idx_path = ROOT / key / "index.json"
    idx = _load(idx_path, {"team": key, "matches": [], "names": {}})
    new = _upgrade(key, idx, team["id"])
    have = {m["id"] for m in idx["matches"]}
    rows = await season.schedule(key)
    for f in rows:
        if f["status"]["state"] != "post" or f["id"] in have or f["league"] in season.FRIENDLY:
            continue
        try:
            m = await season.match(f["league"], f["id"])
        except Exception as e:
            log.warning("match %s failed: %s", f["id"], e)
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
        log.info("saved %s %s %s-%s %s", m["id"], m["home"]["abbr"], m["home"]["score"], m["away"]["score"], m["away"]["abbr"])
    if new:
        idx["matches"].sort(key=lambda c: c["date"] or "")
        idx["updated"] = datetime.now(UTC).isoformat(timespec="seconds")
        _save(idx_path, idx)
    return new


async def news_snapshot(key):
    day = datetime.now(UTC).strftime("%Y-%m-%d")
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


async def main(keys, with_news, with_leagues=False):
    """Run the archive for each team, then optionally news and the league collector."""
    failed = False
    for key in keys:
        try:
            log.info("%s: %d new match(es)", key, await team_archive(key))
        except Exception:
            log.exception("%s: archive failed", key)
            failed = True
        if not with_news:
            continue
        try:
            log.info("%s: %d new news item(s)", key, await news_snapshot(key))
        except Exception:
            log.exception("%s: news failed", key)
            failed = True
    if with_leagues:
        from . import league
        await league.run()
    await client().aclose()
    return 1 if failed else 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    keys = [a for a in args if a in espn.TEAMS] or list(espn.TEAMS)
    sys.exit(asyncio.run(main(keys, "--news" in sys.argv, "--leagues" in sys.argv)))
