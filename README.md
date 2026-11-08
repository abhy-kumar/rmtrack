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

The weights were fitted against FotMob's ratings for 449 player-matches from early 2026-27. On games the fit hadn't seen we're about 0.3 off FotMob on average. The working is on the site's ratings page. To refit with more games, see `scripts/fit_ratings.py`.

## The archive

`.github/workflows/collect.yml` runs every hour on GitHub (free). It saves each finished match, with full commentary and ratings, as JSON under `public/data/`, plus one news snapshot a day. The site reads those files straight from the CDN, so the season history doesn't depend on ESPN keeping old games around.

Run it by hand with `collect.bat` or `python -m app.collect --news`.

GitHub pauses scheduled jobs on repos with no commits for 60 days. During the season the job's own commits keep it alive. Over a long summer you might need to re-enable it from the Actions tab.

## Layout

```
app/          FastAPI backend (one Vercel function)
  main.py     routes
  espn.py     ESPN endpoints
  match.py    turns ESPN's match payload into what the pages need
  events.py   reads the text commentary, line by line
  ratings.py  the rating model
  news.py     news + paste box
  collect.py  archive job
public/       the site, plain HTML/CSS/JS, no build step
scripts/      rating calibration
tests/        pytest, plus the offline fake data
```

`pytest` runs the tests.

Not affiliated with Real Madrid C.F.
