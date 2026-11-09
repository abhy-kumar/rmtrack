// Small building blocks shared by every page.
import { prefs, team, TEAMS, h, html, raw, when, hhmm, day, until, inSpain, comp } from "./core.js?v=9";

export const put = (el, v) => { el.innerHTML = html(v); };

export const fail = (what) =>
  h`<p class="err">Couldn't load ${what} just now. It retries on its own, or <button type="button" class="linklike" data-reload>reload now</button>.</p>`;

export const loading = (what = "loading") => h`<p class="loading">${what}...</p>`;

export const box = (title, body, aside = "", cls = "") =>
  h`<section class="box ${cls}"><h2>${title}<small>${aside}</small></h2><div class="in">${body}</div></section>`;

export const pagehead = (title, sub = "") => h`<h1 class="pagehead">${title}${sub ? h` <small>${sub}</small>` : ""}</h1>`;

// tab strip; items are [key, label, href]
export const tabs = (items, current) =>
  h`<nav class="tabs" aria-label="sections">${items.map(([k, label, href]) =>
    h`<a href="${href}" class="${k === current ? "on" : ""}" ${k === current ? raw('aria-current="page"') : ""}>${label}</a>`)}</nav>`;

// segmented buttons inside a page; items are [key, label, href]
export const seg = (items, current) =>
  h`<div class="seg" role="group">${items.map(([k, label, href]) =>
    h`<a class="btn ${k === current ? "on" : ""}" href="${href}" ${k === current ? raw('aria-current="true"') : ""}>${label}</a>`)}</div>`;

document.addEventListener("click", (e) => {
  if (e.target.closest("[data-reload]")) location.reload();
});

// ---------------------------------------------------------------- spoilers

export function revealed(id) {
  if (!prefs.spoilers) return true;
  try { return sessionStorage.getItem("rm:seen:" + id) === "1"; } catch { return false; }
}

document.addEventListener("click", (e) => {
  const v = e.target.closest("[data-reveal]");
  if (!v) return;
  try { sessionStorage.setItem("rm:seen:" + v.dataset.reveal, "1"); } catch { /* private mode */ }
  window.dispatchEvent(new HashChangeEvent("hashchange"));
});

export const veil = (id) => h`<button type="button" class="veil" data-reveal="${id}" title="spoiler mode is on">show score</button>`;

// ---------------------------------------------------------------- links

// leagues the collector keeps full data for
export const DATA_LEAGUES = new Set(Object.values(TEAMS).flatMap((t) => t.leagues));
export const statLeague = (lg) => (DATA_LEAGUES.has(lg) ? lg : team().domestic || "esp.1");

export const isMine = (side) => side?.id === team().id;
export const teamHref = (id) => (id ? `#/team/${id}` : "");
export const teamLink = (side, label = side?.name) =>
  side?.id ? h`<a href="${teamHref(side.id)}">${label}</a>` : label;

// our players get the squad page, everyone else the league profile
export function personHref(m, side, id) {
  if (!id) return "";
  return isMine(side) ? `#/player/${id}` : `#/pro/${statLeague(m.league)}/${id}`;
}
export const personLink = (m, side, id, label) => (id ? h`<a href="${personHref(m, side, id)}">${label}</a>` : label);

// ---------------------------------------------------------------- results

export function result(f) {
  const me = isMine(f.home) ? f.home : f.away;
  const them = me === f.home ? f.away : f.home;
  const a = me.score ?? 0, b = them.score ?? 0;
  return a > b ? "W" : a < b ? "L" : "D";
}

const RES_WORD = { W: "win", D: "draw", L: "loss" };

export function statusLine(st, date) {
  if (st.state === "in") return h`<span class="live">LIVE</span> ${st.clock || st.detail}`;
  if (st.state === "post") return st.detail || "FT";
  if (/postponed|canceled|cancelled|suspended/i.test(st.detail)) return st.detail;
  return when(date);
}

export const resultBadge = (r, href = "", title = "") => (href
  ? h`<a class="res ${r}" href="${href}" title="${title || RES_WORD[r]}">${r}</a>`
  : h`<span class="res ${r}" title="${title || RES_WORD[r]}">${r}</span>`);

export function formStrip(form) {
  if (!form?.length) return h`<span class="sub">no games yet</span>`;
  const shown = prefs.spoilers ? form.slice(1) : form;
  return h`<span class="form">${[...shown].reverse().map((f) =>
    resultBadge(f.res, `#/match/${f.league}/${f.id}`, `${f.opp} ${f.score}`))}</span>`;
}

// ---------------------------------------------------------------- scoreboard

