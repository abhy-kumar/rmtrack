import asyncio
import json
import random
from pathlib import Path

from app import espn, league, xg

SAMPLE = json.loads((Path(__file__).parent / "sample_summary.json").read_text(encoding="utf-8"))


def test_league_collect_and_aggregate(tmp_path, monkeypatch):
    monkeypatch.setattr(league, "ROOT", tmp_path)

    async def standings_json(url, **k):
        return {"children": [{"standings": {"entries": [{"team": {"id": "86"}}, {"team": {"id": "94"}}]}}]}

    async def sched(tid, fixtures=False):
        return {"events": [{"id": "401882808", "league": {"slug": "esp.1"},
                            "competitions": [{"status": {"type": {"completed": True}}}]}]}

    async def summ(lg, eid):
        return SAMPLE

    monkeypatch.setattr(league, "get_json", standings_json)
    monkeypatch.setattr(espn, "schedule", sched)
    monkeypatch.setattr(espn, "summary", summ)
    asyncio.run(league.run(["esp.1"]))

    players = json.loads((tmp_path / "esp.1" / "players.json").read_text())["players"]
    teams = {t["abbr"]: t for t in json.loads((tmp_path / "esp.1" / "teams.json").read_text())["teams"]}
    guler = next(p for p in players if p["name"] == "Arda Güler")
    assert guler["g"] == 1 and guler["a"] == 1 and guler["xa"] > 0 and guler["pos"] == "AM"
    assert teams["RMA"]["gf"] == 3 and teams["RMA"]["xgf"] > teams["VAL"]["xgf"]
    assert teams["RMA"]["sh"] == 19

    # second run with nothing new leaves things alone
    asyncio.run(league.run(["esp.1"]))


def test_xg_fit_recovers_known_model():
    random.seed(4)
    true = [-1.2, -0.11, 1.4, -0.4, -0.02]
    m = {"coef": true, "penalty": 0.76}
    shots = []
    for _ in range(4000):
        x, y, h = random.uniform(60, 99), random.uniform(15, 85), random.random() < 0.2
        p = xg.predict(x, y, h, False, m)
        shots.append((x, y, h, random.random() < p))
    w = xg.fit(shots, start=[-1.7, -0.08, 1.6, -0.3, -0.04], ridge=0.1)
    assert xg.score(shots, w)["logloss"] <= xg.score(shots, true)["logloss"] + 0.005
    assert abs(w[1] - true[1]) < 0.04


def test_xg_shape():
    near, far = xg.predict(95, 50), xg.predict(75, 50)
    assert 0.3 < near < 0.8 and 0.02 < far < 0.1
    assert xg.predict(95, 50, head=True) < near
    assert xg.predict(10, 10, pen=True) == xg.model()["penalty"]
