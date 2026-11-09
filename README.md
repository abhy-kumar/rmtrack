# rmtrack

A Real Madrid match tracker that looks like it's from 2002 on purpose.

Live commentary, line-ups, player ratings, fixtures in your own timezone, league tables, and news from journalists worth reading (translated when they write in Spanish). Covers the men's team, Femenino and, as far as the data allows, Castilla.

It costs nothing to run. No API keys, no database, no paid anything.

## Running it on your machine

Windows: double-click `setup.bat` once, then `run.bat` whenever you want it. It opens on http://127.0.0.1:8000.

Anything else:

```
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python serve.py
```

`python serve.py --lan` makes it reachable from your phone on the same wifi.
`python serve.py --fake` runs on canned data with no internet, handy for fiddling with the pages.

## Finding your way around

The top bar has six sections. Each has a page number, and typing it on a keyboard jumps there.

| page | what's on it |
| --- | --- |
| 100 home | live match or the next one with a countdown, last result with the top ratings, form, what's coming, the table |
| 200 fixtures | upcoming and results, calendar export. Every match opens on the tab that matters right now: preview before kick-off, commentary while it's on, ratings after |
| 300 news | the wires, filtered by trust tier, plus the paste box for tweets |
| 400 squad | squad by position, availability, and a workload watch for anyone carrying a heavy load |
| 500 stats | league table, xG table and every player in the league; every team name opens that team (record, xG, results, players) |
| 600 settings | team, theme, times, alerts, news sources |

"About the numbers" (700, linked in the footer) explains the ratings, xG and workload.

## Putting it online (Vercel)

Import the repo on vercel.com and press deploy. No settings to change. The free Hobby plan is enough: the API sits behind Vercel's CDN, so a thousand people watching a match costs about the same as one.

## Where things come from

- **Scores, commentary, line-ups, stats, tables, squads**: ESPN's public JSON (the one their own site uses). Unofficial, so it can change without warning. If something breaks, `app/espn.py` and `app/match.py` are where to look.
- **News**: Marca's RSS, ESPN, Google News searches for each journalist and outlet in `app/sources.json`, and Bluesky. X/Twitter has no free API any more, so for tweets there's a paste box on the news page: drop in a link or the text and it gets translated and pinned.
- **Translation**: Google's free web endpoint, with MyMemory as a fallback.
- **Ratings**: our own. See below.

Google's news feeds are for personal use, which is what this is. Keep it that way.

## Ratings

Every player starts at 6.0 and moves with what the commentary says he did: goals, assists, chances created, shots, fouls, cards, offsides, saves, goals let in while he was on, plus a bit for minutes, the result and team possession.

The weights were fitted against FotMob's ratings for 449 player-matches from early 2026-27. On games the fit hadn't seen we're about 0.3 off FotMob on average. The working is on the "about the numbers" page. To refit with more games, see `scripts/fit_ratings.py`.

## League stats

`app/league.py` collects every finished LaLiga, Champions League, Liga F and Women's Champions League match, for all teams, not just Madrid. Each match is stored compactly under `public/data/lg/<league>/m/`, and from those it builds `players.json` and `teams.json`. They feed the stats page (500), any player's profile with percentiles against others in his position, the scouting section on match previews, and the xG race on match pages.

xG is our own model (`app/xg.py`): distance, the angle of the goal mouth and whether it was a header, run through a logistic fit. It starts from values tuned to the usual public xG numbers and is refitted on every stored shot each time the league job runs, so it settles in as the season goes on.

Workload on the squad page is worked out from match minutes only: last 7 days against the 3 weeks before, games in the last 14 days, days of rest. It doesn't know about training, so it's a guide.

FBref isn't used: it lost its advanced data in January 2026 and has no API.

## The archive

`.github/workflows/collect.yml` runs every hour on GitHub (free). It saves each finished match, with full commentary and ratings, as JSON under `public/data/`, plus one news snapshot a day. The site reads those files straight from the CDN, so the season history doesn't depend on ESPN keeping old games around.

Run it by hand with `collect.bat` or `python -m app.collect --news --leagues`. The first league run fetches a few hundred matches and takes a few minutes; after that it only picks up new ones.

GitHub pauses scheduled jobs on repos with no commits for 60 days. During the season the job's own commits keep it alive. Over a long summer you might need to re-enable it from the Actions tab.

## Layout

```
app/            FastAPI backend (one Vercel function)
  main.py       routes, nothing else
  espn.py       ESPN endpoints
  season.py     schedule, match cache, season ratings
  club.py       tables, squads, form
  match.py      turns ESPN's match payload into what the pages need
  events.py     reads the text commentary, line by line
  ratings.py    the rating model
  xg.py         the xG model and its fit
  league.py     league-wide collection and aggregates
  news.py       news + paste box
  ics.py        calendar feed
  collect.py    archive job
public/         the site, plain HTML/CSS/JS, no build step
  js/app.js     router and the masthead
  js/pages/     one file per page
  js/ui.js      shared bits: boxes, tabs, scoreboards
  js/maps.js    shot map, xG race, momentum, territory
scripts/        rating calibration
tests/          pytest, plus the offline fake data
```

For working on it:

```
pip install -r requirements-dev.txt
ruff check .
pytest
```

The same checks run on GitHub for every push (`.github/workflows/ci.yml`). Bump the `?v=` number on the script and style links in `index.html` and `sw.js` when you change front-end files, so phones drop the old copies.

Not affiliated with Real Madrid C.F.
