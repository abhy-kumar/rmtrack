"""Squash ESPN payloads into the small shapes the pages use."""
from datetime import datetime, timezone

from . import events, ratings

STAT_ROWS = [
    ("possessionPct", "Possession %"),
    ("totalShots", "Shots"),
    ("shotsOnTarget", "On target"),
    ("blockedShots", "Blocked"),
    ("wonCorners", "Corners"),
    ("offsides", "Offsides"),
    ("foulsCommitted", "Fouls"),
    ("yellowCards", "Yellow cards"),
    ("redCards", "Red cards"),
    ("saves", "Saves"),
    ("accuratePasses", "Passes completed"),
    ("totalPasses", "Passes"),
    ("totalCrosses", "Crosses"),
    ("totalLongBalls", "Long balls"),
    ("totalTackles", "Tackles"),
    ("interceptions", "Interceptions"),
    ("effectiveClearance", "Clearances"),
]

ROWS = ["GK", "DEF", "DM", "MID", "AM", "ATT"]


def _row(abbr):
    a = (abbr or "").upper()
    if a in ("G", "GK"):
        return "GK"
    if a.startswith(("CD", "LB", "RB", "LWB", "RWB", "SW")) or a == "D":
        return "DEF"
    if a.startswith("DM"):
        return "DM"
    if a.startswith("AM"):
        return "AM"
    if a.startswith(("CM", "LM", "RM")) or a == "M":
        return "MID"
    return "ATT"


def _side(abbr):
    # left to right: LB, CD-L, CD, CD-R, RB
    a = (abbr or "").upper()
    if a.endswith("-L"):
        return 1
    if a.endswith("-R"):
        return 3
    if a[:1] == "L" and len(a) > 1:
        return 0
    if a[:1] == "R" and len(a) > 1:
        return 4
    return 2


def status_of(comp):
    st = comp.get("status") or {}
    ty = st.get("type") or {}
    return {
        "state": ty.get("state", "pre"),
        "detail": ty.get("shortDetail") or ty.get("detail") or "",
        "name": ty.get("name", ""),
        "clock": st.get("displayClock") or "",
        "seconds": st.get("clock") or 0,
        "period": st.get("period") or 0,
        "done": bool(ty.get("completed")),
    }


def _team_bits(c):
    t = c.get("team") or {}
    score = c.get("score")
    if isinstance(score, dict):
        score = score.get("displayValue")
    return {
        "id": str(t.get("id") or c.get("id") or ""),
        "name": (t.get("shortDisplayName") or t.get("displayName") or "").strip(),
        "full": (t.get("displayName") or "").strip(),
        "abbr": t.get("abbreviation") or "",
        "score": None if score in (None, "") else int(float(score)),
        "shootout": c.get("shootoutScore"),
    }


def fixture(ev):
    """One row of a schedule."""
    comp = (ev.get("competitions") or [{}])[0]
    sides = {c.get("homeAway"): _team_bits(c) for c in comp.get("competitors", [])}
    st = status_of(comp)
    lg = ev.get("league") or {}
    tv = []
    for b in comp.get("broadcasts") or []:
        name = (b.get("media") or {}).get("shortName") or b.get("names", [None])[0] if isinstance(b, dict) else None
        if name:
            tv.append(name)
    return {
        "id": str(ev.get("id")),
        "date": ev.get("date"),
        "league": lg.get("slug") or "",
        "comp": lg.get("shortName") or lg.get("name") or "",
        "round": (comp.get("notes") or [{}])[0].get("headline", "") if comp.get("notes") else "",
        "home": sides.get("home", {}),
        "away": sides.get("away", {}),
        "status": st,
        "venue": (comp.get("venue") or {}).get("fullName", ""),
        "tv": tv[:3],
    }


def _stats(summary, home_id, away_id):
    teams = {str((t.get("team") or {}).get("id")): {s["name"]: s.get("displayValue") for s in t.get("statistics", [])}
             for t in (summary.get("boxscore") or {}).get("teams", [])}
    h, a = teams.get(home_id, {}), teams.get(away_id, {})
    out = []
    for key, label in STAT_ROWS:
        if key in h or key in a:
            out.append({"k": key, "label": label, "home": h.get(key, "-"), "away": a.get(key, "-")})
    return out, h, a


def _kind(play_type, text):
    t = text or ""
    if play_type == "goal" or t.startswith("Goal!"):
        return "goal"
    if play_type == "yellow-card" or "yellow card" in t:
        return "red" if "second yellow" in t else "yellow"
    if play_type == "red-card" or "red card" in t:
        return "red"
    if play_type == "substitution" or t.startswith("Substitution"):
        return "sub"
    if t.startswith(("Penalty saved", "Penalty missed")):
        return "penmiss"
    if t.startswith("VAR"):
        return "var"
    if play_type.startswith("shot") or t.startswith("Attempt") or " hits the " in t:
        return "shot"
    if play_type in ("foul",) or t.startswith("Foul by") or "wins a free kick" in t:
        return "foul"
    if play_type in ("offside",):
        return "offside"
    if play_type == "corner-awarded" or t.startswith("Corner,"):
        return "corner"
    if t.startswith(("First Half", "Second Half", "Match ends", "Lineups are", "End of", "Penalty Shootout")) or play_type in ("halftime", "end-regular-time"):
        return "period"
    return "other"


