"""
League-wide data: every finished match in the leagues below, for every
team and player, not just ours.

For each match we keep a compact file (shot positions plus per-player
event counts and ratings) under public/data/lg/<league>/m/. From those we
rebuild players.json and teams.json each run, refit the xG model on all
stored shots, and recompute every xG number with the new fit.

    python -m app.collect --leagues
"""
import asyncio
import json
import logging
from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path

from . import espn, events, ratings, xg
from .match import pos_row
from .net import get_json

ROOT = Path(__file__).resolve().parent.parent / "public" / "data" / "lg"
log = logging.getLogger("rmtrack.league")
LEAGUES = {
    "esp.1": "m", "uefa.champions": "m",
    "esp.w.1": "w", "uefa.wchampions": "w",
}
MIN_SHOTS_TO_FIT = 1500

P_FIELDS = ["pid", "name", "side", "pos", "mins", "start", "g", "a", "kp", "sot", "soff", "sblk", "wood",
            "fc", "fw", "yc", "rc", "offs", "saves", "conc", "r", "pg", "og"]
S_FIELDS = ["t", "side", "pid", "ast", "x", "y", "head", "pen", "k"]


def _load(path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return default


def _save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)


async def _ids(league, sem):
    """Finished matches in a league, found through each team's schedule."""
    st = await get_json(f"{espn.V2}/{league}/standings")
    teams = {e["team"]["id"] for ch in st.get("children") or [] for e in (ch.get("standings") or {}).get("entries") or []}
    found = set()

    async def one(tid):
        async with sem:
            try:
                sc = await espn.schedule(tid)
            except Exception:
                return
        for ev in sc.get("events") or []:
            comp = (ev.get("competitions") or [{}])[0]
            if (ev.get("league") or {}).get("slug") == league and ((comp.get("status") or {}).get("type") or {}).get("completed"):
                found.add(str(ev["id"]))

    await asyncio.gather(*(one(t) for t in teams))
    return found


def compact(summary, league):
    head = summary.get("header") or {}
    comp = (head.get("competitions") or [{}])[0]
    sides = {c.get("homeAway"): c for c in comp.get("competitors", [])}
    teams = {}
    for k in ("home", "away"):
        c = sides.get(k) or {}
        t = c.get("team") or {}
        teams[k] = {
            "id": str(t.get("id") or c.get("id") or ""),
            "name": (t.get("shortDisplayName") or t.get("displayName") or "").strip(),
            "abbr": t.get("abbreviation") or "",
            "score": int(float(c.get("score") or 0)),
        }
    side = {teams["home"]["id"]: 0, teams["away"]["id"]: 1}
    for t in (summary.get("boxscore") or {}).get("teams") or []:
        tid = str((t.get("team") or {}).get("id"))
        st = {s["name"]: s.get("displayValue") for s in t.get("statistics") or []}
        for k in ("home", "away"):
            if teams[k]["id"] == tid:
                try:
                    teams[k]["poss"] = float(st.get("possessionPct"))
                except (TypeError, ValueError):
                    teams[k]["poss"] = None
                teams[k]["fouls"] = int(float(st.get("foulsCommitted") or 0))

    pl, _, _ = events.read(summary, finished=True)
    score = {teams["home"]["id"]: teams["home"]["score"], teams["away"]["id"]: teams["away"]["score"]}
    poss = {teams[k]["id"]: teams[k].get("poss") for k in teams}
    rows = []
    for p in pl.all:
        if p["team"] not in side or not p.get("seconds"):
            continue
        opp = next(t for t in score if t != p["team"])
        res = (score[p["team"]] > score[opp]) - (score[p["team"]] < score[opp])
        r, _ = ratings.rate(p, res, poss.get(p["team"]), True)
        e = p["ev"]
        rows.append([p["id"], p["name"], side[p["team"]], p["pos"], round(p["seconds"] / 60), int(p["starter"]),
                     e["goals"], e["assists"], e["key_passes"], e["sot"], e["soff"], e["sblk"], e["wood"],
                     e["fouls_c"], e["fouls_w"], e["yc"], e["rc"], e["offs"], e["saves"], e["conceded_on"],
                     r, e["pen_goals"], e["own_goals"]])
    shots = [[s["t"], side.get(s["team"], 0), s["pid"], s.get("ast"), s["x"], s["y"], int(s["head"]), int(s["pen"]), s["k"]]
             for s in pl.shots]
    return {"id": str(head.get("id")), "lg": league, "date": comp.get("date"), "home": teams["home"], "away": teams["away"],
            "pf": P_FIELDS, "sf": S_FIELDS, "players": rows, "shots": shots}


