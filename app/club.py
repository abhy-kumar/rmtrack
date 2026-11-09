"""League tables, squads and recent form, shaped for the front end."""
from . import espn
from .net import cached
from .season import FRIENDLY


def _int(stats, key):
    return int(stats.get(key) or 0)


async def standings(league):
    """Every group of a league table, rows sorted by rank."""

    async def build():
        j = await espn.standings(league)
        groups = []
        for ch in j.get("children") or []:
            rows = []
            for e in (ch.get("standings") or {}).get("entries") or []:
                s = {x["name"]: x.get("value") for x in e.get("stats") or [] if "name" in x}
                t = e.get("team") or {}
                rows.append({
                    "id": str(t.get("id")),
                    "name": t.get("shortDisplayName") or t.get("displayName"),
                    "abbr": t.get("abbreviation"),
                    "rank": _int(s, "rank"),
                    "p": _int(s, "gamesPlayed"),
                    "w": _int(s, "wins"),
                    "d": _int(s, "ties"),
                    "l": _int(s, "losses"),
                    "gf": _int(s, "pointsFor"),
                    "ga": _int(s, "pointsAgainst"),
                    "gd": _int(s, "pointDifferential"),
                    "pts": _int(s, "points"),
                    "note": (e.get("note") or {}).get("description"),
                })
            rows.sort(key=lambda r: r["rank"] or 99)
            groups.append({"name": ch.get("name") or "", "rows": rows})
        return {
            "league": league,
            "name": j.get("name"),
            "season": (j.get("season") or {}).get("displayName") or "",
            "groups": groups,
        }

    return await cached(("table", league), 300, build)


def _injury(i):
    details = i.get("details") or {}
    return {
        "status": i.get("status") or (i.get("type") or {}).get("description"),
        "detail": details.get("type") or i.get("shortComment") or i.get("longComment"),
        "back": details.get("returnDate"),
        "date": i.get("date"),
    }


def _coach(j):
    c = j.get("coach") or {}
    if isinstance(c, list):
        c = c[0] if c else {}
    return " ".join(x for x in (c.get("firstName"), c.get("lastName")) if x) or None


async def squad(team_key):
    """First-team roster with injuries. Falls back to the friendly roster out of season."""
    t = espn.team(team_key)

    async def build():
        j = None
        for lg in (t["league"], "club.friendly"):
            try:
                j = await espn.roster(lg, t["id"])
            except Exception:
                continue
            if j.get("athletes"):
                break
        if not j:
            raise RuntimeError(f"no roster for {team_key}")
        people = [{
            "id": str(a.get("id")),
            "name": a.get("displayName"),
            "no": a.get("jersey"),
            "pos": (a.get("position") or {}).get("abbreviation") or "",
            "age": a.get("age"),
            "nat": a.get("citizenship") or (a.get("flag") or {}).get("alt"),
            "injuries": [_injury(i) for i in a.get("injuries") or []],
        } for a in j.get("athletes") or []]
        return {"team": team_key, "players": people, "coach": _coach(j)}

    return await cached(("squad", team_key), 3600, build)


def form(done, team_id, n=5):
    """Last `n` competitive results, newest first."""
    out = []
    for f in reversed(done):
        if f["league"] in FRIENDLY:
            continue
        me, them = (f["home"], f["away"]) if f["home"]["id"] == team_id else (f["away"], f["home"])
        a, b = me.get("score") or 0, them.get("score") or 0
        out.append({
            "id": f["id"], "league": f["league"], "res": "W" if a > b else "L" if a < b else "D",
            "opp": them["abbr"], "score": f"{a}-{b}",
        })
        if len(out) == n:
            break
    return out
