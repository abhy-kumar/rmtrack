import asyncio
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import espn, main, net
from app.events import read
from app.match import normalize
from app.ratings import rate

SAMPLE = json.loads((Path(__file__).parent / "sample_summary.json").read_text(encoding="utf-8"))


def by_name(players, name):
    return next(p for p in players.all if p["name"] == name)


def test_reader_counts():
    pl, goals, _ = read(SAMPLE, finished=True)
    assert len(goals) == 3
    guler = by_name(pl, "Arda Güler")
    assert guler["ev"]["goals"] == 1 and guler["ev"]["assists"] == 1
    assert by_name(pl, "Thibaut Courtois")["ev"]["conceded_on"] == 0
    assert by_name(pl, "José Gayà")["ev"]["rc"] == 1
    # subbed on in stoppage time, never rated
    assert by_name(pl, "Thiago Pitarch")["seconds"] < 600


def test_ratings_shape():
    m = normalize(SAMPLE, "esp.1")
    rm = m["away"]
    assert rm["abbr"] == "RMA" and rm["score"] == 3
    rated = [p["r"] for p in rm["xi"] if p["r"] is not None]
    assert len(rated) == 11
    assert all(3 <= r <= 10 for r in rated)
    assert m["motm"] == "310452"  # Güler
    assert [p["row"] for p in rm["xi"]][0] == "GK"


def test_cameo_is_unrated():
    p = {"ev": {}, "seconds": 300, "pos": "F"}
    assert rate(p)[0] is None


def test_match_endpoint(monkeypatch):
    async def fake(league, eid):
        return SAMPLE
    monkeypatch.setattr(espn, "summary", fake)
    net._store.clear()
    c = TestClient(main.app)
    r = c.get("/api/match/esp.1/401882808")
    assert r.status_code == 200
    assert "s-maxage=3600" in r.headers["cdn-cache-control"]
    assert r.json()["away"]["name"] == "Real Madrid"
    assert c.get("/api/match/esp.1/abc").status_code == 400
    assert c.get("/api/match/esp 1!/1").status_code in (400, 404)


MORE = json.loads((Path(__file__).parent / "sample_more.json").read_text(encoding="utf-8"))


def test_prematch_has_no_ratings():
    m = normalize(MORE["pre"], "esp.1")
    assert m["status"]["state"] == "pre" and not m["rated"]
    assert m["home"]["form"]


def test_thin_commentary_still_rates():
    m = normalize(MORE["w"], "esp.w.1")
    navarro = next(p for p in m["away"]["xi"] if p["name"] == "Eva Navarro")
    assert navarro["g"] == 1 and navarro["r"] > 7
    assert m["home"]["name"] == "Athletic"


def test_basketball_is_filtered():
    from app.news import _football
    assert not _football({"title": "El Real Madrid de baloncesto gana en la Euroliga"})
    assert not _football({"title": "x", "title_en": "Real Madrid basketball sign a centre"})
    assert _football({"title": "Feliz cumpleaños, Vinicius"})
