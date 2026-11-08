import { prefs, savePrefs, applyTheme, hhmm, lastFetchMs, userTz } from "./core.js";
import { startWatching, onLive } from "./alerts.js";
import * as v from "./views.js";

const main = document.getElementById("main");
const PAGES = { "100": "#/", "200": "#/fixtures", "300": "#/table", "400": "#/news", "500": "#/squad", "600": "#/ratings", "700": "#/settings" };
let cleanup = null;
let t0 = 0;

async function route(force) {
  if (typeof cleanup === "function") cleanup();
  cleanup = null;
  const parts = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  const [page, a, b, c] = parts;
  const key = "#/" + (page || "");
  document.querySelectorAll("#nav a").forEach((n) => {
    const on = n.getAttribute("href") === key || (page === "match" && n.getAttribute("href") === "#/fixtures") || (page === "player" && n.getAttribute("href") === "#/squad");
    n.classList.toggle("on", on);
  });
  const p = document.querySelector(`#nav a.on`)?.dataset.p || "100";
  document.querySelector(".logo").dataset.page = "P" + p;
  if (force === true) startWatching();
  t0 = performance.now();
  try {
    switch (page) {
      case "match": cleanup = await v.match(main, a, b, c || "live"); break;
      case "fixtures": cleanup = await v.fixtures(main); break;
      case "table": cleanup = await v.tables(main, a); break;
      case "news": cleanup = await v.newsPage(main); break;
      case "squad": cleanup = await v.squad(main); break;
      case "player": cleanup = await v.player(main, a); break;
      case "ratings": cleanup = await v.ratingsPage(main); break;
      case "settings": cleanup = await v.settings(main, (teamChanged) => { drawTeams(); v.fillTicker(); route(teamChanged); }); break;
      default: cleanup = await v.home(main);
    }
  } catch (e) {
    console.error(e);
    main.innerHTML = '<p class="err">Something broke drawing this page. Try a reload.</p>';
  }
  document.getElementById("built").textContent = `page drawn in ${Math.round(performance.now() - t0)} ms, last fetch ${lastFetchMs} ms`;
  const title = document.querySelector(".pagehead")?.textContent?.trim();
  document.title = title ? `${title} | rmtrack` : "rmtrack";
}

function drawTeams() {
  const el = document.getElementById("teamsel");
  const opts = [["men", "men"], ["women", "femenino"], ["castilla", "castilla"]];
  el.innerHTML = opts.map(([k, l]) => `<a href="#" data-team="${k}" class="${prefs.team === k ? "on" : ""}">${l}</a>`).join("");
}

document.getElementById("teamsel").addEventListener("click", (e) => {
  const a = e.target.closest("[data-team]");
  if (!a) return;
  e.preventDefault();
  if (prefs.team === a.dataset.team) return;
  prefs.team = a.dataset.team;
  savePrefs();
  drawTeams();
  v.fillTicker();
  if (/^#\/(match|player)/.test(location.hash)) location.hash = "#/";
  else route(true);
});

// type a three digit page number to jump there
let digits = "";
document.addEventListener("keydown", (e) => {
  if (/input|textarea|select/i.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (!/^\d$/.test(e.key)) return;
  digits = (digits + e.key).slice(-3);
  document.querySelector(".logo").dataset.page = "P" + digits.padEnd(3, "-");
  if (digits.length === 3) {
    if (PAGES[digits]) location.hash = PAGES[digits];
    digits = "";
  }
});

function clock() {
  const now = new Date();
  const s = now.toLocaleTimeString("en-GB", { hour12: false });
  const mad = hhmm(now, "Europe/Madrid");
  document.getElementById("clock").textContent = userTz === "Europe/Madrid" ? s : `${s} | Madrid ${mad}`;
}

applyTheme();
drawTeams();
clock();
setInterval(clock, 1000);
window.addEventListener("hashchange", () => route(false));
onLive(() => v.fillTicker());
route(true);
v.fillTicker();
setInterval(() => v.fillTicker(), 5 * 60 * 1000);

const secure = location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname);
if ("serviceWorker" in navigator && secure) navigator.serviceWorker.register("/sw.js").catch(() => {});
