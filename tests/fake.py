"""
Offline stand-in for ESPN and the news sources, for working on the pages
without a connection:   python serve.py --fake

One finished match (the real Valencia 0-3 Real Madrid file in this folder),
the same match replayed as if it were live at 64', plus a few fixtures.
"""
import copy
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

SAMPLE = json.loads((Path(__file__).parent / "sample_summary.json").read_text(encoding="utf-8"))
LIVE_ID, DONE_ID = "999000001", "401882808"


def _iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%MZ")


def _event(eid, when, league, home, away, state, hs=None, as_=None, detail=""):
    names = {"post": "STATUS_FULL_TIME", "in": "STATUS_SECOND_HALF", "pre": "STATUS_SCHEDULED"}
    return {
        "id": eid, "date": _iso(when), "league": {"slug": league, "shortName": {"esp.1": "LALIGA", "uefa.champions": "Champions League"}.get(league, league)},
        "competitions": [{
            "status": {"clock": 3840 if state == "in" else 0, "displayClock": "64'" if state == "in" else "",
                       "type": {"state": state, "completed": state == "post", "shortDetail": detail or {"post": "FT", "in": "64'", "pre": ""}[state],
                                "name": names.get(state, "")}},
            "venue": {"fullName": "Santiago Bernabéu" if home[0] == "86" else "Away ground"},
            "broadcasts": [{"media": {"shortName": "DAZN"}}],
            "competitors": [
                {"homeAway": "home", "team": {"id": home[0], "displayName": home[1], "abbreviation": home[2]}, "score": hs},
                {"homeAway": "away", "team": {"id": away[0], "displayName": away[1], "abbreviation": away[2]}, "score": as_},
            ],
        }],
    }


RM, VAL, CEL, PSV, BAR = ("86", "Real Madrid", "RMA"), ("94", "Valencia", "VAL"), ("85", "Celta Vigo", "CEL"), ("148", "PSV Eindhoven", "PSV"), ("83", "Barcelona", "BAR")


def schedule(team_id, fixtures=False):
    now = datetime.now(timezone.utc)
    if fixtures:
        return {"events": [
            _event(LIVE_ID, now - timedelta(minutes=70), "esp.1", RM, BAR, "in", "2", "1"),
            _event("401882798", now + timedelta(days=2, hours=3), "esp.1", RM, CEL, "pre"),
            _event("401915298", now + timedelta(days=5), "uefa.champions", RM, PSV, "pre"),
        ]}
    return {"events": [
        _event("401882832", now - timedelta(days=14), "esp.1", BAR, RM, "post", "1", "2"),
        _event("401882819", now - timedelta(days=7), "esp.1", ("87", "Racing Santander", "RAC"), RM, "post", "0", "3"),
        _event(DONE_ID, now - timedelta(days=1), "esp.1", VAL, RM, "post", "0", "3"),
    ]}


def summary(league, event_id):
    s = copy.deepcopy(SAMPLE)
    s["header"]["id"] = event_id
    if event_id == LIVE_ID:
        s["commentary"] = [c for c in s["commentary"] if (c.get("time") or {}).get("value", 0) <= 3840 and not c["text"].startswith("Match ends")]
        comp = s["header"]["competitions"][0]
        comp["status"] = {"clock": 3840, "displayClock": "64'", "period": 2,
                          "type": {"state": "in", "completed": False, "shortDetail": "64'", "name": "STATUS_SECOND_HALF"}}
        for c in comp["competitors"]:
            c["score"] = "2" if c["id"] == "86" else "0"
    return s


def standings(league):
    teams = [("83", "Barcelona", 31), ("86", "Real Madrid", 30), ("1068", "Atlético Madrid", 24), ("102", "Villarreal", 22),
             ("244", "Real Betis", 20), ("89", "Real Sociedad", 18), ("85", "Celta Vigo", 16), ("93", "Athletic Club", 15)]
    return {"name": "Spanish LALIGA", "season": {"displayName": "2026-27 LALIGA"}, "children": [{"name": "LALIGA", "standings": {"entries": [
        {"team": {"id": i, "shortDisplayName": n, "abbreviation": n[:3].upper()}, "note": {"description": "Champions League"} if r < 4 else None,
         "stats": [{"name": "rank", "value": r + 1}, {"name": "gamesPlayed", "value": 12}, {"name": "wins", "value": p // 3},
                   {"name": "ties", "value": p % 3}, {"name": "losses", "value": 12 - p // 3 - p % 3}, {"name": "points", "value": p},
                   {"name": "pointsFor", "value": 20 + p // 2}, {"name": "pointsAgainst", "value": 10}, {"name": "pointDifferential", "value": p // 2 + 10}]}
        for r, (i, n, p) in enumerate(teams)]}}]}


def roster(league, team_id):
    r = next(x for x in SAMPLE["rosters"] if x["team"]["id"] == "86")
    pos = {"G": "G"}
    out = []
    for p in r["roster"]:
        a = p["athlete"]
        ab = p["position"]["abbreviation"]
        g = "G" if ab == "G" else "D" if ab.startswith(("CD", "LB", "RB")) else "F" if ab.startswith(("F", "CF")) else "M"
        out.append({"id": a["id"], "displayName": a["displayName"], "jersey": p["jersey"], "position": {"abbreviation": pos.get(ab, g)},
                    "age": 25, "citizenship": "Spain", "injuries": [{"status": "Out", "details": {"type": "Hamstring"}}] if a["displayName"] == "Éder Militão" else []})
    return {"athletes": out, "coach": [{"firstName": "José", "lastName": "Mourinho"}]}


async def news_collect(team_key, extra_handles=(), extra_names=()):
    now = datetime.now(timezone.utc)
    items = [
        {"id": "a1", "title": "El Madrid prepara la visita del Celta con dudas en defensa", "title_en": "Madrid prepare for Celta's visit with doubts in defence",
         "url": "https://example.org/1", "published": (now - timedelta(minutes=40)).isoformat(), "source": "COPE", "tier": "A", "lang": "es", "journalist": "Melchor Ruiz", "kind": "article", "summary": ""},
        {"id": "a2", "title": "Güler, the quiet engine of Madrid's winning run", "url": "https://example.org/2",
         "published": (now - timedelta(hours=3)).isoformat(), "source": "The Athletic", "tier": "A", "lang": "en", "journalist": None, "kind": "article", "summary": ""},
        {"id": "a3", "title": "Real Madrid are keeping an eye on a Bundesliga full-back. Early stage.", "url": "https://bsky.app/x",
         "published": (now - timedelta(hours=5)).isoformat(), "source": "Bluesky", "tier": "C", "lang": "en", "journalist": "Fabrizio Romano", "kind": "post", "summary": ""},
    ]
    return {"items": items, "failed": 0, "built": now.isoformat(timespec="seconds")}


def install():
    from app import espn, news

    async def a(fn, *args, **kw):
        return fn(*args, **kw)

    espn.schedule = lambda *x, **k: a(schedule, *x, **k)
    espn.summary = lambda *x: a(summary, *x)
    espn.standings = lambda *x: a(standings, *x)
    espn.roster = lambda *x: a(roster, *x)
    news.collect = news_collect
