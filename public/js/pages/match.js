// Match centre. Four tabs, and which one opens depends on the state of the
// game: preview before kick-off, live commentary during, ratings after.
import { api, prefs, savePrefs, store, h, html, when, hhmm, dayYear, rt } from "../core.js?v=11";
import { beep } from "../alerts.js?v=11";
import { put, fail, loading, board, tabs, revealed, veil, isMine, icons, resultBadge, personLink, teamLink, feedLine } from "../ui.js?v=11";
import { shotMap, momentum, territory, playerMap, xgRace } from "../maps.js?v=11";
import { kit, numberedKit } from "../kits.js?v=11";
import { scouting } from "../league.js?v=11";

const LEGACY = { lineups: "ratings", maps: "stats", before: "preview" };

function defaultTab(m) {
  if (m.status.state === "pre") return "preview";
  if (m.status.state === "in") return "live";
  return m.rated ? "ratings" : "live";
}

function tabList(m, league, id) {
  const pre = m.status.state === "pre";
  const items = [];
  if (!pre || m.feed.length) items.push(["live", m.status.state === "in" ? "live" : "commentary"]);
  if (m.home.xi.length || m.away.xi.length) items.push(["ratings", m.rated ? "ratings" : "line-ups"]);
  if (!pre) items.push(["stats", "stats and xG"]);
  items.push(["preview", "preview"]);
  return items.map(([k, label]) => [k, label, `#/match/${league}/${id}/${k}`]);
}

let replayTimer = null;

export async function match(el, league, id, wanted) {
  let m;
  const draw = async (first) => {
    try { m = await api(`/api/match/${league}/${id}`, { ttl: first ? 5 : 0 }); }
    catch { if (first) put(el, fail("this match")); return; }
    const items = tabList(m, league, id);
    if (LEGACY[wanted]) {
      history.replaceState(null, "", `#/match/${league}/${id}/${LEGACY[wanted]}`);
    }
    let tab = LEGACY[wanted] || wanted || defaultTab(m);
    if (!items.some(([k]) => k === tab)) tab = items[0][0];

    const keepOpen = [...el.querySelectorAll("details[open]")].map((d) => d.dataset.k);
    const scrollY = window.scrollY;
    put(el, h`<p class="crumbs"><a href="#/fixtures/${m.status.state === "post" ? "results" : "upcoming"}">fixtures</a></p>
      ${board(m, { countdown: true })}
      <div class="mt">${tabs(items, tab)}</div>
      <div class="tabbody"><div class="pane">${body(m, tab)}</div></div>
      <p class="sub">updated ${hhmm(new Date(m.updated))}${m.status.state === "in" ? ", refreshing every 15s" : ""}</p>`);
    keepOpen.forEach((k) => el.querySelector(`details[data-k="${k}"]`)?.setAttribute("open", ""));
    if (!first) window.scrollTo(0, scrollY);
    const slot = el.querySelector("#scout");
    if (slot) scouting(m).then((v) => { slot.innerHTML = html(v); }).catch(() => { slot.innerHTML = ""; });
    wire(el, m);
  };
  await draw(true);
  const refresh = setInterval(() => {
    const soon = m?.status.state === "pre" && new Date(m.date) - Date.now() < 3600e3;
    if (m?.status.state === "in" || soon) draw(false);
  }, 15000);
  return () => { clearInterval(refresh); clearInterval(replayTimer); };
}

function body(m, tab) {
  const show = revealed(m.id) || m.status.state === "pre";
  if (!show && tab !== "preview") return h`<p>Spoiler mode is on. ${veil(m.id)} to see what happened.</p>`;
  if (tab === "ratings") return ratings(m);
  if (tab === "stats") return h`${shotMap(m)}${xgRace(m)}${teamStats(m)}${momentum(m)}${territory(m)}`;
  if (tab === "preview") return preview(m);
  return commentary(m);
}

// ---------------------------------------------------------------- live

