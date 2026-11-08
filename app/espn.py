"""ESPN's public site API. Unofficial, keyless, and usually quick."""
from .net import get_json

SITE = "https://site.api.espn.com/apis/site/v2/sports/soccer"
V2 = "https://site.api.espn.com/apis/v2/sports/soccer"

TEAMS = {
    "men": {
        "id": "86", "name": "Real Madrid", "short": "RMA", "league": "esp.1",
        "news": "Real Madrid", "tables": ["esp.1", "uefa.champions"],
    },
    "women": {
        "id": "21128", "name": "Real Madrid Femenino", "short": "RMA", "league": "esp.w.1",
        "news": "Real Madrid Femenino", "tables": ["esp.w.1", "uefa.wchampions"],
    },
    "castilla": {
        "id": "7000", "name": "Real Madrid Castilla", "short": "RMC", "league": "esp.3",
        "news": "Real Madrid Castilla", "tables": [],
    },
}


def team(key):
    return TEAMS.get(key) or TEAMS["men"]


async def schedule(team_id, fixtures=False):
    url = f"{SITE}/all/teams/{team_id}/schedule"
    return await (get_json(url, fixture="true") if fixtures else get_json(url))


async def summary(league, event_id):
    return await get_json(f"{SITE}/{league}/summary", event=event_id)


async def standings(league):
    return await get_json(f"{V2}/{league}/standings")


async def roster(league, team_id):
    return await get_json(f"{SITE}/{league}/teams/{team_id}/roster")


async def news(league, team_id, limit=25):
    return await get_json(f"{SITE}/{league}/news", team=team_id, limit=limit)
