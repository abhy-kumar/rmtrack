"""
Refit the rating weights.

1. Open any fotmob.com page, paste scripts/calibrate_collect.js into the
   devtools console (add more ESPN/FotMob id pairs to PAIRS first) and save
   the CSV it prints as ratings.local.csv.
2. python scripts/fit_ratings.py ratings.local.csv
3. Copy the numbers you like into app/ratings.py.

Needs numpy (pip install numpy); the app itself doesn't.
"""
import csv
import sys

import numpy as np

EVENTS = ["goals", "pen_goals", "assists", "key_passes", "sot", "soff", "sblk", "wood", "fouls_c",
          "fouls_w", "yc", "rc", "offs", "pen_won", "pen_conc", "own_goals", "corners_conc", "scored_on"]
GROUPS = ["GK", "DEF", "MID", "ATT"]


def row(r):
    g, mins = r["pos"], float(r["min"])
    share = min(mins, 90) / 90
    x = {k: float(r[k]) for k in EVENTS}
    x["saves"] = float(r["saves"]) if g == "GK" else 0.0
    conc = float(r["conceded_on"])
    for G in GROUPS:
        on = g == G
        x["conc_" + G] = conc if on else 0.0
        x["clean_" + G] = float(on and conc == 0 and mins >= 60)
        x["pos_" + G] = float(on)
        x["res_" + G] = float(r["res"]) * share if on else 0.0
    x["possession"] = (float(r["poss"]) - 50) / 10 * share
    x["minutes"] = share
    return x


def main(path, ridge=2.0):
    with open(path, encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    feats = [row(r) for r in rows]
    names = list(feats[0])
    X = np.array([[f[n] for n in names] for f in feats])
    y = np.array([float(r["fotmob"]) for r in rows]) - 6.0
    games = np.array([r["eid"] for r in rows])
    pen = np.array([0.01 if n.startswith("pos_") else ridge for n in names])

    def fit(A, b):
        return np.linalg.solve(A.T @ A + np.diag(pen), A.T @ b)

    errs = []
    for g in set(games):
        w = fit(X[games != g], y[games != g])
        errs += list(np.abs(X[games == g] @ w - y[games == g]))
    w = fit(X, y)
    print(f"{len(rows)} player-matches, {len(set(games))} games")
    print(f"leave-one-game-out MAE {np.mean(errs):.3f}  (guessing the mean: {np.mean(np.abs(y - y.mean())):.3f})")
    for n, v in sorted(zip(names, w), key=lambda t: -abs(t[1])):
        print(f"  {n:14s} {v:+.3f}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "ratings.local.csv")
