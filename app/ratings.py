"""
Player ratings, 0-10, in the same spirit (and roughly the same scale) as
the big stats apps.

The weights were fitted by least squares against FotMob's published
ratings for 449 player-matches from the first sixteen competitive games of
2026-27, using only what ESPN's commentary tells us. A handful of rare
events never came up in that sample (penalties won or conceded, own goals,
missed penalties) so those carry hand-set values. scripts/fit_ratings.py
re-does the fit whenever there is more data.

Out of sample the model sits about 0.3 of a point from FotMob on average.
"""
from .events import pos_group

BASE = 6.0

# position offsets (before minutes are counted)
POS = {"GK": -0.47, "DEF": 0.27, "MID": 0.04, "ATT": 0.0}

# per event
W = {
    "goals": 0.80,
    "pen_goals": -0.11,   # a penalty is worth a bit less than an open-play goal
    "assists": 0.67,
    "key_passes": 0.18,
    "sot": 0.13,
    "soff": 0.02,
    "sblk": -0.01,
    "wood": 0.22,
    "fouls_c": -0.02,
    "fouls_w": 0.06,
    "yc": -0.05,
    "rc": -1.00,
    "offs": -0.07,
    "hand": -0.10,
    "pen_won": 0.35,
    "pen_conc": -0.50,
    "pen_miss": -0.60,
    "own_goals": -0.80,
    "corners_conc": 0.07,  # the defender who gets a block in tends to concede the corner
    "scored_on": 0.04,
}

LABELS = {
    "goals": "goal", "pen_goals": "of which penalty", "assists": "assist",
    "key_passes": "chance created", "sot": "shot on target", "soff": "shot off target",
    "sblk": "shot blocked", "wood": "hit the woodwork", "fouls_c": "foul committed",
    "fouls_w": "foul won", "yc": "yellow card", "rc": "red card", "offs": "offside",
    "hand": "handball", "pen_won": "penalty won", "pen_conc": "penalty conceded",
    "pen_miss": "penalty missed", "own_goals": "own goal", "corners_conc": "corner conceded",
    "scored_on": "team goal while on", "saves": "save", "pen_saves": "penalty saved",
    "conceded": "goal conceded while on", "clean": "clean sheet", "result": "result",
    "minutes": "minutes played", "position": "position", "possession": "team possession",
}

SAVE = 0.29
PEN_SAVE = 0.80
CONCEDED = {"GK": -0.40, "DEF": -0.29, "MID": -0.01, "ATT": -0.03}
CLEAN = {"GK": 0.58, "DEF": 0.03, "MID": 0.0, "ATT": 0.0}
RESULT = {"GK": 0.06, "DEF": 0.25, "MID": 0.41, "ATT": 0.23}
MINUTES = 0.70        # times the share of 90 minutes played
POSSESSION = 0.045    # per 10 points of possession above 50%, times share of 90

MIN_SECONDS = 10 * 60  # don't rate a cameo


def rate(player, result=0, possession=50.0, finished=False):
    """
    player: a record from events.Players (needs ev, seconds, pos).
    result: +1 win, 0 draw, -1 loss (current score if live).
    Returns (rating or None, breakdown list of (label, delta)).
    """
    secs = player.get("seconds") or 0
    if secs < MIN_SECONDS:
        return None, []
    g = pos_group(player.get("pos"))
    ev = player["ev"]
    share = min(secs, 90 * 60) / (90 * 60)

    parts = [("position", POS[g]), ("minutes", MINUTES * share)]
    for k, w in W.items():
        n = ev.get(k, 0)
        if n:
            parts.append((k, w * n))
    if g == "GK":
        if ev.get("saves"):
            parts.append(("saves", SAVE * ev["saves"]))
        if ev.get("pen_saves"):
            parts.append(("pen_saves", PEN_SAVE * ev["pen_saves"]))
    if ev.get("conceded_on"):
        parts.append(("conceded", CONCEDED[g] * ev["conceded_on"]))
    if not ev.get("conceded_on") and secs >= 60 * 60 and CLEAN[g]:
        parts.append(("clean", CLEAN[g]))
    if result:
        parts.append(("result", RESULT[g] * result * share))
    if possession is not None:
        parts.append(("possession", POSSESSION * (possession - 50) / 10 * share))

    total = BASE + sum(v for _, v in parts)
    total = max(3.0, min(10.0, total))
    shown = [(LABELS.get(k, k), round(v, 2)) for k, v in parts if abs(v) >= 0.005]
    return round(total, 1), shown
