"""
Turns ESPN's text commentary into per-player event counts.

ESPN's per-player box score is thin (goals, shots, cards, saves). The
commentary is Opta-style and far richer, so most of what the ratings
know about a player comes from reading it line by line.
"""
import re
import unicodedata

FOUL_BY = re.compile(r"^Foul by (.+?) \(")
WINS_FK = re.compile(r"^(.+?) \([^)]*\) wins a free kick")
OFFSIDE = re.compile(r"(?:, but |\. )([^.,]+?) is caught offside")
HANDBALL = re.compile(r"^Handball by (.+?) \(")
PEN_CONCEDED = re.compile(r"Penalty conceded by (.+?) \(")
PEN_WON = re.compile(r"(?:\. |^)([^.]+?) draws a foul in the penalty area")
SAVED_BY = re.compile(r"saved .*?by (.+?) \(")
CORNER_BY = re.compile(r"Conceded by (.+?)\.$")
SUB = re.compile(r"Substitution, [^.]+\. (.+?) replaces (.+?)(?: because|\.|$)")

FULL_TIME_SECONDS = 90 * 60


def norm(name):
    if not name:
        return ""
    s = unicodedata.normalize("NFKD", name)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return re.sub(r"[^a-z ]", "", s.lower().replace("-", " ")).strip()


def pos_group(abbr):
    a = (abbr or "").upper()
    if a in ("G", "GK"):
        return "GK"
    if a.startswith(("CD", "LB", "RB", "LWB", "RWB", "SW")) or a == "D":
        return "DEF"
    if a.startswith(("DM", "CM", "LM", "RM")) or a == "M":
        return "MID"
    if a.startswith(("AM", "F", "CF", "LF", "RF", "LW", "RW", "S")):
        return "ATT"
    return "MID"


BLANK = dict(
    goals=0, pen_goals=0, assists=0, key_passes=0, sot=0, soff=0, sblk=0,
    wood=0, fouls_c=0, fouls_w=0, yc=0, rc=0, offs=0, hand=0, pen_won=0,
    pen_conc=0, pen_miss=0, own_goals=0, saves=0, pen_saves=0, corners_conc=0,
    scored_on=0, conceded_on=0,
)


class Players:
    """Roster lookup by (normalised) name, both teams."""

    def __init__(self, rosters):
        self.by_name = {}
        self.by_last = {}
        self.all = []
        for r in rosters or []:
            team_id = str(r.get("team", {}).get("id", ""))
            for p in r.get("roster", []):
                a = p.get("athlete", {})
                rec = {
                    "id": str(a.get("id", "")),
                    "name": a.get("displayName", ""),
                    "short": a.get("shortName") or a.get("displayName", ""),
                    "team": team_id,
                    "jersey": p.get("jersey"),
                    "starter": bool(p.get("starter")),
                    "pos": (p.get("position") or {}).get("abbreviation", ""),
                    "place": p.get("formationPlace"),
                    "on": 0 if p.get("starter") else None,
                    "off": None,
                    "ev": dict(BLANK),
                }
                self.all.append(rec)
                self.by_name[norm(rec["name"])] = rec
                last = norm(rec["name"]).split(" ")[-1]
                self.by_last.setdefault((team_id, last), []).append(rec)
                self.by_last.setdefault((None, last), []).append(rec)

    def find(self, name, team=None):
        if not name:
            return None
        n = norm(name)
        rec = self.by_name.get(n)
        if rec:
            return rec
        last = n.split(" ")[-1]
        hits = self.by_last.get((team, last)) or self.by_last.get((None, last)) or []
        return hits[0] if len(hits) == 1 else None


def _names(play):
    return [(p.get("athlete") or {}).get("displayName") for p in (play or {}).get("participants", [])]


