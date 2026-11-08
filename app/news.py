"""News from the people and papers in sources.json, translated to English."""
import asyncio
import hashlib
import json
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from pathlib import Path
from urllib.parse import quote_plus

from defusedxml import ElementTree as ET

from . import espn, translate
from .events import norm as events_norm
from .net import cached, client, get_json, get_text

SOURCES = json.loads((Path(__file__).parent / "sources.json").read_text(encoding="utf-8"))
GNEWS = {
    "es": "https://news.google.com/rss/search?q={q}&hl=es&gl=ES&ceid=ES:es",
    "en": "https://news.google.com/rss/search?q={q}&hl=en-GB&gl=GB&ceid=GB:en",
}
BSKY = "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed"
OEMBED = "https://publish.twitter.com/oembed"
TAG = re.compile(r"<[^>]+>")
MAX_AGE_DAYS = 10

# the basketball section shares the club name, the Bernabeu hosts NFL games,
# and some outlets pad their feeds with betting previews. None of it is football.
NOT_FOOTBALL = re.compile(
    r"\b(baloncesto|basket|basketball|euroliga|euroleague|euroligue|liga endesa|acb|nba|canasta|"
    r"copa del rey de baloncesto|supercopa endesa|movistar arena|wizink|llull|tavares|campazzo|"
    r"hezonja|scariolo|cb|ucam|unicaja|baskonia|joventut|breog[aá]n|valencia basket|lenovo tenerife|"
    r"partizan|zalgiris|[uú]ltimo cuarto|last quarter|nfl|bengals|falcons|touchdown|quarterback|"
    r"f[uú]tbol americano|american football|super bowl|pron[oó]stico y cuotas|forecast and odds|"
    r"apuestas|betting tips?)\b",
    re.I,
)
GNEWS_EXCLUDE = " -baloncesto -basket -euroliga -ACB -NFL -apuestas"


def _football(it):
    text = " ".join(filter(None, (it.get("title"), it.get("summary"), it.get("title_en"))))
    return not NOT_FOOTBALL.search(text)


def _iso(dt):
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds")


def _item(title, url, when, source, tier, lang=None, journalist=None, kind="article", summary=""):
    title = unescape(TAG.sub("", title or "")).strip()
    return {
        "id": hashlib.sha1((url or title).encode()).hexdigest()[:12],
        "title": title, "url": url, "published": when, "source": source, "tier": tier,
        "lang": lang, "journalist": journalist, "kind": kind,
        "summary": unescape(TAG.sub("", summary or "")).strip()[:300],
    }


def _rss(xml):
    root = ET.fromstring(xml.encode("utf-8") if isinstance(xml, str) else xml)
    for it in root.iter("item"):
        yield {
            "title": it.findtext("title") or "",
            "link": it.findtext("link") or "",
            "date": it.findtext("pubDate"),
            "desc": it.findtext("description") or "",
            "source": it.findtext("source"),
            "by": it.findtext("{http://purl.org/dc/elements/1.1/}creator"),
        }


def _date(s):
    try:
        return parsedate_to_datetime(s)
    except Exception:
        return None


async def _google(query, label, tier, journalist=None, lang=None, must=None, only_from=None):
    xml = await get_text(GNEWS["en" if lang == "en" else "es"].format(q=quote_plus(query + GNEWS_EXCLUDE + " when:7d")))
    out = []
    for r in _rss(xml):
        title, outlet = r["title"], r["source"] or label
        if " - " in title:
            title, outlet = title.rsplit(" - ", 1)
        if only_from and only_from.lower() not in outlet.lower():
            continue
        title = re.sub(r"\s+-\s+The Athletic$", "", title)
        if must and not any(w in title.lower() for w in must):
            continue  # a namesake, or nothing to do with us
        out.append(_item(title, r["link"], _iso(_date(r["date"])), outlet if journalist else label,
                         tier, lang, journalist, "mention" if journalist else "article"))
    return out[:15]


async def _plain_rss(url, label, tier, lang=None):
    xml = await get_text(url)
    known = {events_norm(j["name"]): j for j in SOURCES["journalists"]}
    out = []
    for r in _rss(xml):
        by = (r["by"] or "").strip().title() or None
        j = known.get(events_norm(by)) if by else None
        desc = re.sub(r"\s*Leer\s*$", "", unescape(TAG.sub("", r["desc"])).strip())
        out.append(_item(r["title"], r["link"], _iso(_date(r["date"])), label, j["tier"] if j else tier, lang,
                         j["name"] if j else by, summary=desc))
    return out[:25]


async def _espn(team, label, tier):
    j = await espn.news(team["league"], team["id"])
    out = []
    for a in j.get("articles") or []:
        if a.get("type") == "Media":
            continue
        url = ((a.get("links") or {}).get("web") or {}).get("href")
        out.append(_item(a.get("headline"), url, a.get("published"), label, tier, "en",
                         summary=a.get("description")))
    return out


