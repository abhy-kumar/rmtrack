// Background watcher: spots kick-off, goals, red cards, HT and FT for the
// selected team and shouts about them (notification + beep + flash line).
import { api, prefs, flash, esc } from "./core.js";

let timer = null;
let seen = {};          // match id -> { state, goals, reds, period }
let audio = null;
const listeners = new Set();

export const live = { matches: [], details: {} };
export const onLive = (fn) => listeners.add(fn);

document.addEventListener("click", () => {
  if (!audio && window.AudioContext) {
    try { audio = new AudioContext(); } catch (e) {}
  }
}, { once: true });

export function beep(times = 1) {
  if (!prefs.beep || !audio) return;
  let t = audio.currentTime;
  for (let i = 0; i < times; i++) {
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = "square";
    o.frequency.value = i % 2 ? 660 : 880;
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + 0.15);
    t += 0.2;
  }
}

async function notify(title, body, tag) {
  flash(`<b>${esc(title)}</b>: ${esc(body)}`, 9000);
  if (!prefs.alerts || !("Notification" in window) || Notification.permission !== "granted") return;
  const opts = { body, tag, icon: "/img/icon-192.png", badge: "/img/icon-192.png", renotify: true };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return reg.showNotification(title, opts);
    new Notification(title, opts);
  } catch (e) {}
}

function score(m) {
  return `${m.home.abbr} ${m.home.score ?? 0}-${m.away.score ?? 0} ${m.away.abbr}`;
}

function diff(m) {
  const prev = seen[m.id];
  const goals = m.timeline.filter((e) => e.k === "goal");
  const reds = m.timeline.filter((e) => e.k === "red");
  const now = { state: m.status.state, goals: goals.length, reds: reds.length, detail: m.status.detail };
  seen[m.id] = now;
  if (!prev) return;
  if (prev.state === "pre" && now.state === "in") { notify("Kick-off", `${m.home.name} v ${m.away.name}`, "ko" + m.id); beep(1); }
  if (now.goals > prev.goals) {
    const g = goals[goals.length - 1];
    notify(prefs.spoilers ? "Goal" : `GOAL ${g.m}`, prefs.spoilers ? `${m.home.name} v ${m.away.name}` : `${score(m)}. ${g.x}`, "g" + m.id + now.goals);
    beep(4);
  }
  if (now.reds > prev.reds && !prefs.spoilers) {
    const r = reds[reds.length - 1];
    notify(`Red card ${r.m}`, r.x, "r" + m.id + now.reds);
    beep(2);
  }
  if (prev.detail !== "HT" && now.detail === "HT" && !prefs.spoilers) notify("Half-time", score(m), "ht" + m.id);
  if (prev.state === "in" && now.state === "post") { notify("Full-time", prefs.spoilers ? `${m.home.name} v ${m.away.name}` : score(m), "ft" + m.id); beep(2); }
}

async function tick() {
  try {
    const ov = await api(`/api/overview?team=${prefs.team}`, { ttl: 20 });
    // anything starting within 10 minutes counts as live for polling purposes
    const soon = (ov.next || []).filter((f) => new Date(f.date) - Date.now() < 10 * 60 * 1000);
    const watch = [...(ov.live || []), ...soon];
    live.matches = ov.live || [];
    for (const f of watch) {
      try {
        const m = await api(`/api/match/${f.league}/${f.id}`, { ttl: 10 });
        live.details[m.id] = m;
        diff(m);
      } catch (e) {}
    }
    listeners.forEach((fn) => fn(live));
    schedule(watch.length ? 15000 : 60000);
  } catch (e) {
    schedule(60000);
  }
}

function schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(tick, document.hidden ? Math.max(ms, 30000) : ms);
}

export function startWatching() {
  seen = {};
  clearTimeout(timer);
  tick();
}

document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