def normalize(summary, league):
    head = summary.get("header") or {}
    comp = (head.get("competitions") or [{}])[0]
    sides = {c.get("homeAway"): c for c in comp.get("competitors", [])}
    home, away = _team_bits(sides.get("home", {})), _team_bits(sides.get("away", {}))
    st = status_of(comp)
    finished = st["state"] == "post"

    stats, hst, ast = _stats(summary, home["id"], away["id"])
    side_of = {home["id"]: "home", away["id"]: "away"}
    name_side = {events.norm(home["full"]): "home", events.norm(away["full"]): "away"}

    # commentary
    feed = []
    for c in sorted(summary.get("commentary") or [], key=lambda c: c.get("sequence", 0)):
        play = c.get("play") or {}
        kind = _kind((play.get("type") or {}).get("type", ""), c.get("text", ""))
        feed.append({
            "m": (c.get("time") or {}).get("displayValue") or "",
            "t": (c.get("time") or {}).get("value") or 0,
            "k": kind,
            "s": name_side.get(events.norm((play.get("team") or {}).get("displayName"))),
            "x": c.get("text", ""),
        })
    timeline = [f for f in feed if f["k"] in ("goal", "yellow", "red", "sub", "penmiss", "var")]

    # players and ratings
    now = None
    if st["state"] == "in":
        now = st["seconds"] or (feed[-1]["t"] if feed else 0)
    players, goals, _ = events.read(summary, now_seconds=now, finished=finished)
    poss = {home["id"]: _num(hst.get("possessionPct")), away["id"]: _num(ast.get("possessionPct"))}
    score = {home["id"]: home["score"] or 0, away["id"]: away["score"] or 0}

    formations = {str((r.get("team") or {}).get("id")): r.get("formation") for r in summary.get("rosters") or []}
    lineups = {"home": {"formation": formations.get(home["id"]), "xi": [], "bench": []},
               "away": {"formation": formations.get(away["id"]), "xi": [], "bench": []}}
    best = None
    for p in players.all:
        side = side_of.get(p["team"])
        if not side:
            continue
        opp = away["id"] if side == "home" else home["id"]
        res = (score[p["team"]] > score[opp]) - (score[p["team"]] < score[opp])
        rating, why = (None, [])
        if st["state"] != "pre":
            rating, why = ratings.rate(p, res if (finished or st["state"] == "in") else 0, poss.get(p["team"]), finished)
        ev = p["ev"]
        rec = {
            "id": p["id"], "name": p["name"], "short": p["short"], "no": p["jersey"],
            "pos": p["pos"], "row": _row(p["pos"]), "side": _side(p["pos"]),
            "on": _mins(p["on"]), "off": _mins(p["off"]), "mins": round((p.get("seconds") or 0) / 60),
            "r": rating, "why": why,
            "g": ev["goals"], "a": ev["assists"], "y": ev["yc"], "rc": ev["rc"], "og": ev["own_goals"],
        }
        lineups[side]["xi" if p["starter"] else "bench"].append(rec)
        if rating is not None and (best is None or rating > best[0]):
            best = (rating, p["id"])
    for side in lineups.values():
        side["xi"].sort(key=lambda r: (ROWS.index(r["row"]), r["side"]))
        side["bench"].sort(key=lambda r: (r["on"] is None, r["on"] or 0))

    form = {}
    for t in summary.get("lastFiveGames") or []:
        tid = str((t.get("team") or {}).get("id", ""))
        form[side_of.get(tid, tid)] = [
            {"date": e.get("gameDate"), "opp": (e.get("opponent") or {}).get("abbreviation"),
             "at": e.get("atVs"), "score": e.get("score"), "res": e.get("gameResult")}
            for e in t.get("events") or []
        ]

    h2h = []
    for blk in summary.get("headToHeadGames") or []:
        for e in blk.get("events") or []:
            h2h.append({"date": e.get("gameDate"), "score": e.get("score"), "res": e.get("gameResult"),
                        "comp": e.get("leagueAbbreviation") or e.get("competitionName"), "at": e.get("atVs")})
        break

    info = summary.get("gameInfo") or {}
    officials = [o.get("displayName") for o in info.get("officials") or [] if o.get("displayName")]
    return {
        "id": str(head.get("id") or ""),
        "league": league,
        "comp": (head.get("league") or {}).get("name") or "",
        "date": comp.get("date"),
        "status": st,
        "home": {**home, **lineups["home"], "form": form.get("home", [])},
        "away": {**away, **lineups["away"], "form": form.get("away", [])},
        "venue": (info.get("venue") or {}).get("fullName", ""),
        "city": ((info.get("venue") or {}).get("address") or {}).get("city", ""),
        "crowd": info.get("attendance"),
        "ref": officials[0] if officials else None,
        "timeline": timeline,
        "feed": feed,
        "stats": stats,
        "motm": best[1] if (best and finished) else None,
        "h2h": h2h[:6],
        "rated": st["state"] != "pre",
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _mins(secs):
    if secs is None:
        return None
    return int(secs // 60) + (0 if secs % 60 == 0 and secs else 1) if secs else 0
