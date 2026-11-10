"""Fixtures, results and a season's worth of ratings for one team."""
import asyncio

from . import espn
from .match import fixture, normalize, outcome
from .net import cached, peek, put

FRIENDLY = ("club.friendly",)


async def match(league, event_id):
    """Normalised match. Finished ones are kept for a day, live ones for seconds."""
    final = peek(("final", league, event_id), 86400)
    if final:
        return final

    async def build():
        return normalize(await espn.summary(league, event_id), league)

    m = await cached(("m", league, event_id), 8, build)
    if m["status"]["state"] == "post":
        put(("final", league, event_id), m)
    return m


async def schedule(team_key):
    team = espn.team(team_key)

    async def build():
        past, ahead = await asyncio.gather(
            espn.schedule(team["id"]), espn.schedule(team["id"], fixtures=True), return_exceptions=True)
        rows = {}
        for blob in (past, ahead):
            if isinstance(blob, Exception):
                continue
            for ev in blob.get("events") or []:
                f = fixture(ev)
                rows[f["id"]] = f
        out = sorted(rows.values(), key=lambda f: f["date"] or "")
        if isinstance(past, Exception) and isinstance(ahead, Exception):
            raise past
        return out

    return await cached(("sched", team_key), 45, build)


def _res(m, team_id):
    me = m["home"] if m["home"]["id"] == team_id else m["away"]
    them = m["away"] if me is m["home"] else m["home"]
    return outcome(me, them)


# bump when the per-player row changes; the archive job rebuilds older rows
COMPACT_VERSION = 2


def compact(m, team_id):
    """What the archive index keeps per match.

    Per player: [rating, minutes, goals, assists, yellows, reds, started,
    involvements], where involvements counts the commentary lines he's in
    (shots, fouls either way, chances made, offsides). It's the nearest thing
    to a work-rate number ESPN gives us.
    """
    me = "home" if m["home"]["id"] == team_id else "away"
    busy = {}
    for a in m.get("acts") or []:
        if a[1] == me and a[5]:
            busy[a[5]] = busy.get(a[5], 0) + 1
    players, names = {}, {}
    for p in m[me]["xi"] + m[me]["bench"]:
        if not p["mins"]:
            continue
        players[p["id"]] = [p["r"], p["mins"], p["g"], p["a"], p["y"], p["rc"], 1 if p in m[me]["xi"] else 0,
                            busy.get(p["id"], 0)]
        names[p["id"]] = [p["name"], p["pos"] if p in m[me]["xi"] else ""]
    side = lambda s: {"abbr": m[s]["abbr"], "name": m[s]["name"], "score": m[s]["score"]}
    return {
        "id": m["id"], "league": m["league"], "comp": m["comp"], "date": m["date"],
        "home": side("home"), "away": side("away"), "res": _res(m, team_id),
        "motm": m["motm"], "players": players, "v": COMPACT_VERSION,
    }, names


async def ratings(team_key, skip=()):
    """Every finished non-friendly match this season, compacted."""
    team = espn.team(team_key)

    async def build():
        rows = await schedule(team_key)
        done = [f for f in rows if f["status"]["state"] == "post"
                and f["league"] not in FRIENDLY and f["id"] not in skip]
        sem = asyncio.Semaphore(6)

        async def one(f):
            async with sem:
                try:
                    return await match(f["league"], f["id"])
                except Exception:
                    return None

        full = await asyncio.gather(*(one(f) for f in done))
        matches, names = [], {}
        for m in full:
            if not m or not m["rated"]:
                continue
            c, n = compact(m, team["id"])
            matches.append(c)
            for pid, v in n.items():
                if pid not in names or (v[1] and not names[pid][1]):
                    names[pid] = v
        matches.sort(key=lambda c: c["date"] or "")
        return {"team": team_key, "matches": matches, "names": names}

    return await cached(("season", team_key, tuple(skip)), 1800, build)