async def fetch_new(league):
    folder = ROOT / league / "m"
    have = {p.stem for p in folder.glob("*.json")}
    sem = asyncio.Semaphore(6)
    ids = await _ids(league, sem)
    todo = sorted(ids - have)
    new = 0

    async def one(eid):
        nonlocal new
        async with sem:
            try:
                s = await espn.summary(league, eid)
            except Exception as e:
                log.warning("%s %s failed: %s", league, eid, e)
                return
        c = compact(s, league)
        if c["players"]:
            _save(folder / f"{eid}.json", c)
            new += 1

    await asyncio.gather(*(one(e) for e in todo))
    return new, len(ids)


def _matches(league):
    out = []
    for p in sorted((ROOT / league / "m").glob("*.json")):
        m = _load(p)
        if m:
            out.append(m)
    out.sort(key=lambda m: m.get("date") or "")
    return out


def refit(gender):
    """Refit xG for one gender on every stored open-play shot."""
    shots = []
    for lg, g in LEAGUES.items():
        if g != gender:
            continue
        for m in _matches(lg):
            for s in m["shots"]:
                _, _, _, _, x, y, head, pen, k = s
                if not pen and x is not None:
                    shots.append((x, y, head, k == "goal"))
    cur = xg.model()
    key = "coef" if gender == "m" else "coef_w"
    start = cur.get(key) or cur["coef"]
    if len(shots) < MIN_SHOTS_TO_FIT:
        return f"{gender}: {len(shots)} shots, keeping current model"
    new = xg.fit(shots, start=start)
    before, after = xg.score(shots, start), xg.score(shots, new)
    if after["logloss"] <= before["logloss"] + 1e-4:
        cur[key] = [round(v, 5) for v in new]
        cur[f"fit_{gender}"] = {"shots": len(shots), "goals": after["goals"], "xg": after["xg"], "logloss": after["logloss"],
                                "at": datetime.now(UTC).isoformat(timespec="seconds")}
        cur["source"] = "fitted"
        xg.PATH.write_text(json.dumps(cur, indent=1), encoding="utf-8")
        xg._model = None
        _save(ROOT.parent / "model" / "xg.json", cur)
        return (f"{gender}: refit on {len(shots)} shots, logloss {before['logloss']} -> {after['logloss']}, "
                f"xG {after['xg']} vs {after['goals']} goals")
    return f"{gender}: new fit no better ({after['logloss']} vs {before['logloss']}), kept"


