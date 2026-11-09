// Small building blocks shared by every page.
import { prefs, team, h, html, raw, when, hhmm, comp } from "./core.js?v=8";

export const put = (el, v) => { el.innerHTML = html(v); };

export const fail = (what) =>
  h`<p class="err">Couldn't load ${what} just now. It retries on its own, or <button type="button" class="linklike" data-reload>reload now</button>.</p>`;

export const loading = (what = "loading") => h`<p class="loading">${what}...</p>`;

export const box = (title, body, aside = "") =>
  h`<section class="box"><h2>${title}<small>${aside}</small></h2><div class="in">${body}</div></section>`;

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

// ---------------------------------------------------------------- results

export const isMine = (side) => side?.id === team().id;

export function result(f) {
  const me = isMine(f.home) ? f.home : f.away;
  const them = me === f.home ? f.away : f.home;
  const a = me.score ?? 0, b = them.score ?? 0;
  return a > b ? "W" : a < b ? "L" : "D";
}

export function statusLine(st, date) {
  if (st.state === "in") return h`<span class="live">LIVE</span> ${st.clock || st.detail}`;
  if (st.state === "post") return st.detail || "FT";
  if (/postponed|canceled|cancelled|suspended/i.test(st.detail)) return st.detail;
  return when(date);
}

export const resultBadge = (r) => h`<span class="form"><span class="${r}">${r}</span></span>`;

export function formStrip(form) {
  if (!form?.length) return h`<span class="sub">no games yet</span>`;
  const shown = prefs.spoilers ? form.slice(1) : form;
  return h`<span class="form">${[...shown].reverse().map((f) =>
    h`<a class="${f.res}" href="#/match/${f.league}/${f.id}" title="${f.opp} ${f.score}">${f.res}</a>`)}</span>`;
}

// the scoreboard at the top of match cards and the match page
export function board(m, { link = false } = {}) {
  const show = revealed(m.id) || m.status.state === "pre";
  const goals = (m.timeline || []).filter((e) => e.k === "goal");
  const who = (side) => goals.filter((g) => g.s === side).map((g) => {
    const n = (g.x.match(/(?:^|\. )([^.(]+?) \(/) || [])[1] || "";
    return `${n.trim()} ${g.m}`;
  }).join(", ");
  const score = m.status.state === "pre"
    ? h`<div class="sc pre">${hhmm(new Date(m.date))}</div>`
    : show ? h`<div class="sc">${m.home.score ?? 0}-${m.away.score ?? 0}</div>` : h`<div class="sc">${veil(m.id)}</div>`;
  const xg = show && m.xg && m.status.state !== "pre" && m.shots?.length
    ? h`<div class="xgline">xG ${m.xg.home.toFixed(2)} - ${m.xg.away.toFixed(2)}</div>` : "";
  const place = [m.venue, m.city].filter(Boolean).join(", ");
  const inner = h`
    <div class="comp">${comp(m.league, m.comp)}${m.round ? ", " + m.round : ""}</div>
    <div class="line"><div class="tm h">${m.home.name}</div>${score}<div class="tm a">${m.away.name}</div></div>
    <div class="st">${statusLine(m.status, m.date)}</div>
    ${xg}
    ${show && goals.length ? h`<div class="scorers"><div>${who("home")}</div><div>${who("away")}</div></div>` : ""}
    <div class="meta">${place}${m.ref ? h`, ref ${m.ref}` : ""}${m.crowd ? h`, ${Number(m.crowd).toLocaleString("en-GB")} crowd` : ""}</div>`;
  return link
    ? h`<div class="board"><a class="cover" href="#/match/${m.league}/${m.id}">${inner}</a></div>`
    : h`<div class="board">${inner}</div>`;
}

export const icons = (p) => h`${[...Array(p.g || 0)].map(() => h`<span class="ico">G</span>`)}${[...Array(p.a || 0)].map(() => h`<span class="ico">A</span>`)}${p.y ? h`<span class="ico y">Y</span>` : ""}${p.rc ? h`<span class="ico r">R</span>` : ""}${p.og ? h`<span class="ico">OG</span>` : ""}`;