const scorerName = (g) => g.p?.[0]?.[1] || ((g.x.match(/(?:^|\. )([^.(]+?) \(/) || [])[1] || "").trim();

function scorers(m, sideKey) {
  const side = m[sideKey];
  return m.timeline.filter((e) => e.k === "goal" && e.s === sideKey).map((g) => {
    const pen = /penalty/i.test(g.x) ? " (pen)" : /own goal/i.test(g.x) ? " (og)" : "";
    const id = g.p?.[0]?.[0];
    // an own goal is credited to the side that benefits; the player is on the other one
    const owner = pen === " (og)" ? m[sideKey === "home" ? "away" : "home"] : side;
    return h`<li>${personLink(m, owner, id, scorerName(g))} ${g.m}${pen}</li>`;
  });
}

// One scoreboard for every state of a match, so a preview and a result look
// like the same thing. The score (or kick-off time) links to the match.
export function board(m, { countdown = false } = {}) {
  const pre = m.status.state === "pre";
  const show = pre || revealed(m.id);
  const href = `#/match/${m.league}/${m.id}`;
  const d = m.date ? new Date(m.date) : null;
  const score = pre
    ? h`<a class="sc" href="${href}">${d ? hhmm(d) : "tbc"}</a>`
    : show ? h`<a class="sc" href="${href}">${m.home.score ?? 0}-${m.away.score ?? 0}</a>` : h`<span class="sc">${veil(m.id)}</span>`;
  const madrid = pre && d && !inSpain && prefs.times !== "local" ? h`, ${hhmm(d, "Europe/Madrid")} Madrid` : "";
  const status = pre && d && !/postp|cancel|suspend/i.test(m.status.detail || "")
    ? h`<span class="when">${day(d)}</span>${madrid}`
    : statusLine(m.status, m.date);
  const goals = show && !pre && m.timeline?.some((e) => e.k === "goal");
  const xg = show && !pre && m.xg && m.shots?.length ? h`<div class="xgline">xG ${m.xg.home.toFixed(2)} - ${m.xg.away.toFixed(2)}</div>` : "";
  const meta = [[m.venue, m.city].filter(Boolean).join(", "), m.ref && `ref ${m.ref}`,
    m.crowd && `${Number(m.crowd).toLocaleString("en-GB")} crowd`, pre && m.tv?.length && `on ${m.tv.join(", ")}`].filter(Boolean).join(" | ");
  return h`<div class="board">
    <div class="comp">${comp(m.league, m.comp)}${m.round ? ", " + m.round : ""}</div>
    <div class="line"><div class="tm h">${teamLink(m.home)}</div>${score}<div class="tm a">${teamLink(m.away)}</div></div>
    <div class="st">${status}</div>
    ${pre && countdown && d ? h`<div class="count" data-countdown="${m.date}">${until(m.date)}</div>` : ""}
    ${xg}
    ${goals ? h`<div class="scorers"><ul class="h">${scorers(m, "home")}</ul><div class="ball" title="goals"></div><ul>${scorers(m, "away")}</ul></div>` : ""}
    ${meta ? h`<div class="meta">${meta}</div>` : ""}
  </div>`;
}

// compact list of fixtures: who, when, which competition
export const matchList = (rows) => h`<ul class="mlist">${rows.map((f) => {
  const d = new Date(f.date);
  return h`<li><a class="vs" href="#/match/${f.league}/${f.id}">${f.home.abbr} v ${f.away.abbr}</a><span class="when">${day(d)}</span>
    <span class="cp">${comp(f.league, f.comp)}</span><span class="hm">${hhmm(d)}</span></li>`;
})}</ul>`;

export const actions = (items, cls = "") =>
  h`<div class="acts ${cls}">${items.filter(Boolean).map(([label, href]) => h`<a class="btn" href="${href}">${label}</a>`)}</div>`;

export function icons(p) {
  const out = [];
  if (p.g) out.push(h`<span class="ico g" title="goals">${p.g > 1 ? p.g : ""}G</span>`);
  if (p.a) out.push(h`<span class="ico" title="assists">${p.a > 1 ? p.a : ""}A</span>`);
  if (p.og) out.push(h`<span class="ico" title="own goal">OG</span>`);
  if (p.y) out.push(h`<span class="card y" title="yellow card"></span>`);
  if (p.rc) out.push(h`<span class="card r" title="red card"></span>`);
  return out;
}

// one line of commentary, with a card or sub marker in front where it helps
const MARK = { yellow: h`<span class="card y"></span>`, red: h`<span class="card r"></span>`, sub: h`<span class="subin"></span>` };
export const feedLine = (x) =>
  h`<li class="${x.k}"><span class="m">${x.m}</span><span class="x">${MARK[x.k] || ""}${x.x}</span></li>`;
