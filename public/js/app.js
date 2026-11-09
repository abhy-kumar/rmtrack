// Router, header and global behaviour.
import { prefs, savePrefs, applyTheme, hhmm, userTz, inSpain, MADRID, TEAMS, team } from "./core.js?v=10";
import { startWatching, onLive } from "./alerts.js?v=10";
import { fillTicker } from "./newsfeed.js?v=10";
import { home } from "./pages/home.js?v=10";
import { match } from "./pages/match.js?v=10";
import { fixtures } from "./pages/fixtures.js?v=10";
import { news } from "./pages/news.js?v=10";
import { squad } from "./pages/squad.js?v=10";
import { player } from "./pages/player.js?v=10";
import { stats, profile } from "./pages/stats.js?v=10";
import { about } from "./pages/about.js?v=10";
import { teamPage } from "./pages/team.js?v=10";
import { settings } from "./pages/settings.js?v=10";

const main = document.getElementById("main");
const logo = document.querySelector(".logo");

// page numbers, teletext style; typing three digits jumps there
const PAGES = { 100: "", 200: "fixtures", 300: "news", 400: "squad", 500: "stats", 600: "settings", 700: "about" };
// pages that live under a nav section
const SECTION = { match: "fixtures", player: "squad", pro: "stats", team: "stats", table: "stats", ratings: "about" };
// old addresses that still work
const REDIRECT = {
  table: (lg) => `#/stats/${lg || team().domestic || "esp.1"}/table`,
  ratings: () => "#/about",
};

// how many path parts name the thing on screen; anything after is just a tab
const TABBED = { match: 3, stats: 2, fixtures: 1, team: 2 };

let cleanup = null;
let seq = 0;
let shown = null;

function parse() {
  return location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
}

function render(page, view, a, b, c) {
  switch (page) {
    case "match": return match(view, a, b, c);
    case "fixtures": return fixtures(view, a);
    case "news": return news(view);
    case "squad": return squad(view);
    case "player": return player(view, a);
    case "stats": return stats(view, a, b);
    case "pro": return profile(view, a, b);
    case "team": return teamPage(view, a, b);
    case "about": return about(view);
    case "settings": return settings(view, onTeamChange);
    default: return home(view);
  }
}

async function route(teamChanged = false) {
  if (typeof cleanup === "function") cleanup();
  cleanup = null;
  const parts = parse();
  const [page = "", a, b, c] = parts;
  if (REDIRECT[page]) { location.replace(REDIRECT[page](a)); return; }
  const mine = ++seq;

  const section = SECTION[page] ?? page;
  let number = "100";
  document.querySelectorAll("#nav a").forEach((n) => {
    const on = n.dataset.section === section;
    n.classList.toggle("on", on);
    if (on) { n.setAttribute("aria-current", "page"); number = n.dataset.p; } else n.removeAttribute("aria-current");
  });
  if (section === "about") number = "700";
  logo.dataset.page = "P" + number;
  if (teamChanged) startWatching();

  // A fresh container per visit, so a slow page that finishes after the
  // reader has moved on writes into a detached node, not over the new page.
  // Switching tabs on the same match or table keeps the old view and the
  // scroll position until the new tab is ready.
  const key = parts.slice(0, TABBED[page] ?? parts.length).join("/");
  const sameThing = key === shown && main.firstElementChild;
  const keepY = window.scrollY;
  let view = main.firstElementChild;
  if (!sameThing) {
    view = document.createElement("div");
    main.replaceChildren(view);
    window.scrollTo(0, 0);
  }
  shown = key;

  const t0 = performance.now();
  let done = null;
  try {
    done = await render(page, view, a, b, c);
  } catch (e) {
    console.error(e);
    view.innerHTML = '<p class="err">Something broke drawing this page. Try a reload.</p>';
  }
  if (mine !== seq) {
    if (typeof done === "function") done();
    return;
  }
  cleanup = done;
  if (sameThing) window.scrollTo(0, keepY);
  document.getElementById("built").textContent = `drawn in ${Math.round(performance.now() - t0)} ms`;
  const title = view.querySelector(".pagehead")?.firstChild?.textContent?.trim();
  document.title = title ? `${title} | rmtrack` : "rmtrack";
}

function onTeamChange() {
  drawTeams();
  fillTicker();
  if (/^#\/(match|player|pro|team)/.test(location.hash)) location.hash = "#/";
  else route(true);
}

function drawTeams() {
  document.getElementById("teamsel").innerHTML = Object.entries(TEAMS)
    .map(([k, t]) => `<button type="button" data-team="${k}" class="${prefs.team === k ? "on" : ""}" ${prefs.team === k ? 'aria-pressed="true"' : 'aria-pressed="false"'}>${t.label}</button>`)
    .join("");
}

document.getElementById("teamsel").addEventListener("click", (e) => {
  const b = e.target.closest("[data-team]");
  if (!b || prefs.team === b.dataset.team) return;
  prefs.team = b.dataset.team;
  savePrefs();
  onTeamChange();
});

document.querySelector("[data-skip]")?.addEventListener("click", (e) => {
  e.preventDefault();
  main.focus();
});

let digits = "";
document.addEventListener("keydown", (e) => {
  if (/input|textarea|select/i.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey || !/^\d$/.test(e.key)) return;
  digits = (digits + e.key).slice(-3);
  logo.dataset.page = "P" + digits.padEnd(3, "-");
  if (digits.length === 3) {
    if (digits in PAGES) location.hash = "#/" + PAGES[digits];
    digits = "";
  }
});

function clock() {
  const now = new Date();
  const s = now.toLocaleTimeString("en-GB", { hour12: false, timeZone: userTz });
  const madrid = now.toLocaleTimeString("en-GB", { hour12: false, timeZone: MADRID });
  const text = inSpain || prefs.times === "local" ? s : prefs.times === "madrid" ? `Madrid ${madrid}` : `${s} | Madrid ${hhmm(now, MADRID)}`;
  document.getElementById("clock").textContent = text;
}

applyTheme();
drawTeams();
clock();
setInterval(clock, 1000);
window.addEventListener("hashchange", () => route());
onLive(() => fillTicker());
route(true);
fillTicker();
setInterval(fillTicker, 5 * 60 * 1000);

const secure = location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname);
if ("serviceWorker" in navigator && secure) navigator.serviceWorker.register("/sw.js").catch(() => {});
