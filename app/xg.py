"""
Expected goals from shot position.

ESPN's commentary gives the spot each shot was hit from (0-100 both ways,
attacking towards x=100). We turn that into distance and the angle the
goal mouth makes from there, add whether it was a header, and run it
through a logistic model:

    p(goal) = 1 / (1 + exp(-(b0 + b1*distance + b2*angle + b3*header + b4*header*distance)))

Penalties get a flat value. The coefficients live in xg.json. They start
from a prior anchored to the usual public xG numbers and get refitted on
every shot we've stored each time the collector runs (fit() below).
"""
import json
import math
from pathlib import Path

PATH = Path(__file__).parent / "xg.json"
PITCH_L, PITCH_W, GOAL_W = 105.0, 68.0, 7.32
FEATURES = ["const", "dist", "angle", "head", "head_dist"]

_model = None


def model():
    global _model
    if _model is None:
        _model = json.loads(PATH.read_text(encoding="utf-8"))
    return _model


def for_league(league):
    """Women's games get their own fit once there are enough shots."""
    m = model()
    if (league or "").startswith(("esp.w", "uefa.w")) and m.get("coef_w"):
        return {**m, "coef": m["coef_w"]}
    return m


def geometry(x, y):
    """Distance (m) and goal-mouth angle (radians) from an ESPN position."""
    dx = max(0.5, PITCH_L - x / 100 * PITCH_L)
    dy = abs(y / 100 * PITCH_W - PITCH_W / 2)
    dist = math.hypot(dx, dy)
    half = GOAL_W / 2
    ang = math.atan2(GOAL_W * dx, dx * dx + dy * dy - half * half)
    if ang < 0:
        ang += math.pi
    return dist, ang


def row(x, y, head):
    d, a = geometry(x, y)
    h = 1.0 if head else 0.0
    return [1.0, d, a, h, h * d]


def predict(x, y, head=False, pen=False, m=None):
    m = m or model()
    if pen:
        return m["penalty"]
    if x is None or y is None:
        return None
    z = sum(c * f for c, f in zip(m["coef"], row(x, y, head)))
    return round(1 / (1 + math.exp(-z)), 3)


def _solve(A, b):
    n = len(b)
    M = [r[:] + [b[i]] for i, r in enumerate(A)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(M[r][c]))
        M[c], M[p] = M[p], M[c]
        if abs(M[c][c]) < 1e-12:
            raise ValueError("singular")
        for r in range(n):
            if r != c:
                f = M[r][c] / M[c][c]
                for k in range(c, n + 1):
                    M[r][k] -= f * M[c][k]
    return [M[i][n] / M[i][i] for i in range(n)]


def fit(shots, start=None, ridge=1.0, iters=25):
    """
    shots: iterable of (x, y, head, goal) for non-penalty shots.
    Newton-Raphson on the log-likelihood with a light ridge pull towards
    the starting coefficients, so a thin sample can't do anything silly.
    """
    X = [row(x, y, h) for x, y, h, _ in shots]
    Y = [1.0 if g else 0.0 for *_, g in shots]
    w0 = list(start or model()["coef"])
    w = w0[:]
    n = len(w)
    for _ in range(iters):
        g = [-ridge * (w[i] - w0[i]) for i in range(n)]
        H = [[(ridge if i == j else 0.0) for j in range(n)] for i in range(n)]
        for xi, yi in zip(X, Y):
            z = sum(a * b for a, b in zip(w, xi))
            p = 1 / (1 + math.exp(-max(-30, min(30, z))))
            r = yi - p
            v = p * (1 - p)
            for i in range(n):
                g[i] += r * xi[i]
                for j in range(i, n):
                    H[i][j] += v * xi[i] * xi[j]
        for i in range(n):
            for j in range(i):
                H[i][j] = H[j][i]
        step = _solve(H, g)
        w = [a + s for a, s in zip(w, step)]
        if max(abs(s) for s in step) < 1e-6:
            break
    return w


def score(shots, coef):
    """Log loss and totals, to check a fit is better than what we had."""
    ll, xg, goals = 0.0, 0.0, 0
    m = {"coef": coef, "penalty": 0.76}
    for x, y, h, g in shots:
        p = predict(x, y, h, False, m)
        p = min(max(p, 1e-4), 1 - 1e-4)
        ll -= math.log(p if g else 1 - p)
        xg += p
        goals += 1 if g else 0
    n = max(1, len(shots))
    return {"logloss": round(ll / n, 4), "xg": round(xg, 1), "goals": goals, "n": len(shots)}