async def _bluesky(handle, name, tier, words, lang=None):
    j = await get_json(BSKY, actor=handle, limit=40, filter="posts_no_replies")
    out = []
    for f in j.get("feed") or []:
        post = f.get("post") or {}
        if f.get("reason"):  # reposts
            continue
        text = (post.get("record") or {}).get("text", "")
        if not any(w in text.lower() for w in words):
            continue
        rkey = (post.get("uri") or "").rsplit("/", 1)[-1]
        out.append(_item(text[:280], f"https://bsky.app/profile/{handle}/post/{rkey}",
                         (post.get("record") or {}).get("createdAt"), "Bluesky", tier, lang, name, "post"))
    return out


def _words(team_key):
    return {
        "men": ["madrid", "bernab", "florentino", "merengue", "valdebebas"],
        "women": ["madrid femenino", "real madrid women"],
        "castilla": ["castilla"],
    }.get(team_key, ["madrid"])


async def collect(team_key, extra_handles=(), extra_names=()):
    team = espn.team(team_key)
    phrase = team["news"]
    jobs = []
    for j in SOURCES["journalists"]:
        if j.get("bsky"):
            jobs.append(_bluesky(j["bsky"], j["name"], j["tier"], _words(team_key), j.get("lang")))
        if j.get("bsky") and j.get("lang") == "en":
            continue  # posts are enough for this one
        jobs.append(_google(f"\"{j['name']}\" \"{phrase}\"", j.get("outlet") or j["name"], j["tier"], j["name"],
                            j.get("lang"), must=_words(team_key)))
    for o in SOURCES["outlets"]:
        if o.get("only") and team_key not in o["only"]:
            continue
        if o.get("rss"):
            jobs.append(_plain_rss(o["rss"], o["name"], o["tier"], o.get("lang")))
        elif o.get("espn"):
            jobs.append(_espn(team, o["name"], o["tier"]))
        elif o.get("gnews"):
            jobs.append(_google(o["gnews"].replace("{team}", phrase), o["name"], o["tier"], lang=o.get("lang"),
                                must=_words(team_key), only_from=o.get("from")))
    for h in extra_handles:
        jobs.append(_bluesky(h, h.split(".")[0], "B", _words(team_key)))
    for n in extra_names:
        jobs.append(_google(f"\"{n}\" \"{phrase}\"", n, "B", n, must=_words(team_key)))

    results = await asyncio.gather(*jobs, return_exceptions=True)
    items, seen, failed = [], set(), 0
    now = datetime.now(timezone.utc)
    for res in results:
        if isinstance(res, Exception):
            failed += 1
            continue
        for it in res:
            key = re.sub(r"\W+", "", it["title"].lower())[:80]
            if not it["title"] or key in seen or not _football(it):
                continue
            if it["published"]:
                try:
                    age = now - datetime.fromisoformat(it["published"].replace("Z", "+00:00"))
                    if age.days > MAX_AGE_DAYS:
                        continue
                except ValueError:
                    pass
            seen.add(key)
            items.append(it)
    items.sort(key=lambda i: i["published"] or "", reverse=True)
    items = items[:80]

    need = [i for i in items if i["lang"] != "en"]
    done = await translate.many([i["title"] for i in need])
    for it, (en, lang) in zip(need, done):
        it["lang"] = it["lang"] or lang
        if en and en.strip().lower() != it["title"].strip().lower():
            it["title_en"] = en
    items = [i for i in items if _football(i)]
    return {"items": items, "failed": failed, "built": _iso(now)}


async def feed(team_key, extra_handles=(), extra_names=()):
    key = ("news", team_key, tuple(sorted(extra_handles)), tuple(sorted(extra_names)))
    return await cached(key, 600, lambda: collect(team_key, extra_handles, extra_names))


X_URL = re.compile(r"^https?://(?:www\.|mobile\.)?(?:x|twitter)\.com/[^/]+/status/\d+")


async def paste(text="", url=""):
    """Something the user pasted: raw text, or a link to an X post."""
    author = None
    if url and X_URL.match(url):
        r = await client().get(OEMBED, params={"url": url, "omit_script": "true", "dnt": "true"})
        if r.status_code == 200:
            j = r.json()
            author = j.get("author_name")
            m = re.search(r"<p[^>]*>(.*?)</p>", j.get("html", ""), re.S)
            if m:
                text = unescape(TAG.sub("", m.group(1).replace("<br>", "\n")))
    text = (text or "").strip()
    if not text:
        return {"error": "nothing to translate"}
    en, lang = await translate.one(text)
    return {"author": author, "text": text, "text_en": en, "lang": lang, "url": url or None}
