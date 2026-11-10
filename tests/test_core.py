import json
from pathlib import Path

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
    assert rm["xi"][0]["row"] == "GK"


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
    assert not _football({"title": "El UCAM Murcia CB planta cara pero sucumbe ante el Real Madrid en el último cuarto"})
    assert not _football({"title": "x", "title_en": "The Bernabeu once again enjoyed the NFL show"})
    assert not _football({"title": "Real Madrid (F) - Paris FC (F) | Pronóstico y cuotas 10.11.2026"})
    assert _football({"title": "El Madrid, a cuartos de final de la Copa"})


def test_key_events_carry_player_ids():
    m = normalize(SAMPLE, "esp.1")
    goals = [e for e in m["timeline"] if e["k"] == "goal"]
    assert goals and all(e["p"][0][0] for e in goals)
    ids = {p["id"] for side in ("home", "away") for p in m[side]["xi"] + m[side]["bench"]}
    assert {e["p"][0][0] for e in goals} <= ids
    subs = [e for e in m["timeline"] if e["k"] == "sub"]
    assert all(len(e["p"]) == 2 for e in subs)


def test_shootout_decides_result():
    from app.match import outcome
    assert outcome({"score": 1, "shootout": 4}, {"score": 1, "shootout": 3}) == "W"
    assert outcome({"score": 1}, {"score": 1}) == "D"
    assert outcome({"score": 0, "shootout": 5}, {"score": 2, "shootout": None}) == "L"


def test_no_clean_sheet_until_full_time():
    from app import ratings
    keeper = {"seconds": 70 * 60, "pos": "G", "ev": {}}
    live, _ = ratings.rate(keeper, 0, 50, finished=False)
    done, _ = ratings.rate(keeper, 0, 50, finished=True)
    assert abs((done - live) - ratings.CLEAN["GK"]) <= 0.1


def test_compact_counts_involvement():
    from app import season
    m = normalize(SAMPLE, "esp.1")
    rm = "86"
    c, _ = season.compact(m, rm)
    assert c["v"] == season.COMPACT_VERSION
    rows = list(c["players"].values())
    assert all(len(r) == 8 for r in rows)
    assert sum(r[7] for r in rows) > 0
