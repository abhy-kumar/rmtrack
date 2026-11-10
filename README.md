# rmtrack

A Real Madrid match tracker that looks like it runs on Windows 98 on purpose.

Live commentary, line-ups, player ratings, fixtures in your own timezone, league tables, and news from journalists worth reading (translated when they write in Spanish). It covers the men's team, Femenino and Castilla, as far as the data allows for Castilla.

It costs nothing to run. There are no API keys, no database and no paid services.

## Running it on your machine

On Windows, double-click `setup.bat` once, then `run.bat` whenever you want it. It opens on http://127.0.0.1:8000.

Anywhere else:

```
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python serve.py
```

`python serve.py --lan` makes it reachable from your phone on the same wifi.
`python serve.py --fake` runs on canned data with no internet, which is handy for fiddling with the pages.

## Finding your way around

The toolbar has six sections. Each one has a page number, and typing the number on a keyboard jumps there.

| page | what's on it |
| --- | --- |
| 100 home | the live match or the next one with a countdown, the last result with its top three ratings, form, what's coming up and a slice of the table |
| 200 fixtures | upcoming games and results, one row per match, plus calendar export |
| 300 news | the wires, filtered by how much you trust each source, and the paste box for tweets |
| 400 squad | the squad by position, injuries and suspension risks per competition, and a workload watch |
| 500 stats | league table, xG table and every player in the competition |
| 600 settings | team, theme, times, alerts, spoiler mode and news sources |

"About the numbers" (700, linked in the status bar) explains the ratings, xG and workload.

A match opens on whichever tab makes sense at the time. Before kick-off that's the preview, during the game it's the commentary, and afterwards it's the ratings.

Most names are links. A player name goes to that player, wherever it shows up: scorers, key events, line-ups, ratings tables, leaderboards. Madrid players open their squad page and everyone else opens their league profile. A team name opens that team's page with its record, xG, results and players.

## How it looks

Every section is a small window with bevelled edges and a title bar, and the buttons press in when you click them. There are three themes: light grey, dark grey and pure black for AMOLED screens. "Follow my device" picks light or pure black to match the phone.

Colour is kept for things that mean something. Results are green, grey or red. Cards are drawn as little yellow and red cards, and subs get green and red markers. Ratings are coloured by band the way FotMob does it. The pitch is grass.

Each club gets a small pixel shirt in its kit colours, shaded with ordered dithering the way 256 colour screens faked gradients. They sit next to team names on scoreboards, fixtures and tables, and the line-ups show every player as a shirt with his number on it. The colours come from ESPN. Club crests are left out because they belong to the clubs.

Times follow the setting everywhere, including the clock: your own time with Madrid underneath, just yours, or just Madrid. Spoiler mode hides scores until you click.

## Putting it online (Vercel)

Import the repo on vercel.com and press deploy. Nothing needs changing. The free Hobby plan is enough, because the API sits behind Vercel's CDN and a thousand people watching a match cost about the same as one.

## Where things come from

Scores, commentary, line-ups, stats, tables, squads and kit colours come from ESPN's public JSON, the same feed their own site uses. It's unofficial and can change without warning. If something breaks, start with `app/espn.py` and `app/match.py`.

News comes from Marca's RSS, ESPN, Google News searches for each journalist and outlet listed in `app/sources.json`, and Bluesky. X has no free API any more, so the news page has a paste box instead. Drop in a link or the text and it gets translated and pinned.

Translation uses Google's free web endpoint, with MyMemory as a fallback.

Google's news feeds are meant for personal use, which is what this is. Keep it that way.

## Ratings

Every player starts at 6.0 and moves with what the commentary says he did: goals, assists, chances created, shots, fouls, cards, offsides, saves and goals let in while he was on. Minutes played, the result and team possession add a little on top.

The weights were fitted against FotMob's ratings for 449 player performances from early 2026-27. On games the fit hadn't seen, the ratings land about 0.3 from FotMob's on average. The working is on the "about the numbers" page, and `scripts/fit_ratings.py` refits them with more games.

## League stats

`app/league.py` collects every finished LaLiga, Champions League, Liga F and Women's Champions League match for every team. Each match is stored in a compact form under `public/data/lg/<league>/m/`, and the job builds `players.json` and `teams.json` from them. Those two files feed the stats page, the team pages, player profiles with percentiles against others in the same position, the scouting section in match previews and the last five column in the table.

xG is our own model (`app/xg.py`). It looks at distance, the angle of the goal mouth and whether the shot was a header, and runs them through a logistic fit. It starts from values tuned to the usual public xG numbers and is refitted on every stored shot each time the league job runs, so it gets better as the season goes on.

Workload on the squad page gives each player a load score out of 100. Minutes are weighted by how much his role runs (midfielders and full-backs most, keepers least) and by how involved he is compared with others in the same role, using the commentary lines he appears in. The score adds up four things: volume over the last four weeks, games played on three days' rest or less, a long shift with the next game coming within three days, and a sudden jump in the last week. A player who starts every game climbs to the top, and a sub who gets one start doesn't. It only sees competitive club matches, so training, friendlies and international games are invisible to it.

FBref isn't used. It lost its advanced data in January 2026 and has no API.

## The archive

`.github/workflows/collect.yml` runs every hour on GitHub for free. It saves each finished match with full commentary and ratings as JSON under `public/data/`, plus one news snapshot a day. The site reads those files straight from the CDN, so the season history doesn't depend on ESPN keeping old games around. If one source fails, whatever did come in still gets committed.

Run it by hand with `collect.bat` or `python -m app.collect --news --leagues`. The first league run fetches a few hundred matches and takes a few minutes. After that it only picks up new ones.

GitHub pauses scheduled jobs on repos with no commits for 60 days. During the season the job's own commits keep it alive, but over a long summer you might need to switch it back on from the Actions tab.

## Layout

```
app/            FastAPI backend (one Vercel function)
  main.py       routes and nothing else
  espn.py       ESPN endpoints
  season.py     schedule, match cache, season ratings
  club.py       tables, squads, form, kit colours
  match.py      turns ESPN's match payload into what the pages need
  events.py     reads the text commentary line by line
  ratings.py    the rating model
  xg.py         the xG model and its fit
  league.py     league-wide collection and aggregates
  news.py       news and the paste box
  ics.py        calendar feed
  collect.py    archive job
public/         the site, plain HTML, CSS and JS with no build step
  js/app.js     router, title bar and toolbar
  js/pages/     one file per page
  js/ui.js      shared pieces: windows, tabs, scoreboards, links
  js/kits.js    the dithered shirts
  js/maps.js    shot map, xG race, momentum, territory
scripts/        rating calibration
tests/          pytest, plus the offline fake data
```

To work on it:

```
pip install -r requirements-dev.txt
ruff check .
pytest
```

The same checks run on GitHub for every push (`.github/workflows/ci.yml`). When you change front-end files, bump the `?v=` number on the script and style links in `index.html` and in `sw.js`, so phones drop their old copies.

Not affiliated with Real Madrid C.F.
