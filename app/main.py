import asyncio
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response

from . import espn, news, ratings, season
from .net import cached

app = FastAPI(title="rmtrack", docs_url=None, redoc_url=None, openapi_url=None)

LEAGUE_OK = set("abcdefghijklmnopqrstuvwxyz.0123456789_")


def out(data, cdn=60, swr=None):
    """JSON with CDN caching. Browsers revalidate every time; the edge keeps it `cdn` seconds."""
    swr = swr if swr is not None else cdn * 4
    return JSONResponse(data, headers={
        "Cache-Control": "public, max-age=0, must-revalidate",
        "CDN-Cache-Control": f"public, s-maxage={cdn}, stale-while-revalidate={swr}",
        "Vercel-CDN-Cache-Control": f"public, s-maxage={cdn}, stale-while-revalidate={swr}",
    })


def _league(lg):
    if not lg or not set(lg) <= LEAGUE_OK or len(lg) > 30:
        raise HTTPException(400, "bad league")
    return lg


def _team(t):
    return t if t in espn.TEAMS else "men"


@app.exception_handler(Exception)
async def upstream_down(request: Request, exc: Exception):
    return JSONResponse({"error": "upstream", "detail": type(exc).__name__}, status_code=502,
                        headers={"Cache-Control": "no-store"})


@app.get("/api/health")
async def health():
    return {"ok": True, "now": datetime.now(timezone.utc).isoformat(timespec="seconds")}


@app.get("/api/overview")
async def overview(team: str = "men"):
    team = _team(team)
    rows = await season.schedule(team)
    live = [f for f in rows if f["status"]["state"] == "in"]
    nxt = [f for f in rows if f["status"]["state"] == "pre"]
    done = [f for f in rows if f["status"]["state"] == "post"]
    tid = espn.team(team)["id"]
    form = []
    for f in reversed(done):
        if f["league"] in season.FRIENDLY:
            continue
        me, them = (f["home"], f["away"]) if f["home"]["id"] == tid else (f["away"], f["home"])
        a, b = me.get("score") or 0, them.get("score") or 0
        form.append({"id": f["id"], "league": f["league"], "res": "W" if a > b else "L" if a < b else "D",
                     "opp": them["abbr"], "score": f"{a}-{b}"})
        if len(form) == 5:
            break
    data = {
        "team": team, "info": espn.team(team),
        "live": live, "next": nxt[:6], "last": done[-1] if done else None,
        "form": form,
    }
    return out(data, cdn=10 if live else 45)


@app.get("/api/fixtures")
async def fixtures(team: str = "men"):
    team = _team(team)
    return out({"team": team, "rows": await season.schedule(team)}, cdn=60)


@app.get("/api/match/{league}/{event_id}")
async def match(league: str, event_id: str):
    if not event_id.isdigit():
        raise HTTPException(400, "bad id")
    m = await season.match(_league(league), event_id)
    st = m["status"]["state"]
    return out(m, cdn=8 if st == "in" else 3600 if st == "post" else 60, swr=8 if st == "in" else None)


@app.get("/api/table/{league}")
async def table(league: str):
    league = _league(league)

    async def build():
        j = await espn.standings(league)
        groups = []
        for ch in j.get("children") or []:
            rows = []
            for e in (ch.get("standings") or {}).get("entries") or []:
                s = {x["name"]: x.get("value") for x in e.get("stats") or [] if "name" in x}
                t = e.get("team") or {}
                rows.append({
                    "id": str(t.get("id")), "name": t.get("shortDisplayName") or t.get("displayName"),
                    "abbr": t.get("abbreviation"), "rank": int(s.get("rank") or 0),
                    "p": int(s.get("gamesPlayed") or 0), "w": int(s.get("wins") or 0), "d": int(s.get("ties") or 0),
                    "l": int(s.get("losses") or 0), "gf": int(s.get("pointsFor") or 0), "ga": int(s.get("pointsAgainst") or 0),
                    "gd": int(s.get("pointDifferential") or 0), "pts": int(s.get("points") or 0),
                    "note": (e.get("note") or {}).get("description"),
                })
            rows.sort(key=lambda r: r["rank"] or 99)
            groups.append({"name": ch.get("name") or "", "rows": rows})
        return {"league": league, "name": j.get("name"), "season": (j.get("season") or {}).get("displayName") or "",
                "groups": groups}

    return out(await cached(("table", league), 300, build), cdn=600)