def aggregate(league):
    """players.json and teams.json for one league, from the stored matches."""
    gender = LEAGUES[league]
    m_xg = dict(xg.model())
    if gender == "w" and m_xg.get("coef_w"):
        m_xg["coef"] = m_xg["coef_w"]
    players = {}
    teams = {}
    pos_seen = defaultdict(Counter)

    def team(tid, info):
        return teams.setdefault(tid, {"id": tid, "name": info["name"], "abbr": info["abbr"], "p": 0, "w": 0, "d": 0, "l": 0,
                                      "gf": 0, "ga": 0, "xgf": 0.0, "xga": 0.0, "npxgf": 0.0, "npxga": 0.0, "sh": 0, "sha": 0,
                                      "sot": 0, "sota": 0, "box": 0, "boxa": 0, "poss": [], "fc": 0, "yc": 0, "rc": 0, "log": []})

    for m in _matches(league):
        sides = [m["home"], m["away"]]
        idx = {f: i for i, f in enumerate(m["pf"])}
        xg_by = [0.0, 0.0]
        npxg_by = [0.0, 0.0]
        sh_by, sot_by, box_by = [0, 0], [0, 0], [0, 0]
        pxg, pnpxg, pxa = Counter(), Counter(), Counter()
        for s in m["shots"]:
            _, side, pid, ast, x, y, head, pen, k = s
            v = xg.predict(x, y, head, pen, m_xg) or 0
            xg_by[side] += v
            sh_by[side] += 1
            if k in ("goal", "saved"):
                sot_by[side] += 1
            if x is not None and x >= 84.3 and 20.4 <= y <= 79.6:
                box_by[side] += 1
            pxg[pid] += v
            if not pen:
                npxg_by[side] += v
                pnpxg[pid] += v
            if ast:
                pxa[ast] += v
        for i, info in enumerate(sides):
            T = team(info["id"], info)
            o = sides[1 - i]
            gf, ga = info["score"], o["score"]
            T["p"] += 1
            T["w" if gf > ga else "l" if gf < ga else "d"] += 1
            T["gf"] += gf
            T["ga"] += ga
            T["xgf"] += xg_by[i]
            T["xga"] += xg_by[1 - i]
            T["npxgf"] += npxg_by[i]
            T["npxga"] += npxg_by[1 - i]
            T["sh"] += sh_by[i]
            T["sha"] += sh_by[1 - i]
            T["sot"] += sot_by[i]
            T["sota"] += sot_by[1 - i]
            T["box"] += box_by[i]
            T["boxa"] += box_by[1 - i]
            if info.get("poss") is not None:
                T["poss"].append(info["poss"])
            T["log"].append([m["id"], m["date"], o["abbr"], "h" if i == 0 else "a", gf, ga,
                             round(xg_by[i], 2), round(xg_by[1 - i], 2)])
        for row in m["players"]:
            get = lambda f, row=row, idx=idx: row[idx[f]]
            side = get("side")
            info, opp = sides[side], sides[1 - side]
            T = teams[info["id"]]
            T["fc"] += get("fc")
            T["yc"] += get("yc")
            T["rc"] += get("rc")
            pid = get("pid")
            P = players.setdefault(pid, {"id": pid, "name": get("name"), "team": info["id"], "apps": 0, "starts": 0, "mins": 0,
                                         "g": 0, "pg": 0, "a": 0, "xg": 0.0, "npxg": 0.0, "xa": 0.0, "sh": 0, "sot": 0, "kp": 0,
                                         "fw": 0, "fc": 0, "yc": 0, "rc": 0, "offs": 0, "saves": 0, "conc": 0, "rsum": 0.0,
                                         "rn": 0, "log": []})
            P["team"] = info["id"]  # latest club, for mid-season moves
            if get("pos") and get("pos") != "SUB":
                pos_seen[pid][pos_row(get("pos"))] += get("mins")
            P["apps"] += 1
            P["starts"] += get("start")
            P["mins"] += get("mins")
            for f in ("g", "pg", "a", "kp", "fw", "fc", "yc", "rc", "offs", "saves", "conc"):
                P[f] += get(f)
            P["sh"] += get("sot") + get("soff") + get("sblk") + get("wood") + get("g")
            P["sot"] += get("sot") + get("g")
            P["xg"] += pxg[pid]
            P["npxg"] += pnpxg[pid]
            P["xa"] += pxa[pid]
            if get("r") is not None:
                P["rsum"] += get("r")
                P["rn"] += 1
            P["log"].append([m["id"], m["date"], opp["abbr"], get("mins"), get("g"), get("a"),
                             round(pxg[pid], 2), round(pxa[pid], 2), get("r")])

    for pid, P in players.items():
        P["pos"] = pos_seen[pid].most_common(1)[0][0] if pos_seen[pid] else "MID"
        P["r"] = round(P.pop("rsum") / P["rn"], 2) if P["rn"] else None
        P.pop("rn")
        for f in ("xg", "npxg", "xa"):
            P[f] = round(P[f], 2)
    for T in teams.values():
        T["poss"] = round(sum(T["poss"]) / len(T["poss"]), 1) if T["poss"] else None
        for f in ("xgf", "xga", "npxgf", "npxga"):
            T[f] = round(T[f], 2)
    now = datetime.now(UTC).isoformat(timespec="seconds")
    _save(ROOT / league / "players.json", {"lg": league, "updated": now, "players": list(players.values())})
    _save(ROOT / league / "teams.json", {"lg": league, "updated": now, "teams": list(teams.values())})
    return len(players), len(teams)


async def run(leagues=None, force=False):
    leagues = leagues or list(LEAGUES)
    changed = []
    for lg in leagues:
        try:
            new, total = await fetch_new(lg)
            log.info("%s: %d new of %d finished", lg, new, total)
            if new or force or not (ROOT / lg / "players.json").exists():
                changed.append(lg)
        except Exception:
            log.exception("%s: collect failed", lg)
    if not changed:
        log.info("leagues: nothing new, aggregates left alone")
        return
    for g in sorted({LEAGUES[lg] for lg in changed}):
        log.info("xg %s", refit(g))
    for lg in leagues:
        if (ROOT / lg / "m").exists() and (lg in changed or force):
            n, t = aggregate(lg)
            log.info("%s: %d players, %d teams", lg, n, t)
