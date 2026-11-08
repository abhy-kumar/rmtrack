// Shared bits: prefs, fetching, time, small html helpers.

const PREFS_KEY = "rm:prefs";
const DEFAULTS = {
  team: "men",
  theme: "auto",      // auto | light | dark | amoled
  spoilers: false,    // hide scores until asked
  alerts: false,      // browser notifications
  beep: true,
  times: "both",      // local | madrid | both
  quiet: false,       // hide fouls/corners in commentary
  tiers: { A: true, B: true, C: true },
  tierOverride: {},   // source name -> tier
  bsky: "",           // extra bluesky handles, comma separated
  who: "",            // extra journalist names, comma separated
};

export const prefs = (() => {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}"); } catch (e) {}
  return { ...DEFAULTS, ...p, tiers: { ...DEFAULTS.tiers, ...(p.tiers || {}) } };
})();

export function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
}

export function store(key, val) {
  try {
    if (val === undefined) return JSON.parse(localStorage.getItem("rm:" + key) || "null");
    localStorage.setItem("rm:" + key, JSON.stringify(val));
  } catch (e) { return null; }
}

export function applyTheme() {
  let t = prefs.theme;
  if (t === "auto") t = matchMedia("(prefers-color-scheme: dark)").matches ? "amoled" : "light";
  document.documentElement.dataset.theme = t;
}
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => prefs.theme === "auto" && applyTheme());

// ---------- fetching ----------

const memo = new Map();
export let lastFetchMs = 0;

export async function api(path, { ttl = 0, timeout = 12000 } = {}) {
  const hit = memo.get(path);
  if (hit && Date.now() - hit.t < ttl * 1000) return hit.v;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  const t0 = performance.now();
  try {
    const r = await fetch(path, { signal: ctl.signal });
    if (!r.ok) throw new Error(`${r.status}`);
    const v = await r.json();
    memo.set(path, { t: Date.now(), v });
    lastFetchMs = Math.round(performance.now() - t0);
    return v;
  } catch (e) {
    if (hit) return hit.v; // old beats nothing
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function staticJson(path) {
  try {
    const r = await fetch(path, { cache: "no-cache" });
    return r.ok ? await r.json() : null;
  } catch (e) { return null; }
}

// ---------- html ----------

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

// tagged template: interpolations are escaped unless wrapped in raw()
export function h(strings, ...vals) {
  let out = "";
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) out += render(vals[i]);
  });
  return { __html: out };
}
function render(v) {
  if (v == null || v === false) return "";
  if (Array.isArray(v)) return v.map(render).join("");
  if (typeof v === "object" && "__html" in v) return v.__html;
  return esc(v);
}
export const raw = (s) => ({ __html: s });
export const html = (v) => render(v);

// ---------- time ----------

export const MADRID = "Europe/Madrid";
export const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
export const inSpain = userTz === MADRID || userTz === "Atlantic/Canary" || userTz === "Africa/Ceuta";

const fmtCache = {};
function fmt(tz, opts) {
  const k = tz + JSON.stringify(opts);
  return (fmtCache[k] ||= new Intl.DateTimeFormat("en-GB", { timeZone: tz, ...opts }));
}

export function hhmm(d, tz = userTz) {
  return fmt(tz, { hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

export function day(d, tz = userTz) {
  return fmt(tz, { weekday: "short", day: "numeric", month: "short" }).format(d);
}

// "Sat 21 Nov, 01:30  (21:00 Madrid)" depending on the time pref
export function when(iso, { dayToo = true } = {}) {
  if (!iso) return "tbc";
  const d = new Date(iso);
  const mine = (dayToo ? day(d) + ", " : "") + hhmm(d);
  if (inSpain || prefs.times === "local") return mine;
  const md = (dayToo && day(d, MADRID) !== day(d) ? day(d, MADRID) + " " : "") + hhmm(d, MADRID);
  if (prefs.times === "madrid") return md + " Madrid";
  return h`${mine} <span class="sub">(${md} Madrid)</span>`;
}

export function until(iso) {
  let s = Math.max(0, Math.round((new Date(iso) - Date.now()) / 1000));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const hh = Math.floor(s / 3600); s -= hh * 3600;
  const mm = Math.floor(s / 60); s -= mm * 60;
  if (d) return `${d}d ${hh}h ${mm}m`;
  if (hh) return `${hh}h ${String(mm).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  return `${mm}m ${String(s).padStart(2, "0")}s`;
}

export function ago(iso) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return day(new Date(iso));
}

// ---------- football bits ----------

export function rtClass(r) {
  if (r == null) return "na";
  if (r >= 9) return "r9";
  if (r >= 8) return "r8";
  if (r >= 7) return "r7";
  if (r >= 6) return "r6";
  return "r5";
}

export function rt(r, extra = "") {
  return h`<span class="rt ${rtClass(r)} ${extra}">${r == null ? "-" : r.toFixed(1)}</span>`;
}

export const COMP_SHORT = {
  "esp.1": "LaLiga", "uefa.champions": "UCL", "esp.copa_del_rey": "Copa", "esp.super_cup": "Supercopa",
  "club.friendly": "Friendly", "esp.w.1": "Liga F", "uefa.wchampions": "UWCL", "fifa.cwc": "Club WC",
  "uefa.super_cup": "UEFA Super Cup", "esp.w.copa_de_la_reina": "Copa Reina", "esp.3": "1a RFEF",
};
export const comp = (slug, fallback) => COMP_SHORT[slug] || fallback || slug;

export function flash(msg, ms = 4000) {
  const el = document.getElementById("flash");
  el.innerHTML = html(msg);
  el.hidden = false;
  clearTimeout(flash.t);
  flash.t = setTimeout(() => (el.hidden = true), ms);
}
