import {
  api, staticJson, prefs, savePrefs, store, applyTheme, h, html, raw, esc,
  when, until, ago, hhmm, day, userTz, inSpain, rt, comp, flash,
} from "./core.js?v=4";
import { live, beep } from "./alerts.js?v=4";
import { shotMap, momentum, territory, playerMap } from "./maps.js?v=4";

const TEAM_NAMES = { men: "Real Madrid", women: "Real Madrid Femenino", castilla: "Real Madrid Castilla" };
const TEAM_IDS = { men: "86", women: "21128", castilla: "7000" };
const myId = () => TEAM_IDS[prefs.team];

const put = (el, v) => { el.innerHTML = html(v); };
const fail = (what) => h`<p class="err">Couldn't load ${what} just now. It'll retry on its own; or <a href="javascript:location.reload()">reload</a>.</p>`;
const box = (title, body, aside = "") => h`<div class="box"><h2>${title}<small>${aside}</small></h2><div class="in">${body}</div></div>`;

// spoiler veil: remembered per match for the session
function revealed(id) {
  if (!prefs.spoilers) return true;
  try { return sessionStorage.getItem("rm:seen:" + id) === "1"; } catch (e) { return false; }
}
document.addEventListener("click", (e) => {
  const v = e.target.closest("[data-reveal]");
  if (!v) return;
  try { sessionStorage.setItem("rm:seen:" + v.dataset.reveal, "1"); } catch (err) {}
  window.dispatchEvent(new HashChangeEvent("hashchange"));
});
const veil = (id) => h`<span class="veil" data-reveal="${id}" title="spoiler mode is on">show score</span>`;

function scoreText(f) {
  if (f.status.state === "pre") return null;
  return `${f.home.score ?? 0}-${f.away.score ?? 0}`;
}

function result(f) {
  const me = f.home.id === myId() ? f.home : f.away;
  const them = me === f.home ? f.away : f.home;
  const a = me.score ?? 0, b = them.score ?? 0;
  return a > b ? "W" : a < b ? "L" : "D";
}

function statusLine(st, date) {
  if (st.state === "in") return h`<span class="live">LIVE</span> ${st.clock || st.detail}`;
  if (st.state === "post") return st.detail || "FT";
  if (/postponed|canceled|cancelled|suspended/i.test(st.detail)) return st.detail;
  return when(date);
}

// ---------------------------------------------------------------- board