def read(summary, now_seconds=None, finished=False):
    """
    Walk the commentary once. Returns (players, timeline) where players is
    the Players object with .ev filled in and on/off minutes set.
    """
    players = Players(summary.get("rosters"))
    comps = summary.get("header", {}).get("competitions", [{}])[0].get("competitors", [])
    team_by_name = {}
    for c in comps:
        t = c.get("team", {})
        team_by_name[norm(t.get("displayName"))] = str(t.get("id", c.get("id", "")))

    entries = sorted(summary.get("commentary") or [], key=lambda c: c.get("sequence", 0))
    last_t = 0
    goals = []

    for c in entries:
        text = (c.get("text") or "").strip()
        play = c.get("play") or {}
        kind = (play.get("type") or {}).get("type", "")
        t = (c.get("time") or {}).get("value") or (play.get("clock") or {}).get("value") or last_t
        last_t = max(last_t, t or 0)
        team_id = team_by_name.get(norm((play.get("team") or {}).get("displayName")))
        names = _names(play)

        def bump(name, key, n=1, team=team_id):
            rec = players.find(name, team)
            if rec:
                rec["ev"][key] += n
            return rec

        if kind == "goal" or text.startswith("Goal!"):
            own = "own goal" in text.lower()
            scorer = players.find(names[0], None if own else team_id) if names else None
            if own and scorer:
                scorer["ev"]["own_goals"] += 1
                scoring_team = next((x for x in team_by_name.values() if x != scorer["team"]), team_id)
            else:
                scoring_team = team_id or (scorer or {}).get("team")
                if scorer:
                    scorer["ev"]["goals"] += 1
                    if "penalty" in text.lower():
                        scorer["ev"]["pen_goals"] += 1
                if len(names) > 1:
                    bump(names[1], "assists")
            goals.append((t, scoring_team))
            continue

        if kind == "substitution" or text.startswith("Substitution"):
            m = SUB.search(text)
            on_name, off_name = (names + [None, None])[:2] if len(names) >= 2 else (m.groups() if m else (None, None))
            off = players.find(off_name, team_id)
            on = players.find(on_name, team_id)
            if off:
                off["off"] = t
            if on:
                on["on"] = t
                if off and (not on["pos"] or on["pos"] == "SUB"):
                    on["pos"] = off["pos"]
            continue

        if kind.startswith("shot") or text.startswith(("Attempt", "Penalty saved", "Penalty missed")) or " hits the " in text:
            shooter = players.find(names[0], team_id) if names else None
            low = text.lower()
            if shooter:
                if text.startswith("Penalty saved") or text.startswith("Penalty missed"):
                    shooter["ev"]["pen_miss"] += 1
                elif " hits the " in text and ("post" in low or "bar" in low):
                    shooter["ev"]["wood"] += 1
                elif text.startswith("Attempt saved") or kind == "shot-on-target":
                    shooter["ev"]["sot"] += 1
                elif text.startswith("Attempt blocked") or kind == "shot-blocked":
                    shooter["ev"]["sblk"] += 1
                else:
                    shooter["ev"]["soff"] += 1
            if len(names) > 1 and "Assisted by" in text:
                bump(names[1], "key_passes")
            m = SAVED_BY.search(text)
            if m:
                keeper = players.find(m.group(1))
                if keeper:
                    keeper["ev"]["pen_saves" if text.startswith("Penalty saved") else "saves"] += 1
            continue

        if kind == "foul" or text.startswith("Foul by") or "wins a free kick" in text:
            m = FOUL_BY.search(text)
            if m:
                bump(m.group(1), "fouls_c")
            m = WINS_FK.search(text)
            if m:
                bump(m.group(1), "fouls_w")
            continue

        if kind in ("yellow-card", "red-card") or "is shown the" in text:
            rec = players.find(names[0], team_id) if names else None
            if rec:
                if "second yellow" in text or kind == "red-card" or "red card" in text:
                    rec["ev"]["rc"] += 1
                    if rec["off"] is None:
                        rec["off"] = t
                else:
                    rec["ev"]["yc"] += 1
            continue

        m = PEN_CONCEDED.search(text)
        if m:
            bump(m.group(1), "pen_conc")
            continue
        m = PEN_WON.search(text)
        if m:
            bump(m.group(1), "pen_won")
            continue
        m = OFFSIDE.search(text)
        if m:
            bump(m.group(1), "offs")
            continue
        m = HANDBALL.search(text)
        if m:
            bump(m.group(1), "hand")
            continue
        if text.startswith("Corner,"):
            m = CORNER_BY.search(text)
            if m:
                bump(m.group(1), "corners_conc", team=None)

    end = max(last_t, FULL_TIME_SECONDS) if finished else (now_seconds or last_t)

    for p in players.all:
        if p["on"] is None:
            continue
        off = p["off"] if p["off"] is not None else end
        p["seconds"] = max(0, off - p["on"])
        for (gt, team) in goals:
            if p["on"] <= gt <= off:
                if team == p["team"]:
                    p["ev"]["scored_on"] += 1
                else:
                    p["ev"]["conceded_on"] += 1

    return players, goals, end
