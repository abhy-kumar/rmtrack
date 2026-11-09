"""HTTP API. Everything here is a thin layer over the modules that do the work."""
import logging
from datetime import UTC, datetime

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from . import club, espn, ics, news, ratings, season, xg

log = logging.getLogger("rmtrack")

app = FastAPI(title="rmtrack", docs_url=None, redoc_url=None, openapi_url=None)

LEAGUE_OK = set("abcdefghijklmnopqrstuvwxyz.0123456789_")
NO_STORE = {"Cache-Control": "no-store"}


def out(data, cdn=60, swr=None):
    """JSON with CDN caching. Browsers revalidate every time; the edge keeps it `cdn` seconds."""
    swr = swr if swr is not None else cdn * 4
    edge = f"public, s-maxage={cdn}, stale-while-revalidate={swr}"
    return JSONResponse(data, headers={
        "Cache-Control": "public, max-age=0, must-revalidate",
        "CDN-Cache-Control": edge,
        "Vercel-CDN-Cache-Control": edge,
    })


def _league(lg):
    if not lg or len(lg) > 30 or not set(lg) <= LEAGUE_OK:
        raise HTTPException(400, "bad league")
    return lg


def _team(t):
    return t if t in espn.TEAMS else "men"


@app.exception_handler(httpx.HTTPError)
async def upstream_down(request: Request, exc: httpx.HTTPError):
    log.warning("upstream failed for %s: %r", request.url.path, exc)
    return JSONResponse({"error": "upstream"}, status_code=502, headers=NO_STORE)


@app.exception_handler(Exception)
async def crashed(request: Request, exc: Exception):
    log.exception("unhandled error on %s", request.url.path)
    return JSONResponse({"error": "server"}, status_code=500, headers=NO_STORE)


@app.get("/api/health")
async def health():
    return {"ok": True, "now": datetime.now(UTC).isoformat(timespec="seconds")}


@app.get("/api/overview")
async def overview(team: str = "men"):
    team = _team(team)
    rows = await season.schedule(team)
    live = [f for f in rows if f["status"]["state"] == "in"]
    ahead = [f for f in rows if f["status"]["state"] == "pre"]
    done = [f for f in rows if f["status"]["state"] == "post"]
    info = espn.team(team)
    data = {
        "team": team, "info": info, "live": live, "next": ahead[:6],
        "last": done[-1] if done else None, "form": club.form(done, info["id"]),
    }
    return out(data, cdn=10 if live else 45)


@app.get("/api/fixtures")
async def fixtures(team: str = "men"):
    team = _team(team)
    return out({"team": team, "rows": await season.schedule(team)}, cdn=60)


@app.get("/api/match/{league}/{event_id}")
async def match(league: str, event_id: str):
    if not event_id.isdigit() or len(event_id) > 12:
        raise HTTPException(400, "bad id")
    m = await season.match(_league(league), event_id)
    live = m["status"]["state"] == "in"
    cdn = 8 if live else 3600 if m["status"]["state"] == "post" else 60
    return out(m, cdn=cdn, swr=8 if live else None)


@app.get("/api/table/{league}")
async def table(league: str):
    return out(await club.standings(_league(league)), cdn=600)


@app.get("/api/squad")
async def squad(team: str = "men"):
    return out(await club.squad(_team(team)), cdn=3600)


@app.get("/api/season")
async def season_ratings(team: str = "men", skip: str = ""):
    ids = tuple(sorted(i for i in skip.split(",") if i.isdigit()))[:200]
    return out(await season.ratings(_team(team), ids), cdn=900)


@app.get("/api/news")
async def news_feed(team: str = "men", bsky: str = "", who: str = ""):
    handles = tuple(x.strip().lstrip("@") for x in bsky.split(",") if "." in x.strip())[:6]
    names = tuple(n.strip()[:40] for n in who.split(",") if len(n.strip()) > 3)[:6]
    return out(await news.feed(_team(team), handles, names), cdn=300)


@app.get("/api/sources")
async def sources():
    return out(news.SOURCES, cdn=3600)


class Paste(BaseModel):
    text: str = Field("", max_length=3000)
    url: str = Field("", max_length=300)


@app.post("/api/paste")
async def paste(body: Paste):
    return JSONResponse(await news.paste(body.text, body.url), headers=NO_STORE)


XG_EXAMPLES = {
    "6m central": (94.3, 50, False),
    "penalty spot, open play": (89.5, 50, False),
    "edge of the box": (84.3, 50, False),
    "25m": (76.2, 50, False),
    "6m header": (94.3, 50, True),
    "6m out, 10m wide": (94.3, 65, False),
}


@app.get("/api/model")
async def model():
    r = ratings
    return out({
        "base": r.BASE, "pos": r.POS, "events": r.W, "labels": r.LABELS, "save": r.SAVE,
        "pen_save": r.PEN_SAVE, "conceded": r.CONCEDED, "clean": r.CLEAN, "result": r.RESULT,
        "minutes": r.MINUTES, "possession": r.POSSESSION, "min_minutes": r.MIN_SECONDS // 60,
        "xg": {k: v for k, v in xg.model().items() if k != "features"},
        "xg_examples": {k: xg.predict(x, y, head=hd) for k, (x, y, hd) in XG_EXAMPLES.items()},
    }, cdn=3600)


@app.get("/api/calendar.ics")
async def calendar(team: str = "men"):
    team = _team(team)
    body = ics.calendar(espn.team(team)["name"], await season.schedule(team))
    return Response(body, media_type="text/calendar; charset=utf-8", headers={
        "Content-Disposition": f'inline; filename="rmtrack-{team}.ics"',
        "Cache-Control": "public, max-age=3600",
        "CDN-Cache-Control": "public, s-maxage=3600",
    })