function board(m, { link = false } = {}) {
  const show = revealed(m.id) || m.status.state === "pre";
  const goals = (m.timeline || []).filter((e) => e.k === "goal");
  const who = (side) => goals.filter((g) => g.s === side).map((g) => {
    const n = (g.x.match(/(?:^|\. )([^.(]+?) \(/) || [])[1] || "";
    return `${n.trim()} ${g.m}`;
  }).join(", ");
  const sc = m.status.state === "pre"
    ? h`<div class="sc pre">${hhmm(new Date(m.date))}</div>`
    : show ? h`<div class="sc">${m.home.score ?? 0}-${m.away.score ?? 0}</div>` : h`<div class="sc">${veil(m.id)}</div>`;
  const inner = h`
    <div class="comp">${comp(m.league, m.comp)}${m.round ? ", " + m.round : ""}</div>
    <div class="line">
      <div class="tm h">${m.home.name}</div>${sc}<div class="tm a">${m.away.name}</div>
    </div>
    <div class="st">${statusLine(m.status, m.date)}</div>
    ${show && goals.length ? h`<div class="scorers"><div>${who("home")}</div><div>${who("away")}</div></div>` : ""}
    <div class="meta">${[m.venue, m.city].filter(Boolean).join(", ")}${m.ref ? h`, ref ${m.ref}` : ""}${m.crowd ? h`, ${Number(m.crowd).toLocaleString("en-GB")} crowd` : ""}</div>`;
  return link ? h`<div class="board"><a href="#/match/${m.league}/${m.id}" style="text-decoration:none;display:block">${inner}</a></div>` : h`<div class="board">${inner}</div>`;
}

function formStrip(form) {
  if (!form?.length) return h`<span class="sub">no games yet</span>`;
  const shown = prefs.spoilers ? form.slice(1) : form;
  return h`<span class="form">${[...shown].reverse().map((f) => h`<a class="${f.res}" href="#/match/${f.league}/${f.id}" title="${f.opp} ${f.score}">${f.res}</a>`)}</span>`;
}

// ---------------------------------------------------------------- home

export async function home(el) {
  put(el, h`<p class="loading">fetching the latest...</p>`);
  let ov;
  try { ov = await api(`/api/overview?team=${prefs.team}`, { ttl: 15 }); }
  catch (e) { put(el, fail("the overview")); return; }

  const liveF = ov.live?.[0];
  const next = ov.next?.[0];
  let top = "";
  if (liveF) {
    let m = live.details[liveF.id];
    try { m = await api(`/api/match/${liveF.league}/${liveF.id}`, { ttl: 10 }); } catch (e) {}
    if (m) {
      const lines = [...m.feed].reverse().filter((f) => !["foul", "offside", "corner", "other"].includes(f.k)).slice(0, 6);
      top = box("live now", h`${board(m, { link: true })}
        ${revealed(m.id) ? h`<ul class="feed">${lines.map((f) => h`<li class="${f.k}"><span class="m">${f.m}</span><span class="x">${f.x}</span></li>`)}</ul>` : ""}
        <p><a href="#/match/${m.league}/${m.id}">full commentary, line-ups and ratings</a></p>`, "updates every 15s");
    }
  } else if (next) {
    top = box("next up", h`${board({ ...next, timeline: [] }, { link: true })}
      <p style="text-align:center;font:bold 15px 'Courier New',monospace" id="countdown">${until(next.date)}</p>
      ${next.tv?.length ? h`<p class="sub" style="text-align:center">on ${next.tv.join(", ")}</p>` : ""}
      ${!inSpain ? h`<p class="sub" style="text-align:center">times shown for ${userTz.replace(/_/g, " ")}</p>` : ""}`);
  }

  let lastBox = "";
  if (ov.last) {
    const f = ov.last;
    lastBox = box("last time out", h`${board({ ...f, timeline: [] }, { link: true })}
      <p style="text-align:center"><a href="#/match/${f.league}/${f.id}/lineups">ratings</a> &nbsp; <a href="#/match/${f.league}/${f.id}">commentary</a></p>`);
  }

  const upcoming = (ov.next || []).slice(liveF ? 0 : 1, 6);
  const side = h`
    ${box("form", h`${formStrip(ov.form)} <span class="sub">last ${ov.form.length}, oldest first</span>`)}
    ${box("coming up", upcoming.length ? h`<table class="t">${upcoming.map((f) => h`<tr>
        <td><a href="#/match/${f.league}/${f.id}">${f.home.abbr} v ${f.away.abbr}</a><br><span class="sub">${comp(f.league, f.comp)}</span></td>
        <td class="n">${day(new Date(f.date))}<br><span class="sub">${hhmm(new Date(f.date))}</span></td></tr>`)}</table>`
      : h`<p class="empty">nothing scheduled</p>`, h`<a href="#/fixtures" style="color:inherit">all</a>`)}
    <div id="mini"></div>`;

  put(el, h`<div class="cols"><div>${top}${lastBox}<div id="homenews"></div></div><div>${side}</div></div>`);

  const cd = el.querySelector("#countdown");
  const iv = cd && setInterval(() => { cd.textContent = until(next.date); }, 1000);

  const league = ov.info.tables?.[0];
  if (league) miniTable(el.querySelector("#mini"), league);
  homeNews(el.querySelector("#homenews"));

  const poll = liveF ? setInterval(() => home(el), 20000) : null;
  return () => { clearInterval(iv); clearInterval(poll); };
}

async function miniTable(el, league) {
  try {
    const t = await api(`/api/table/${league}`, { ttl: 300 });
    const rows = t.groups[0]?.rows || [];
    const i = rows.findIndex((r) => r.id === myId());
    if (i < 0) return;
    const from = Math.max(0, Math.min(i - 3, rows.length - 7));
    put(el, box(comp(league, t.name), h`<table class="t"><tr><th>#</th><th>team</th><th class="n">P</th><th class="n">Pts</th></tr>
      ${rows.slice(from, from + 7).map((r) => h`<tr class="${r.id === myId() ? "me" : ""}"><td>${r.rank}</td><td>${r.name}</td><td class="n">${r.p}</td><td class="n">${r.pts}</td></tr>`)}
      </table>`, h`<a href="#/table/${league}" style="color:inherit">full</a>`));
  } catch (e) {}
}

// ---------------------------------------------------------------- news helpers

function tierOf(item) {
  return prefs.tierOverride[item.journalist] || prefs.tierOverride[item.source] || item.tier || "C";
}

function newsUrl() {
  const q = new URLSearchParams({ team: prefs.team });
  if (prefs.bsky) q.set("bsky", prefs.bsky);
  if (prefs.who) q.set("who", prefs.who);
  return `/api/news?${q}`;
}

function newsItem(it, compact = false) {
  const t = tierOf(it);
  const title = it.title_en || it.title;
  return h`<li>
    <div class="hd"><span class="tier ${t}" title="tier ${t}">${t}</span><a href="${it.url}" target="_blank" rel="noopener noreferrer">${title}</a></div>
    ${it.title_en && !compact ? h`<div class="orig">${it.title}</div>` : ""}
    <div class="by">${it.kind === "mention" ? h`citing ${it.journalist}, ` : it.journalist && it.journalist !== it.source ? h`${it.journalist}, ` : ""}${it.source}${it.kind === "post" ? " post" : ""}, ${ago(it.published)}${it.title_en ? h`, <span title="translated from ${it.lang || "?"}">translated</span>` : ""}</div>
  </li>`;
}

async function homeNews(el) {
  try {
    const n = await api(newsUrl(), { ttl: 120 });
    const items = n.items.filter((i) => prefs.tiers[tierOf(i)]).slice(0, 10);
    put(el, box("the wires", h`<ul class="news compact">${items.map((i) => newsItem(i, true))}</ul>
      <p><a href="#/news">all news</a></p>`, n.built ? "as of " + hhmm(new Date(n.built)) : ""));
  } catch (e) { put(el, box("the wires", fail("the news"))); }
}

export async function fillTicker() {
  const tk = document.querySelector("#ticker .tk");
  try {
    const n = await api(newsUrl(), { ttl: 300 });
    const lm = live.matches.map((f) => {
      const m = live.details[f.id] || f;
      return revealed(m.id) ? `<b>LIVE ${esc(m.home.abbr)} ${m.home.score ?? 0}-${m.away.score ?? 0} ${esc(m.away.abbr)} ${esc(m.status.clock || "")}</b>` : `<b>LIVE ${esc(m.home.abbr)} v ${esc(m.away.abbr)}</b>`;
    });
    const heads = n.items.filter((i) => prefs.tiers[tierOf(i)]).slice(0, 14)
      .map((i) => `[${esc(tierOf(i))}] ${esc(i.title_en || i.title)} <i>(${esc(i.source)})</i>`);
    tk.innerHTML = [...lm, ...heads].map((s) => `<span>${s}</span>`).join("") || "<span>quiet on the wires</span>";
  } catch (e) {
    tk.innerHTML = "<span>wires down, trying again shortly</span>";
  }
}

// ---------------------------------------------------------------- match

export async function match(el, league, id, tab = "live") {
  let m;
  const draw = async (first) => {
    try { m = await api(`/api/match/${league}/${id}`, { ttl: first ? 5 : 0 }); }
    catch (e) { if (first) put(el, fail("this match")); return; }
    if (!m.rated && tab === "lineups" && !m.home.xi.length) tab = "before";
    const tabs = [["live", m.status.state === "pre" ? "preview" : "commentary"], ["lineups", "line-ups & ratings"], ["maps", "maps"], ["stats", "stats"], ["before", "form & h2h"]];
    const open = el.querySelectorAll("details[open]");
    const keep = [...open].map((d) => d.dataset.k);
    const scrollY = window.scrollY;
    put(el, h`${board(m)}
      <div class="tabs">${tabs.map(([k, label]) => h`<a href="#/match/${league}/${id}/${k}" class="${k === tab ? "on" : ""}">${label}</a>`)}</div>
      <div class="tabbody">${body(m, tab)}</div>
      <p class="sub">updated ${hhmm(new Date(m.updated))}${m.status.state === "in" ? ", refreshing every 15s" : ""}</p>`);
    keep.forEach((k) => el.querySelector(`details[data-k="${k}"]`)?.setAttribute("open", ""));
    if (!first) window.scrollTo(0, scrollY);
    wire(el, m);
  };
  await draw(true);
  const iv = setInterval(() => { if (m?.status.state === "in" || (m?.status.state === "pre" && new Date(m.date) - Date.now() < 3600e3)) draw(false); }, 15000);
  return () => { clearInterval(iv); clearInterval(replayTimer); };
}

let replayTimer = null;

function body(m, tab) {
  const show = revealed(m.id) || m.status.state === "pre";
  if (!show && tab !== "before") return h`<p>Spoiler mode is on. ${veil(m.id)} to see what happened.</p>`;
  if (tab === "lineups") return lineups(m);
  if (tab === "stats") return stats(m);
  if (tab === "maps") return m.status.state === "pre" ? h`<p class="empty">Maps fill in once the match starts.</p>` : h`${shotMap(m)}${momentum(m)}${territory(m)}`;
  if (tab === "before") return before(m);
  return commentary(m);
}

function commentary(m) {
  if (!m.feed.length) {
    if (m.status.state === "pre") return h`<p>Kick-off ${when(m.date)}. Line-ups usually land about an hour before. Commentary starts here when they're out.</p>${before(m)}`;
    return h`<p class="empty">No commentary for this one. ESPN doesn't cover every match in full.</p>`;
  }
  const tl = m.timeline.filter((e) => e.k !== "sub");
  const lines = [...m.feed].reverse();
  return h`
    ${tl.length ? h`<ul class="tl">${tl.map((e) => h`<li><span class="h">${e.s === "home" ? keyEvent(e) : ""}</span><span class="m">${e.m}</span><span>${e.s === "away" ? keyEvent(e) : ""}</span></li>`)}</ul><hr>` : ""}
    <div class="row">
      <label><input type="checkbox" id="quiet" ${prefs.quiet ? "checked" : ""}> hide fouls, corners &amp; offsides</label>
      ${m.status.state === "post" ? h`<button id="replay">replay the match</button><span class="sub" id="rpl"></span>` : ""}
    </div>
    <ul class="feed ${prefs.quiet ? "quiet" : ""}" id="feed">${lines.map((f) => h`<li class="${f.k}" data-t="${f.t}"><span class="m">${f.m}</span><span class="x">${f.x}</span></li>`)}</ul>`;
}

function keyEvent(e) {
  const name = (e.x.match(/(?:Goal!.*?\.|^)\s*([^.(]+?) \(/) || [])[1] || "";
  if (e.k === "goal") return h`<b>${name.trim()}</b> <span class="ico">G</span>`;
  if (e.k === "yellow") return h`${name.trim()} <span class="ico y">Y</span>`;
  if (e.k === "red") return h`${name.trim()} <span class="ico r">R</span>`;
  if (e.k === "penmiss") return h`${e.x.split(".")[0]} <span class="ico">P</span>`;
  if (e.k === "var") return h`<span class="ico">VAR</span> ${e.x.replace(/^VAR Decision:\s*/, "").slice(0, 60)}`;
  return e.x;
}

function pitch(side, m) {
  const rows = ["ATT", "AM", "MID", "DM", "DEF", "GK"];
  const xi = side.xi;
  if (!xi.length) return h`<div class="pitch"><div class="cap">line-up not out yet</div></div>`;
  const lines = rows.map((r) => xi.filter((p) => p.row === r)).filter((l) => l.length);
  return h`<div class="pitch">
    <div class="cap">${side.name} ${side.formation ? "(" + side.formation + ")" : ""}</div>
    ${lines.map((l) => h`<div class="ln">${l.map((p) => h`<div class="pl" title="${p.name}">
      ${m.rated && p.r != null ? rt(p.r, p.id === m.motm ? "motm" : "") : ""}
      <span class="no">${p.no}</span><span class="nm">${p.short.replace(/^\p{Lu}\. /u, "")}${revealed(m.id) && p.g ? ` ${p.g > 1 ? p.g : ""}G` : ""}${revealed(m.id) && p.rc ? " R" : ""}</span></div>`)}</div>`)}
  </div>`;
}

function ratingTable(side, m) {
  const fan = store("fan:" + m.id) || {};
  const all = [...side.xi, ...side.bench.filter((p) => p.mins > 0)];
  return h`<div class="scroll"><table class="t fx">
    <colgroup><col style="width:40px"><col><col class="hide-s" style="width:64px"><col style="width:50px"><col style="width:90px"><col style="width:70px"><col style="width:70px"></colgroup>
    <tr><th>#</th><th>player</th><th class="hide-s">pos</th><th class="n">min</th><th></th><th class="c">rating</th><th class="c">you</th></tr>
    ${all.map((p) => h`<tr>
      <td>${p.no}</td>
      <td>${side.id === myId() ? h`<a href="#/player/${p.id}">${p.name}</a>` : p.name}${p.on && p.on > 0 ? h` <span class="sub">on ${p.on}'</span>` : ""}${p.off != null && p.off > 0 && side.xi.includes(p) ? h` <span class="sub">off ${p.off}'</span>` : ""}
        ${m.rated && p.mins ? h`<details class="why" data-k="p${p.id}"><summary class="sub">map</summary>${playerMap(m, p.id)}</details>` : ""}
        ${p.why?.length ? h`<details class="why" data-k="w${p.id}"><summary class="sub">why ${p.r?.toFixed(1)}?</summary><div class="bd">${[["start", 6], ...p.why].map(([k, v]) => h`${k}: ${v > 0 && k !== "start" ? "+" : ""}${Number(v).toFixed(2)}<br>`)}</div></details>` : ""}
      </td>
      <td class="hide-s sub">${p.pos}</td>
      <td class="n">${p.mins || ""}</td>
      <td>${"G".repeat(p.g).split("").map(() => h`<span class="ico">G</span>`)}${"A".repeat(p.a).split("").map(() => h`<span class="ico">A</span>`)}${p.y ? h`<span class="ico y">Y</span>` : ""}${p.rc ? h`<span class="ico r">R</span>` : ""}${p.og ? h`<span class="ico">OG</span>` : ""}</td>
      <td class="c">${m.rated ? rt(p.r, p.id === m.motm ? "motm" : "") : ""}</td>
      <td class="c fan">${m.rated && p.mins ? h`<select data-fan="${p.id}" aria-label="your rating for ${p.name}"><option value="">-</option>${[...Array(19)].map((_, i) => { const v = (1 + i * 0.5).toFixed(1); return h`<option ${fan[p.id] === v ? "selected" : ""}>${v}</option>`; })}</select>` : ""}</td>
    </tr>`)}
  </table></div>`;
}

function lineups(m) {
  if (!m.home.xi.length && !m.away.xi.length) return h`<p class="empty">Line-ups aren't out yet. They normally drop about an hour before kick-off.</p>`;
  return h`
    <div class="pitches">${pitch(m.home, m)}${pitch(m.away, m)}</div>
    ${m.rated && m.feed.length < 40 ? h`<p class="warn">ESPN only has the basic events for this match (goals, cards, subs), so the ratings mostly reflect minutes, goals and the result. Treat them loosely.</p>` : ""}
    ${m.rated ? h`<p class="sub">Ratings start at 6.0 and move with every action. ${m.status.state === "in" ? "Live, so they'll keep moving. " : ""}${m.motm ? "* = player of the match. " : ""}<a href="#/ratings">How they're worked out.</a></p>` : ""}
    <h3 style="margin-top:10px">${m.home.name}</h3>${ratingTable(m.home, m)}
    <h3 style="margin-top:10px">${m.away.name}</h3>${ratingTable(m.away, m)}`;
}

function stats(m) {
  if (!m.stats.length) return h`<p class="empty">No team stats yet.</p>`;
  const num = (v) => parseFloat(String(v).replace("%", "")) || 0;
  return h`<div class="bars">
    <div class="b"><div class="l"><b>${m.home.abbr}</b></div><div></div><div class="r"><b>${m.away.abbr}</b></div></div>
    ${m.stats.map((s) => {
      const a = num(s.home), b = num(s.away), tot = a + b || 1;
      return h`<div class="lab">${s.label}</div><div class="b"><div class="l">${s.home}</div>
        <div class="track"><i class="hl" style="width:${(a / tot) * 100}%"></i><i class="al" style="width:${(b / tot) * 100}%"></i></div>
        <div class="r">${s.away}</div></div>`;
    })}</div>`;
}

function before(m) {
  const row = (f) => h`<tr><td>${f.date ? day(new Date(f.date)) : ""}</td><td>${f.at === "@" ? "at " : "v "}${f.opp}</td><td class="n">${f.score}</td><td class="c"><span class="form"><span class="${f.res}">${f.res}</span></span></td></tr>`;
  const formBox = (side) => h`<div><h3>${side.name}</h3>${side.form?.length ? h`<table class="t">${side.form.map(row)}</table>` : h`<p class="empty">no recent games listed</p>`}</div>`;
  return h`<div class="pitches">${formBox(m.home)}${formBox(m.away)}</div>
    ${m.h2h?.length ? h`<h3 style="margin-top:10px">Last meetings</h3><table class="t">${m.h2h.map((g) => h`<tr><td>${g.date ? day(new Date(g.date)) : ""}</td><td>${g.comp || ""}</td><td class="n">${g.score}</td></tr>`)}</table>` : ""}`;
}

function wire(el, m) {
  el.querySelector("#quiet")?.addEventListener("change", (e) => {
    prefs.quiet = e.target.checked; savePrefs();
    el.querySelector("#feed")?.classList.toggle("quiet", prefs.quiet);
  });
  el.querySelectorAll("select[data-fan]").forEach((s) => s.addEventListener("change", () => {
    const fan = store("fan:" + m.id) || {};
    if (s.value) fan[s.dataset.fan] = s.value; else delete fan[s.dataset.fan];
    store("fan:" + m.id, fan);
    const idx = store("fanidx") || {};
    idx[m.id] = { d: m.date, h: m.home.abbr, a: m.away.abbr };
    store("fanidx", idx);
  }));
  el.querySelector("#replay")?.addEventListener("click", () => {
    const feed = el.querySelector("#feed");
    const items = [...feed.children].reverse();
    feed.innerHTML = "";
    clearInterval(replayTimer);
    let i = 0;
    const lab = el.querySelector("#rpl");
    replayTimer = setInterval(() => {
      if (i >= items.length) { clearInterval(replayTimer); lab.textContent = " full time"; return; }
      const li = items[i++];
      li.classList.add("new");
      feed.prepend(li);
      lab.textContent = " " + (li.querySelector(".m").textContent || "");
      if (li.classList.contains("goal")) beep(3);
    }, 900);
  });
}

// ---------------------------------------------------------------- fixtures

export async function fixtures(el) {
  let d;
  try { d = await api(`/api/fixtures?team=${prefs.team}`, { ttl: 60 }); }
  catch (e) { put(el, fail("fixtures")); return; }
  const comps = [...new Set(d.rows.map((f) => f.league))];
  const pick = sessionStorage.getItem("rm:fxcomp") || "";
  const rows = d.rows.filter((f) => !pick || f.league === pick);
  const months = {};
  rows.forEach((f) => {
    const k = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: userTz }).format(new Date(f.date));
    (months[k] ||= []).push(f);
  });
  const host = location.host;
  put(el, h`<h1 class="pagehead">Fixtures &amp; results <small>${TEAM_NAMES[prefs.team]}</small></h1>
    <div class="row">
      <select id="fxcomp"><option value="">all competitions</option>${comps.map((c) => h`<option value="${c}" ${c === pick ? "selected" : ""}>${comp(c)}</option>`)}</select>
      <a class="btn" href="webcal://${host}/api/calendar.ics?team=${prefs.team}">subscribe in calendar</a>
      <a class="btn" href="/api/calendar.ics?team=${prefs.team}" download>.ics file</a>
    </div>
    ${!inSpain ? h`<p class="sub">Times in ${userTz.replace(/_/g, " ")}, Madrid time in brackets.</p>` : ""}
    ${Object.entries(months).map(([mo, fs]) => h`<div class="box flat"><h2>${mo}</h2><div class="in scroll"><table class="t fx">
      <colgroup><col style="width:120px"><col style="width:110px"><col><col style="width:90px"><col style="width:48px"></colgroup>
      ${fs.map((f) => {
        const done = f.status.state === "post", show = revealed(f.id);
        return h`<tr class="${f.status.state === "in" ? "me" : ""}">
          <td style="white-space:nowrap">${day(new Date(f.date))}<br><span class="sub">${done ? "" : hhmm(new Date(f.date))}</span></td>
          <td class="sub">${comp(f.league, f.comp)}</td>
          <td><a href="#/match/${f.league}/${f.id}">${f.home.name} v ${f.away.name}</a>
            ${!done && !inSpain && prefs.times !== "local" ? h`<br><span class="sub">${hhmm(new Date(f.date), "Europe/Madrid")} Madrid</span>` : ""}
            ${f.tv?.length && !done ? h`<br><span class="sub">${f.tv.join(", ")}</span>` : ""}</td>
          <td class="n" style="white-space:nowrap">${f.status.state === "pre" ? (f.status.detail.match(/postp|cancel/i) ? f.status.detail : "") : show ? h`<b>${scoreText(f)}</b>` : veil(f.id)}
            ${f.status.state === "in" ? h`<br><span class="live">LIVE</span>` : ""}</td>
          <td class="c">${done && show ? h`<span class="form"><span class="${result(f)}">${result(f)}</span></span>` : ""}</td>
        </tr>`;
      })}</table></div></div>`)}`);
  el.querySelector("#fxcomp").addEventListener("change", (e) => {
    sessionStorage.setItem("rm:fxcomp", e.target.value);
    fixtures(el);
  });
}

// ---------------------------------------------------------------- tables

export async function tables(el, league) {
  let ov;
  try { ov = await api(`/api/overview?team=${prefs.team}`, { ttl: 60 }); } catch (e) { put(el, fail("tables")); return; }
  const leagues = ov.info.tables || [];
  if (!leagues.length) { put(el, h`<h1 class="pagehead">Tables</h1><p class="empty">ESPN doesn't carry a table for this team's league.</p>`); return; }
  league = leagues.includes(league) ? league : leagues[0];
  put(el, h`<h1 class="pagehead">Tables</h1>
    <div class="tabs">${leagues.map((l) => h`<a href="#/table/${l}" class="${l === league ? "on" : ""}">${comp(l)}</a>`)}</div>
    <div class="tabbody" id="tb"><p class="loading">loading...</p></div>`);
  const tb = el.querySelector("#tb");
  try {
    const t = await api(`/api/table/${league}`, { ttl: 300 });
    put(tb, h`<p class="sub">${t.season}</p>${t.groups.map((g) => h`
      ${t.groups.length > 1 ? h`<h3>${g.name}</h3>` : ""}
      <div class="scroll"><table class="t">
      <tr><th class="n">#</th><th>team</th><th class="n">P</th><th class="n">W</th><th class="n">D</th><th class="n">L</th><th class="n hide-s">GF</th><th class="n hide-s">GA</th><th class="n">GD</th><th class="n">Pts</th></tr>
      ${g.rows.map((r, i) => h`<tr class="${r.id === myId() ? "me" : ""}" ${i && g.rows[i - 1].note !== r.note ? raw('style="border-top:2px solid var(--ink)"') : ""}>
        <td class="n">${r.rank}</td><td>${r.name}${r.note && (i === 0 || g.rows[i - 1].note !== r.note) ? h` <span class="sub">${r.note}</span>` : ""}</td>
        <td class="n">${r.p}</td><td class="n">${r.w}</td><td class="n">${r.d}</td><td class="n">${r.l}</td>
        <td class="n hide-s">${r.gf}</td><td class="n hide-s">${r.ga}</td><td class="n">${r.gd > 0 ? "+" : ""}${r.gd}</td><td class="n"><b>${r.pts}</b></td></tr>`)}
      </table></div>`)}`);
  } catch (e) { put(tb, fail("the table")); }
}

// ---------------------------------------------------------------- news

export async function newsPage(el) {
  const pins = store("pins") || [];
  put(el, h`<h1 class="pagehead">News <small>translated where needed</small></h1>
    <div class="box"><h2>paste something<small>an X/Twitter link or any text</small></h2><div class="in">
      <textarea id="pastebox" placeholder="https://x.com/... or a quote in Spanish, Portuguese, whatever"></textarea>
      <div class="row"><input type="text" id="pasteby" placeholder="who said it (optional)" style="flex:1"><button id="pastego">translate &amp; pin</button></div>
      <div id="pins">${pins.map(pinHtml)}</div>
    </div></div>
    <div class="row" id="filters">
      ${["A", "B", "C"].map((t) => h`<label><input type="checkbox" data-tier="${t}" ${prefs.tiers[t] ? "checked" : ""}> <span class="tier ${t}">${t}</span></label>`)}
      <select id="src"><option value="">every source</option></select>
      <select id="dayp"><option value="">today's wire</option></select>
    </div>
    <div id="nl"><p class="loading">fetching the wires...</p></div>`);

  let data = null, archive = null;
  const list = el.querySelector("#nl");
  const draw = () => {
    const items = (archive || data?.items || []);
    const src = el.querySelector("#src").value;
    const shown = items.filter((i) => prefs.tiers[tierOf(i)] && (!src || i.source === src || i.journalist === src));
    put(list, shown.length ? h`<ul class="news">${shown.map((i) => newsItem(i))}</ul>` : h`<p class="empty">Nothing matches those filters.</p>`);
  };
  try {
    data = await api(newsUrl(), { ttl: 120 });
    const names = [...new Set(data.items.flatMap((i) => [i.journalist, i.source]).filter(Boolean))].sort();
    el.querySelector("#src").insertAdjacentHTML("beforeend", names.map((n) => `<option>${esc(n)}</option>`).join(""));
    if (data.failed) flash(`${data.failed} source(s) didn't answer this time.`);
    draw();
  } catch (e) { put(list, fail("the news")); }

  staticJson(`/data/${prefs.team}/news/days.json`).then((days) => {
    if (!days?.length) return;
    el.querySelector("#dayp").insertAdjacentHTML("beforeend", [...days].reverse().map((d) => `<option>${esc(d)}</option>`).join(""));
  });
  el.querySelector("#dayp").addEventListener("change", async (e) => {
    archive = e.target.value ? ((await staticJson(`/data/${prefs.team}/news/${e.target.value}.json`))?.items || []) : null;
    draw();
  });
  el.querySelector("#src").addEventListener("change", draw);
  el.querySelectorAll("[data-tier]").forEach((c) => c.addEventListener("change", () => {
    prefs.tiers[c.dataset.tier] = c.checked; savePrefs(); draw();
  }));
  el.querySelector("#pastego").addEventListener("click", async () => {
    const txt = el.querySelector("#pastebox").value.trim();
    if (!txt) return;
    const isUrl = /^https?:\/\//.test(txt);
    const btn = el.querySelector("#pastego");
    btn.disabled = true; btn.textContent = "working...";
    try {
      const r = await fetch("/api/paste", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isUrl ? { url: txt } : { text: txt }) }).then((r) => r.json());
      if (r.error) throw new Error(r.error);
      const pin = { ...r, author: el.querySelector("#pasteby").value.trim() || r.author, at: new Date().toISOString() };
      const all = [pin, ...(store("pins") || [])].slice(0, 30);
      store("pins", all);
      el.querySelector("#pins").innerHTML = all.map((p) => html(pinHtml(p))).join("");
      el.querySelector("#pastebox").value = "";
    } catch (err) {
      flash(isUrl ? "Couldn't read that link. X sometimes blocks it; paste the text instead." : "Translation failed, try again in a minute.");
    } finally { btn.disabled = false; btn.textContent = "translate & pin"; }
  });
  el.querySelector("#pins").addEventListener("click", (e) => {
    const x = e.target.closest("[data-unpin]");
    if (!x) return;
    const all = (store("pins") || []).filter((p) => p.at !== x.dataset.unpin);
    store("pins", all);
    el.querySelector("#pins").innerHTML = all.map((p) => html(pinHtml(p))).join("");
  });
}

function pinHtml(p) {
  const same = (p.text_en || "").trim().toLowerCase() === (p.text || "").trim().toLowerCase();
  return h`<div class="pin"><button class="x" data-unpin="${p.at}" title="remove">x</button>
    <div>${p.text_en || p.text}</div>
    ${!same ? h`<div class="orig">${p.text}</div>` : ""}
    <div class="by">${p.author || "unknown"}, pinned ${ago(p.at)}${p.url ? h`, <a href="${p.url}" target="_blank" rel="noopener noreferrer">source</a>` : ""}</div></div>`;
}

// ---------------------------------------------------------------- season data

const seasonMemo = {};
export async function seasonData(team = prefs.team) {
  if (seasonMemo[team] && Date.now() - seasonMemo[team].t < 600e3) return seasonMemo[team].v;
  const arch = (await staticJson(`/data/${team}/index.json`)) || { matches: [], names: {} };
  const skip = arch.matches.map((m) => m.id).sort().join(",");
  let fresh = { matches: [], names: {} };
  try { fresh = await api(`/api/season?team=${team}${skip ? "&skip=" + skip : ""}`, { ttl: 600, timeout: 30000 }); } catch (e) {}
  const byId = {};
  [...arch.matches, ...fresh.matches].forEach((m) => (byId[m.id] = m));
  const v = { matches: Object.values(byId).sort((a, b) => (a.date || "").localeCompare(b.date || "")), names: { ...fresh.names, ...arch.names } };
  seasonMemo[team] = { t: Date.now(), v };
  return v;
}

function playerSeason(s, pid) {
  const games = s.matches.filter((m) => m.players[pid]).map((m) => {
    const [r, mins, g, a, y, rc, st] = m.players[pid];
    return { m, r, mins, g, a, y, rc, st };
  });
  const rated = games.filter((x) => x.r != null);
  return {
    games, apps: games.length, starts: games.filter((x) => x.st).length,
    mins: games.reduce((t, x) => t + x.mins, 0), g: games.reduce((t, x) => t + x.g, 0), a: games.reduce((t, x) => t + x.a, 0),
    y: games.reduce((t, x) => t + x.y, 0), avg: rated.length ? rated.reduce((t, x) => t + x.r, 0) / rated.length : null,
    motm: games.filter((x) => x.m.motm === pid).length,
  };
}

// ---------------------------------------------------------------- squad

const POS_ORDER = { G: 0, GK: 0, D: 1, M: 2, F: 3 };
const POS_NAME = ["Goalkeepers", "Defenders", "Midfielders", "Forwards"];

export async function squad(el) {
  put(el, h`<p class="loading">loading the squad and this season's numbers...</p>`);
  let sq, s;
  try { [sq, s] = await Promise.all([api(`/api/squad?team=${prefs.team}`, { ttl: 600 }), seasonData()]); }
  catch (e) { put(el, fail("the squad")); return; }

  const warn = [];
  const liga = s.matches.filter((m) => m.league === "esp.1" || m.league === "esp.w.1");
  const lastLiga = liga[liga.length - 1];
  const groups = [[], [], [], []];
  for (const p of sq.players) {
    const st = playerSeason(s, p.id);
    const ligaY = liga.reduce((t, m) => t + (m.players[p.id]?.[4] || 0), 0);
    if (ligaY && ligaY % 5 === 4) warn.push(h`<div class="warn"><b>${p.name}</b> is on ${ligaY} league yellows. One more is a one-match ban.</div>`);
    if (lastLiga?.players[p.id]?.[5]) warn.push(h`<div class="warn"><b>${p.name}</b> was sent off last league game, so most likely misses the next one.</div>`);
    if (p.injuries?.length) warn.push(h`<div class="warn"><span class="inj">INJ</span> <b>${p.name}</b>: ${p.injuries[0].detail || p.injuries[0].status || "injured"}${p.injuries[0].back ? h`, back around ${day(new Date(p.injuries[0].back))}` : ""}</div>`);
    groups[POS_ORDER[p.pos?.[0]] ?? 2].push({ p, st });
  }
  put(el, h`<h1 class="pagehead">Squad <small>${TEAM_NAMES[prefs.team]}${sq.coach ? ", coach " + sq.coach : ""}</small></h1>
    ${warn.length ? box("availability", warn) : ""}
    ${groups.map((g, i) => g.length ? h`<div class="box flat"><h2>${POS_NAME[i]}</h2><div class="in scroll"><table class="t fx">
      <colgroup><col style="width:44px"><col><col class="hide-s" style="width:56px"><col class="hide-s" style="width:150px"><col style="width:76px"><col style="width:64px"><col style="width:40px"><col style="width:40px"><col class="hide-s" style="width:40px"><col style="width:70px"></colgroup>
      <tr><th>#</th><th>player</th><th class="n hide-s">age</th><th class="hide-s">nat.</th><th class="n">apps</th><th class="n">min</th><th class="n">G</th><th class="n">A</th><th class="n hide-s">Y</th><th class="c">avg</th></tr>
      ${g.sort((a, b) => (+a.p.no || 99) - (+b.p.no || 99)).map(({ p, st }) => h`<tr>
        <td>${p.no || ""}</td><td><a href="#/player/${p.id}">${p.name}</a>${p.injuries?.length ? h` <span class="inj">INJ</span>` : ""}${st.motm ? h` <span class="sub">${st.motm}x motm</span>` : ""}</td>
        <td class="n hide-s">${p.age || ""}</td><td class="hide-s sub">${p.nat || ""}</td>
        <td class="n">${st.apps ? h`${st.apps}<span class="sub">(${st.starts})</span>` : "-"}</td><td class="n">${st.mins || "-"}</td>
        <td class="n">${st.g || ""}</td><td class="n">${st.a || ""}</td><td class="n hide-s">${st.y || ""}</td>
        <td class="c">${st.avg != null ? rt(Math.round(st.avg * 100) / 100) : ""}</td></tr>`)}
      </table></div></div>` : "")}
    <p class="sub">Apps (starts) and ratings cover competitive games this season. Friendlies don't count.</p>`);
}

// ---------------------------------------------------------------- player

export async function player(el, pid) {
  put(el, h`<p class="loading">loading...</p>`);
  const s = await seasonData();
  const st = playerSeason(s, pid);
  const [name, pos] = s.names[pid] || ["Unknown player", ""];
  if (!st.apps) { put(el, h`<h1 class="pagehead">${name}</h1><p class="empty">No competitive minutes this season yet.</p>`); return; }
  const fanAvg = (() => {
    const vals = st.games.map((x) => (store("fan:" + x.m.id) || {})[pid]).filter(Boolean).map(Number);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  })();
  const pts = st.games.filter((x) => x.r != null);
  put(el, h`<h1 class="pagehead">${name} <small>${pos}</small></h1>
    <div class="cols"><div>
      ${box("rating by match", pts.length > 1 ? spark(pts) : h`<p class="empty">needs a couple more games</p>`, `${pts.length} rated`)}
      <div class="box flat"><h2>game log</h2><div class="in scroll"><table class="t">
        <tr><th>date</th><th>match</th><th class="n">min</th><th></th><th class="c">rating</th><th class="c">you</th></tr>
        ${[...st.games].reverse().map((x) => {
          const fan = (store("fan:" + x.m.id) || {})[pid];
          const show = revealed(x.m.id);
          return h`<tr><td style="white-space:nowrap">${day(new Date(x.m.date))}<br><span class="sub">${comp(x.m.league, x.m.comp)}</span></td>
          <td><a href="#/match/${x.m.league}/${x.m.id}/lineups">${x.m.home.abbr} ${show ? `${x.m.home.score}-${x.m.away.score}` : "v"} ${x.m.away.abbr}</a>${x.st ? "" : h` <span class="sub">sub</span>`}</td>
          <td class="n">${x.mins}</td>
          <td>${[...Array(x.g)].map(() => h`<span class="ico">G</span>`)}${[...Array(x.a)].map(() => h`<span class="ico">A</span>`)}${x.y ? h`<span class="ico y">Y</span>` : ""}${x.rc ? h`<span class="ico r">R</span>` : ""}</td>
          <td class="c">${rt(x.r, x.m.motm === pid ? "motm" : "")}</td><td class="c">${fan || ""}</td></tr>`;
        })}
      </table></div></div>
    </div><div>
      ${box("season", h`<dl class="kv">
        <dt>apps</dt><dd>${st.apps} (${st.starts} starts)</dd>
        <dt>minutes</dt><dd>${st.mins}</dd>
        <dt>goals</dt><dd>${st.g}</dd><dt>assists</dt><dd>${st.a}</dd>
        <dt>yellows</dt><dd>${st.y}</dd>
        <dt>avg rating</dt><dd>${st.avg != null ? rt(Math.round(st.avg * 100) / 100) : "-"}</dd>
        <dt>your avg</dt><dd>${fanAvg != null ? fanAvg.toFixed(2) : h`<span class="sub">rate him on a match page</span>`}</dd>
        <dt>player of the match</dt><dd>${st.motm}</dd></dl>`)}
    </div></div>`);
}

function spark(pts) {
  const W = 300, H = 80, pad = 14;
  const xs = (i) => pad + (i * (W - pad * 2)) / Math.max(1, pts.length - 1);
  const ys = (r) => H - pad - ((r - 4) / 6) * (H - pad * 2);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)},${ys(p.r).toFixed(1)}`).join(" ");
  return raw(`<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="rating trend">
    ${[6, 7, 8].map((v) => `<line class="gd" x1="${pad}" x2="${W - pad}" y1="${ys(v)}" y2="${ys(v)}"/><text x="0" y="${ys(v) + 3}">${v}</text>`).join("")}
    <path class="ln" d="${path}"/>
    ${pts.map((p, i) => `<circle class="dt" r="2.5" cx="${xs(i).toFixed(1)}" cy="${ys(p.r).toFixed(1)}"><title>${esc(p.m.home.abbr + " v " + p.m.away.abbr + ": " + p.r)}</title></circle>`).join("")}
  </svg>`);
}

// ---------------------------------------------------------------- ratings explainer

export async function ratingsPage(el) {
  let w = null;
  try { w = await api("/api/model", { ttl: 3600 }); } catch (e) {}
  const row = (label, v) => h`<tr><td>${label}</td><td class="n">${v > 0 ? "+" : ""}${Number(v).toFixed(2)}</td></tr>`;
  put(el, h`<h1 class="pagehead">How the ratings work</h1>
  <div class="cols"><div>
    <p>Every player starts on <b>6.0</b>. Then we read ESPN's minute-by-minute commentary (the same Opta-style feed the TV graphics use) and add or take away a little for everything he's involved in: goals, assists, chances made, shots, fouls won and given away, cards, offsides, saves, goals let in while he was on the pitch, and so on.</p>
    <p>The numbers below aren't guesses. They were fitted against FotMob's ratings for 449 player performances from the first sixteen competitive games of 2026-27, so the scale should feel familiar: 6.5 is a quiet night, 7.5 a good one, 8.5+ is the headline. Tested on games the fit hadn't seen, we land about <b>0.3</b> from FotMob on average, and within half a point for most players.</p>
    <p>What we can't see: passes, duels, dribbles and tackles per player. ESPN only gives those for whole teams. So a midfielder who runs the game without shooting or fouling can come out a bit lower than he deserves. Team possession and the result are in there partly to make up for that.</p>
    <p>Anyone on for less than ${w?.min_minutes ?? 10} minutes doesn't get a number. During a game ratings are live and drift up with minutes played, the same way FotMob's do.</p>
    <p>Don't agree? Every match page lets you put in your own score next to ours, and the player pages keep your average. It's all stored in your browser, nowhere else.</p>
  </div><div>
    ${w ? box("the weights", h`<table class="t">
      ${row("goal", w.events.goals)}${row("penalty goal (on top)", w.events.pen_goals)}${row("assist", w.events.assists)}
      ${row("chance created", w.events.key_passes)}${row("shot on target", w.events.sot)}${row("hit the woodwork", w.events.wood)}
      ${row("foul won", w.events.fouls_w)}${row("foul committed", w.events.fouls_c)}${row("offside", w.events.offs)}
      ${row("yellow card", w.events.yc)}${row("red card", w.events.rc)}${row("penalty won", w.events.pen_won)}
      ${row("penalty conceded", w.events.pen_conc)}${row("own goal", w.events.own_goals)}
      ${row("save (keeper)", w.save)}${row("keeper, per goal let in", w.conceded.GK)}${row("defender, per goal let in", w.conceded.DEF)}
      ${row("keeper clean sheet", w.clean.GK)}${row("full 90 minutes", w.minutes)}${row("win (midfielder)", w.result.MID)}
    </table>`, "per event") : ""}
  </div></div>`);
}

// ---------------------------------------------------------------- settings

export async function settings(el, rerender) {
  const notifState = !("Notification" in window) ? "not supported here" : Notification.permission;
  const src = await api("/api/sources", { ttl: 3600 }).catch(() => null);
  const names = src ? [...src.journalists.map((j) => j.name), ...src.outlets.map((o) => o.name)] : [];
  const tierFor = (n) => prefs.tierOverride[n] || [...(src?.journalists || []), ...(src?.outlets || [])].find((x) => x.name === n)?.tier;
  const opt = (k, v, label) => h`<label><input type="radio" name="${k}" value="${v}" ${String(prefs[k]) === String(v) ? "checked" : ""}> ${label}</label>`;
  put(el, h`<h1 class="pagehead">Settings <small>saved in this browser only</small></h1>
    ${box("team", h`<div class="row">${opt("team", "men", "Real Madrid")}${opt("team", "women", "Femenino")}${opt("team", "castilla", "Castilla")}</div>
      <p class="sub">Castilla coverage is thin: ESPN doesn't carry Primera Federación, so you'll mostly see friendlies.</p>`)}
    ${box("look", h`<div class="row">${opt("theme", "auto", "follow my device")}${opt("theme", "light", "light")}${opt("theme", "dark", "dark grey")}${opt("theme", "amoled", "pure black (AMOLED)")}</div>
      <p class="sub">Tip: type a page number (100 to 700) anywhere to jump straight to it.</p>`)}
    ${box("times", h`<div class="row">${opt("times", "both", "mine + Madrid")}${opt("times", "local", "just mine")}${opt("times", "madrid", "just Madrid")}</div>
      <p class="sub">Your timezone: ${userTz}${inSpain ? " (that's Spain, so Madrid time is your time)" : ""}</p>`)}
    ${box("match day", h`
      <div class="row"><label><input type="checkbox" id="alerts" ${prefs.alerts ? "checked" : ""}> notifications for kick-off, goals, red cards, HT and FT</label> <span class="sub">(${notifState})</span></div>
      <div class="row"><label><input type="checkbox" id="beep" ${prefs.beep ? "checked" : ""}> beep on goals</label> <button id="testbeep">test</button></div>
      <div class="row"><label><input type="checkbox" id="spoilers" ${prefs.spoilers ? "checked" : ""}> spoiler mode (hide scores until I click)</label></div>
      <p class="sub">Alerts work while rmtrack is open in a tab, even in the background. Add it to your home screen on a phone for the best results.</p>`)}
    ${box("news sources", h`
      <p class="sub">Change how much you trust each source. A = trusted, B = solid, C = pinch of salt.</p>
      <table class="t">${names.map((n) => h`<tr><td>${n}</td><td>${["A", "B", "C"].map((t) => h`<label><input type="radio" name="tier:${n}" value="${t}" ${tierFor(n) === t ? "checked" : ""}> ${t}</label> `)}</td></tr>`)}</table>
      <p>Extra journalists to follow (comma separated names):<br><input type="text" id="who" value="${prefs.who}" style="width:100%" placeholder="e.g. Mario Cortegana, Guillermo Rai"></p>
      <p>Extra Bluesky accounts (comma separated handles):<br><input type="text" id="bsky" value="${prefs.bsky}" style="width:100%" placeholder="someone.bsky.social"></p>
      <button id="savesrc">save sources</button>`)}
    ${box("your data", h`<p>Fan ratings for ${Object.keys(store("fanidx") || {}).length} match(es), ${(store("pins") || []).length} pinned item(s).</p>
      <button id="export">download as JSON</button> <button id="wipe">clear everything</button>`)}`);

  el.querySelectorAll("input[type=radio][name=team], input[type=radio][name=theme], input[type=radio][name=times]").forEach((r) =>
    r.addEventListener("change", () => {
      prefs[r.name] = r.value; savePrefs(); applyTheme();
      if (r.name === "team") rerender(true);
    }));
  const tick = (id, fn) => el.querySelector("#" + id).addEventListener("change", (e) => { prefs[id] = e.target.checked; savePrefs(); fn?.(e); });
  tick("beep");
  tick("spoilers");
  tick("alerts", async (e) => {
    if (e.target.checked && "Notification" in window && Notification.permission !== "granted") {
      const p = await Notification.requestPermission();
      if (p !== "granted") { prefs.alerts = false; savePrefs(); e.target.checked = false; flash("Notifications are blocked for this site in your browser settings."); }
    }
  });
  el.querySelector("#testbeep").addEventListener("click", () => beep(4));
  el.querySelector("#savesrc").addEventListener("click", () => {
    el.querySelectorAll("input[type=radio][name^='tier:']:checked").forEach((r) => {
      const n = r.name.slice(5);
      const base = [...(src?.journalists || []), ...(src?.outlets || [])].find((x) => x.name === n)?.tier;
      if (r.value === base) delete prefs.tierOverride[n]; else prefs.tierOverride[n] = r.value;
    });
    prefs.who = el.querySelector("#who").value.split(",").map((s) => s.trim()).filter(Boolean).join(", ");
    prefs.bsky = el.querySelector("#bsky").value.split(",").map((s) => s.trim().replace(/^@/, "")).filter(Boolean).join(",");
    savePrefs();
    flash("Saved. The news page will pick it up on its next refresh.");
  });
  el.querySelector("#export").addEventListener("click", () => {
    const dump = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith("rm:")) dump[k] = localStorage.getItem(k);
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(dump, null, 1)], { type: "application/json" }));
    a.download = "rmtrack-data.json";
    a.click();
  });
  el.querySelector("#wipe").addEventListener("click", () => {
    if (!confirm("Clear your settings, fan ratings and pins from this browser?")) return;
    Object.keys(localStorage).filter((k) => k.startsWith("rm:")).forEach((k) => localStorage.removeItem(k));
    location.reload();
  });
}