@app.get("/api/news")
async def news_feed(team: str = "men", bsky: str = "", who: str = ""):
    handles = tuple(h.strip().lstrip("@") for h in bsky.split(",") if "." in h.strip())[:6]
    names = tuple(n.strip()[:40] for n in who.split(",") if len(n.strip()) > 3)[:6]
    return out(await news.feed(_team(team), handles, names), cdn=300)


@app.get("/api/model")
async def model():
    r = ratings
    return out({"base": r.BASE, "pos": r.POS, "events": r.W, "labels": r.LABELS, "save": r.SAVE,
                "pen_save": r.PEN_SAVE, "conceded": r.CONCEDED, "clean": r.CLEAN, "result": r.RESULT,
                "minutes": r.MINUTES, "possession": r.POSSESSION, "min_minutes": r.MIN_SECONDS // 60}, cdn=86400)


@app.post("/api/paste")
async def paste(request: Request):
    body = await request.json()
    text, url = str(body.get("text", ""))[:3000], str(body.get("url", ""))[:300]
    res = await news.paste(text, url)
    return JSONResponse(res, headers={"Cache-Control": "no-store"})


@app.get("/api/sources")
async def sources():
    return out(news.SOURCES, cdn=3600)


@app.get("/api/squad")
async def squad(team: str = "men"):
    team = _team(team)
    t = espn.team(team)

    async def build():
        j = None
        for lg in (t["league"], "club.friendly"):
            try:
                j = await espn.roster(lg, t["id"])
                if j.get("athletes"):
                    break
            except Exception:
                continue
        if not j:
            raise RuntimeError("no roster")
        people = []
        for a in j.get("athletes") or []:
            inj = [{"status": i.get("status") or (i.get("type") or {}).get("description"),
                    "detail": (i.get("details") or {}).get("type") or i.get("shortComment") or i.get("longComment"),
                    "back": (i.get("details") or {}).get("returnDate"), "date": i.get("date")}
                   for i in a.get("injuries") or []]
            people.append({
                "id": str(a.get("id")), "name": a.get("displayName"), "no": a.get("jersey"),
                "pos": (a.get("position") or {}).get("abbreviation") or "", "age": a.get("age"),
                "nat": a.get("citizenship") or (a.get("flag") or {}).get("alt"), "injuries": inj,
            })
        coach = (j.get("coach") or [{}])
        coach = coach[0] if isinstance(coach, list) and coach else coach if isinstance(coach, dict) else {}
        return {"team": team, "players": people,
                "coach": " ".join(x for x in (coach.get("firstName"), coach.get("lastName")) if x) or None}

    return out(await cached(("squad", team), 3600, build), cdn=3600)


@app.get("/api/season")
async def season_ratings(team: str = "men", skip: str = ""):
    ids = tuple(sorted(i for i in skip.split(",") if i.isdigit()))[:200]
    return out(await season.ratings(_team(team), ids), cdn=900)


def _ics_escape(s):
    return (s or "").replace("\\", "\\\\").replace(",", "\\,").replace(";", "\\;").replace("\n", "\\n")


@app.get("/api/calendar.ics")
async def calendar(team: str = "men"):
    team = _team(team)
    rows = await season.schedule(team)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//rmtrack//fixtures//EN", "CALSCALE:GREGORIAN",
             f"X-WR-CALNAME:{_ics_escape(espn.team(team)['name'])}", "X-PUBLISHED-TTL:PT6H"]
    for f in rows:
        if f["status"]["state"] == "post" or not f["date"]:
            continue
        start = datetime.fromisoformat(f["date"].replace("Z", "+00:00"))
        end = start + timedelta(hours=2)
        title = f"{f['home'].get('name')} v {f['away'].get('name')}"
        lines += ["BEGIN:VEVENT", f"UID:{f['id']}@rmtrack", f"DTSTAMP:{stamp}",
                  f"DTSTART:{start.strftime('%Y%m%dT%H%M%SZ')}", f"DTEND:{end.strftime('%Y%m%dT%H%M%SZ')}",
                  f"SUMMARY:{_ics_escape(title)}",
                  f"DESCRIPTION:{_ics_escape(f['comp'] + (' - ' + ', '.join(f['tv']) if f['tv'] else ''))}",
                  f"LOCATION:{_ics_escape(f['venue'])}", "END:VEVENT"]
    lines.append("END:VCALENDAR")
    return Response("\r\n".join(lines) + "\r\n", media_type="text/calendar; charset=utf-8", headers={
        "Content-Disposition": f'inline; filename="rmtrack-{team}.ics"',
        "Cache-Control": "public, max-age=3600", "CDN-Cache-Control": "public, s-maxage=3600",
    })
