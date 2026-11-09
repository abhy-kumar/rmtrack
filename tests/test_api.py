import httpx
import pytest
from fastapi.testclient import TestClient

from app import espn, main, net, season
from tests import fake


@pytest.fixture
def client(monkeypatch):
    fake.install(monkeypatch.setattr)
    net._store.clear()
    yield TestClient(main.app, raise_server_exceptions=False)
    net._store.clear()


def test_overview(client):
    r = client.get("/api/overview?team=men")
    assert r.status_code == 200
    d = r.json()
    assert d["info"]["id"] == "86"
    assert d["live"] and d["next"]
    assert all(f["res"] in "WDL" for f in d["form"])
    assert "s-maxage=10" in r.headers["cdn-cache-control"]  # something is live


def test_unknown_team_falls_back(client):
    assert client.get("/api/overview?team=nope").json()["team"] == "men"


def test_fixtures_sorted(client):
    rows = client.get("/api/fixtures").json()["rows"]
    dates = [f["date"] for f in rows]
    assert dates == sorted(dates)


def test_table(client):
    d = client.get("/api/table/esp.1").json()
    rows = d["groups"][0]["rows"]
    assert [r["rank"] for r in rows] == sorted(r["rank"] for r in rows)
    assert rows[0]["pts"] >= rows[-1]["pts"]
    assert client.get("/api/table/ESP 1").status_code == 400


def test_squad(client):
    d = client.get("/api/squad").json()
    assert d["coach"]
    assert any(p["injuries"] for p in d["players"])
    assert all(p["id"] and p["name"] for p in d["players"])


def test_calendar_skips_finished(client):
    r = client.get("/api/calendar.ics")
    assert r.headers["content-type"].startswith("text/calendar")
    body = r.text
    assert body.startswith("BEGIN:VCALENDAR\r\n") and body.endswith("END:VCALENDAR\r\n")
    events = {e["id"]: e for e in fake.schedule("86")["events"] + fake.schedule("86", True)["events"]}
    not_done = [e for e in events.values() if e["competitions"][0]["status"]["type"]["state"] != "post"]
    assert body.count("BEGIN:VEVENT") == len(not_done)


def test_paste_limits(client, monkeypatch):
    async def echo(text, url):
        return {"text": text, "url": url}
    monkeypatch.setattr(main.news, "paste", echo)
    assert client.post("/api/paste", json={"text": "hola"}).json()["text"] == "hola"
    assert client.post("/api/paste", json={"text": "x" * 3001}).status_code == 422
    assert client.post("/api/paste", content=b"not json").status_code == 422


def test_upstream_failure_is_502_and_not_cached(client, monkeypatch):
    async def down(*a, **k):
        raise httpx.ConnectError("no route")
    monkeypatch.setattr(espn, "standings", down)
    r = client.get("/api/table/esp.2")
    assert r.status_code == 502
    assert r.headers["cache-control"] == "no-store"


def test_crash_is_500(client, monkeypatch):
    async def broken(*a, **k):
        raise KeyError("oops")
    monkeypatch.setattr(season, "schedule", broken)
    r = client.get("/api/fixtures")
    assert r.status_code == 500
    assert r.json() == {"error": "server"}


def test_model(client):
    d = client.get("/api/model").json()
    ex = d["xg_examples"]
    assert ex["6m central"] > ex["edge of the box"] > ex["25m"]
    assert ex["6m header"] < ex["6m central"]


def test_kits(client):
    d = client.get("/api/kits").json()
    assert d["86"] == ["ffffff", "1b1b4b"]
    assert all(len(c) == 6 for k in d.values() for c in k)


def test_kit_of_rejects_junk():
    from app.match import kit_of
    assert kit_of({"color": "FFF"}) is None
    assert kit_of({"color": "AB12CD", "alternateColor": "nope"}) == ["ab12cd", "ab12cd"]