// the key events strip: goals, cards, subs and VAR, each player linked
function keyEvent(m, e) {
  const side = m[e.s];
  const [who, other] = e.p || [];
  const name = who ? personLink(m, side, who[0], who[1]) : ((e.x.match(/(?:Goal!.*?\.|^)\s*([^.(]+?) \(/) || [])[1] || "").trim();
  if (e.k === "goal") {
    const og = /own goal/i.test(e.x);
    const scorer = og && who ? personLink(m, m[e.s === "home" ? "away" : "home"], who[0], who[1]) : name;
    return h`<span class="ico g">G</span> ${scorer}${/penalty/i.test(e.x) ? " (pen)" : og ? " (og)" : ""}`;
  }
  if (e.k === "yellow") return h`<span class="card y"></span>${name}`;
  if (e.k === "red") return h`<span class="card r"></span>${name}`;
  if (e.k === "sub") {
    return h`<span class="subin" title="on"></span>${name}${other ? h` <span class="sub in"><span class="subout" title="off"></span>${personLink(m, side, other[0], other[1])}</span>` : ""}`;
  }
  if (e.k === "penmiss") return h`<span class="ico">P</span> ${name || e.x.split(".")[0]} missed`;
  if (e.k === "var") return h`<span class="ico">VAR</span> ${e.x.replace(/^VAR Decision:\s*/, "").slice(0, 60)}`;
  return e.x;
}

function keyEvents(m) {
  if (!m.timeline.length) return "";
  return h`<ul class="tl">${m.timeline.map((e) => h`<li class="${e.k}"><span class="h">${e.s === "home" ? keyEvent(m, e) : ""}</span><span class="m">${e.m}</span><span>${e.s === "away" ? keyEvent(m, e) : ""}</span></li>`)}</ul>`;
}

function commentary(m) {
  if (!m.feed.length) return h`${keyEvents(m)}<p class="empty">No commentary for this one. ESPN doesn't cover every match in full.</p>`;
  return h`
    <h3 class="maph">Key events</h3>
    ${keyEvents(m) || h`<p class="empty">Nothing yet.</p>`}
    <h3 class="maph">Minute by minute</h3>
    <div class="row">
      <label><input type="checkbox" id="quiet" ${prefs.quiet ? "checked" : ""}> hide fouls, corners and offsides</label>
      ${m.status.state === "post" ? h`<button type="button" id="replay">replay the match</button><span class="sub" id="rpl" aria-live="polite"></span>` : ""}
    </div>
    <ul class="feed ${prefs.quiet ? "quiet" : ""}" id="feed">${[...m.feed].reverse().map(feedLine)}</ul>`;
}

// ---------------------------------------------------------------- ratings

function pitch(side, m) {
  const rows = ["ATT", "AM", "MID", "DM", "DEF", "GK"];
  if (!side.xi.length) return h`<div class="pitch ${isMine(side) ? "" : "them"}"><div class="cap">${side.name}: line-up not out yet</div></div>`;
  const lines = rows.map((r) => side.xi.filter((p) => p.row === r)).filter((l) => l.length);
  const show = revealed(m.id);
  return h`<div class="pitch ${isMine(side) ? "" : "them"}">
    <div class="cap">${side.name}${side.formation ? ", " + side.formation : ""}</div>
    ${lines.map((l) => h`<div class="ln">${l.map((p) => h`<div class="pl" title="${p.name}">
      ${m.rated && p.r != null ? rt(p.r, p.id === m.motm ? "motm" : "") : ""}
      ${show && (p.rc || p.y) ? h`<span class="card ${p.rc ? "r" : "y"}"></span>` : ""}
      <span class="no">${numberedKit(side, p.no, 34, side === m.home ? "home" : "away")}</span><span class="nm">${personLink(m, side, p.id, p.short.replace(/^\p{Lu}\. /u, ""))}</span>
      ${show && (p.g || p.a) ? h`<span class="ev">${p.g ? `${p.g > 1 ? p.g : ""}G ` : ""}${p.a ? `${p.a > 1 ? p.a : ""}A` : ""}</span>` : ""}</div>`)}</div>`)}
  </div>`;
}

const FAN_SCALE = [...Array(19)].map((_, i) => (1 + i * 0.5).toFixed(1));

function ratingTable(side, m) {
  const fan = store("fan:" + m.id) || {};
  const rows = [...side.xi, ...side.bench.filter((p) => p.mins > 0)];
  return h`<div class="scroll"><table class="t fx">
    <colgroup><col style="width:40px"><col><col class="hide-s" style="width:64px"><col style="width:50px"><col style="width:90px"><col style="width:70px"><col style="width:70px"></colgroup>
    <tr><th>#</th><th>player</th><th class="hide-s">pos</th><th class="n">min</th><th></th><th class="c">rating</th><th class="c">you</th></tr>
    ${rows.map((p) => h`<tr>
      <td>${p.no}</td>
      <td>${personLink(m, side, p.id, p.name)}${p.on > 0 ? h` <span class="sub in"><span class="subin"></span>${p.on}'</span>` : ""}${p.off > 0 && side.xi.includes(p) ? h` <span class="sub in"><span class="subout"></span>${p.off}'</span>` : ""}
        ${m.rated && p.mins ? h`<details class="why" data-k="p${p.id}"><summary>map, xG ${(p.xg ?? 0).toFixed(2)}, xA ${(p.xa ?? 0).toFixed(2)}</summary>${playerMap(m, p.id)}</details>` : ""}
        ${p.why?.length ? h`<details class="why" data-k="w${p.id}"><summary>why ${p.r?.toFixed(1)}?</summary><div class="bd">${[["start", 6], ...p.why].map(([k, v]) => h`${k}: ${v > 0 && k !== "start" ? "+" : ""}${Number(v).toFixed(2)}<br>`)}</div></details>` : ""}
      </td>
      <td class="hide-s sub">${p.pos}</td>
      <td class="n">${p.mins || ""}</td>
      <td>${icons(p)}</td>
      <td class="c">${m.rated ? rt(p.r, p.id === m.motm ? "motm" : "") : ""}</td>
      <td class="c fan">${m.rated && p.mins ? h`<select data-fan="${p.id}" aria-label="your rating for ${p.name}"><option value="">-</option>${FAN_SCALE.map((v) => h`<option ${fan[p.id] === v ? "selected" : ""}>${v}</option>`)}</select>` : ""}</td>
    </tr>`)}
  </table></div>`;
}

function ratings(m) {
  if (!m.home.xi.length && !m.away.xi.length) return h`<p class="empty">Line-ups aren't out yet. They normally drop about an hour before kick-off.</p>`;
  // our side first
  const sides = isMine(m.away) ? [m.away, m.home] : [m.home, m.away];
  return h`
    <div class="pitches">${pitch(m.home, m)}${pitch(m.away, m)}</div>
    ${m.rated && m.feed.length < 40 ? h`<p class="warn">ESPN only has the basic events for this match (goals, cards, subs), so the ratings mostly reflect minutes, goals and the result. Treat them loosely.</p>` : ""}
    ${m.rated ? h`<p class="sub">Ratings start at 6.0 and move with every action${m.status.state === "in" ? "; it's live, so they keep moving" : ""}. ${m.motm ? "* marks the player of the match. " : ""}<a href="#/about">How they're worked out.</a></p>` : ""}
    ${sides.map((s) => h`<h3 class="maph tc">${kit(s, 20, s === m.home ? "home" : "away")}${teamLink(s)}</h3>${ratingTable(s, m)}`)}`;
}

// ---------------------------------------------------------------- stats

function teamStats(m) {
  if (!m.stats.length) return "";
  const num = (v) => parseFloat(String(v).replace("%", "")) || 0;
  return h`<h3 class="maph">Team stats</h3><div class="bars">
    <div class="b"><div class="l"><b>${m.home.abbr}</b></div><div></div><div class="r"><b>${m.away.abbr}</b></div></div>
    ${m.stats.map((s) => {
      const a = num(s.home), b = num(s.away), tot = a + b || 1;
      return h`<div class="lab">${s.label}</div><div class="b"><div class="l ${a > b ? "more" : ""}">${s.home}</div>
        <div class="track"><i class="hl" style="width:${(a / tot) * 100}%"></i><i class="al" style="width:${(b / tot) * 100}%"></i></div>
        <div class="r ${b > a ? "more" : ""}">${s.away}</div></div>`;
    })}</div>`;
}

// ---------------------------------------------------------------- preview

function preview(m) {
  const row = (f) => h`<tr><td>${f.date ? dayYear(new Date(f.date)) : ""}</td><td>${f.at === "@" ? "at " : "v "}${f.opp}</td><td class="n">${f.score}</td><td class="c">${resultBadge(f.res)}</td></tr>`;
  const form = (side) => h`<div><h3>${teamLink(side)}</h3>${side.form?.length ? h`<table class="t fx"><colgroup><col style="width:110px"><col><col style="width:56px"><col style="width:36px"></colgroup>${side.form.map(row)}</table>` : h`<p class="empty">no recent games listed</p>`}</div>`;
  return h`
    ${m.status.state === "pre" ? h`<p>Kick-off ${when(m.date)}. Line-ups usually land about an hour before.</p>` : ""}
    <div id="scout">${loading("scouting")}</div>
    <h3 class="maph">Recent form</h3>
    <div class="cols2">${form(m.home)}${form(m.away)}</div>
    ${m.h2h?.length ? h`<h3 class="maph">Last meetings</h3><table class="t">${m.h2h.map((g) => h`<tr><td>${g.date ? dayYear(new Date(g.date)) : ""}</td><td>${g.comp || ""}</td><td class="n"><b>${g.score}</b></td></tr>`)}</table>` : ""}`;
}

// ---------------------------------------------------------------- behaviour

function wire(el, m) {
  el.querySelector("#quiet")?.addEventListener("change", (e) => {
    prefs.quiet = e.target.checked;
    savePrefs();
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
    const label = el.querySelector("#rpl");
    feed.innerHTML = "";
    clearInterval(replayTimer);
    let i = 0;
    replayTimer = setInterval(() => {
      if (i >= items.length) { clearInterval(replayTimer); label.textContent = " full time"; return; }
      const li = items[i++];
      li.classList.add("new");
      feed.prepend(li);
      label.textContent = " " + (li.querySelector(".m").textContent || "");
      if (li.classList.contains("goal")) beep(3);
    }, 900);
  });
}
