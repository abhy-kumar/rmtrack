// League-wide numbers: data loading, per-90 metrics and percentiles,
// opponent scouting and workload. Reads the static files the collector
// writes under /data/lg/.
import { staticJson, team, h, day, comp } from "./core.js?v=9";

export const POS = { GK: "Goalkeepers", DEF: "Defenders", DM: "Def. midfield", MID: "Midfielders", AM: "Att. midfield", ATT: "Forwards" };
export const GROUP = { GK: "GK", DEF: "DEF", DM: "MID", MID: "MID", AM: "ATT", ATT: "ATT" }; // peer groups for percentiles

const cache = {};
export async function leagueData(lg) {
  if (cache[lg] && Date.now() - cache[lg].t < 600e3) return cache[lg].v;
  const [p, t] = await Promise.all([staticJson(`/data/lg/${lg}/players.json`), staticJson(`/data/lg/${lg}/teams.json`)]);
  if (!p || !t) return null;
  const teams = Object.fromEntries(t.teams.map((x) => [x.id, x]));
  const v = { players: p.players, teams, updated: p.updated };
  cache[lg] = { t: Date.now(), v };
  return v;
}

export const per90 = (v, mins) => (mins ? (v * 90) / mins : 0);
export const f2 = (v) => (v == null || Number.isNaN(v) ? "-" : v.toFixed(2));
export const f1 = (v) => (v == null || Number.isNaN(v) ? "-" : v.toFixed(1));
export const noData = () => h`<p class="empty">League numbers aren't collected yet. They fill in once the hourly collect job has run on GitHub.</p>`;

// ---------------------------------------------------------------- metrics

// [key, label, fn(player) -> value, higherIsBetter, format]
const METRICS = {
  outfield: [
    ["npxg90", "non-penalty xG per 90", (p) => per90(p.npxg, p.mins), true, f2],
    ["npg90", "non-penalty goals per 90", (p) => per90(p.g - p.pg, p.mins), true, f2],
    ["xa90", "xA per 90", (p) => per90(p.xa, p.mins), true, f2],
    ["a90", "assists per 90", (p) => per90(p.a, p.mins), true, f2],
    ["kp90", "chances created per 90", (p) => per90(p.kp, p.mins), true, f2],
    ["sh90", "shots per 90", (p) => per90(p.sh, p.mins), true, f2],
    ["sotp", "shots on target %", (p) => (p.sh ? (100 * p.sot) / p.sh : null), true, f1],
    ["xgsh", "xG per shot", (p) => (p.sh ? p.xg / p.sh : null), true, f2],
    ["fw90", "fouls won per 90", (p) => per90(p.fw, p.mins), true, f2],
    ["fc90", "fouls given away per 90", (p) => per90(p.fc, p.mins), false, f2],
    ["card90", "cards per 90", (p) => per90(p.yc + 2 * p.rc, p.mins), false, f2],
    ["r", "average rating", (p) => p.r, true, f2],
  ],
  GK: [
    ["sv90", "saves per 90", (p) => per90(p.saves, p.mins), true, f2],
    ["svp", "save %", (p) => (p.saves + p.conc ? (100 * p.saves) / (p.saves + p.conc) : null), true, f1],
    ["ga90", "goals let in per 90", (p) => per90(p.conc, p.mins), false, f2],
    ["r", "average rating", (p) => p.r, true, f2],
  ],
};

function percentile(value, pool, higher) {
  const vals = pool.filter((v) => v != null && !Number.isNaN(v));
  if (value == null || !vals.length) return null;
  const below = vals.filter((v) => (higher ? v < value : v > value)).length;
  const same = vals.filter((v) => v === value).length;
  return Math.round(((below + same / 2) / vals.length) * 100);
}

export function minMins(players) {
  // early in the season the bar is lower, later it's about five full games
  const most = Math.max(0, ...players.map((p) => p.mins));
  return Math.max(180, Math.min(450, Math.round(most * 0.35)));
}

export function profileRows(p, all) {
  const set = p.pos === "GK" ? METRICS.GK : METRICS.outfield;
  const floor = minMins(all);
  const peers = all.filter((q) => GROUP[q.pos] === GROUP[p.pos] && q.mins >= floor);
  return set.map(([k, label, fn, hi, fmt]) => ({ k, label, v: fn(p), fmt, pct: percentile(fn(p), peers.map(fn), hi) }));
}

// ---------------------------------------------------------------- scouting

export async function scouting(m) {
  const myId = team().id;
  const mineSide = m.home.id === myId ? "home" : m.away.id === myId ? "away" : null;
  if (!mineSide) return "";
  const opp = mineSide === "home" ? m.away : m.home;
  const d = await leagueData(m.league);
  if (!d) return h`<h3 class="maph">Scouting ${opp.name}</h3>${noData()}`;
  const us = d.teams[myId], them = d.teams[opp.id];
  if (!them) return h`<h3 class="maph">Scouting ${opp.name}</h3><p class="empty">${opp.name} have no ${comp(m.league)} games in the data yet.</p>`;
  const pm = (t, f) => (t ? t[f] / (t.p || 1) : null);
  const rows = [
    ["goals for", "gf"], ["xG for", "xgf"], ["goals against", "ga"], ["xG against", "xga"],
    ["shots", "sh"], ["shots on target", "sot"], ["shots from the box", "box"], ["shots against", "sha"], ["fouls", "fc"], ["yellow cards", "yc"],
  ];
  const floor = Math.min(270, minMins(d.players));
  const theirs = d.players.filter((p) => p.team === opp.id && p.mins >= floor);
  const threat = [...theirs].filter((p) => p.pos !== "GK").sort((a, b) => per90(b.npxg + b.xa, b.mins) - per90(a.npxg + a.xa, a.mins)).slice(0, 4);
  const rough = [...theirs].sort((a, b) => per90(b.fc + 3 * b.yc, b.mins) - per90(a.fc + 3 * a.yc, a.mins)).slice(0, 3);
  const last = them.log.slice(-5);
  return h`<h3 class="maph">Scouting ${opp.name} <span class="sub">${comp(m.league)}, per match</span></h3>
    <table class="t fx" style="max-width:640px"><colgroup><col><col style="width:110px"><col style="width:110px"></colgroup>
      <tr><th></th><th class="n">${us?.abbr || "us"}</th><th class="n">${them.abbr}</th></tr>
      ${rows.map(([label, f]) => h`<tr><td>${label}</td><td class="n">${f1(pm(us, f))}</td><td class="n">${f1(pm(them, f))}</td></tr>`)}
      <tr><td>possession</td><td class="n">${us?.poss ?? "-"}</td><td class="n">${them.poss ?? "-"}</td></tr>
    </table>
    <h3 class="maph">Their last ${last.length}, by xG</h3>
    <table class="t fx" style="max-width:640px"><colgroup><col style="width:110px"><col><col style="width:70px"><col style="width:120px"></colgroup>
      ${[...last].reverse().map(([mid, date, o, ha, gf, ga, xf, xa]) => h`<tr><td>${date ? day(new Date(date)) : ""}</td><td>${ha === "h" ? "v" : "at"} ${o}</td><td class="n">${gf}-${ga}</td><td class="n">${f2(xf)} - ${f2(xa)} xG</td></tr>`)}
    </table>
    <h3 class="maph">Who to watch</h3>
    ${threat.length ? h`<table class="t fx" style="max-width:640px"><colgroup><col><col style="width:60px"><col style="width:50px"><col style="width:60px"><col style="width:60px"><col style="width:100px"></colgroup>
      <tr><th>player</th><th class="n">min</th><th class="n">G</th><th class="n">npxG</th><th class="n">xA</th><th class="n">npxG+xA/90</th></tr>
      ${threat.map((p) => h`<tr><td><a href="#/pro/${m.league}/${p.id}">${p.name}</a> <span class="sub">${p.pos}</span></td><td class="n">${p.mins}</td><td class="n">${p.g}</td><td class="n">${f2(p.npxg)}</td><td class="n">${f2(p.xa)}</td><td class="n"><b>${f2(per90(p.npxg + p.xa, p.mins))}</b></td></tr>`)}
    </table>` : h`<p class="empty">Not enough minutes logged yet.</p>`}
    ${rough.length ? h`<p class="sub">Most likely to foul or get booked: ${rough.map((p, i) => h`${i ? ", " : ""}${p.name} (${f2(per90(p.fc, p.mins))} fouls, ${p.yc} yellows)`)}.</p>` : ""}`;
}

// ---------------------------------------------------------------- workload

// Minutes-based load from every competitive game this season (season data
// from views.seasonData). A guide, not a medical readout: no training data.
export function workload(season, pid, now = Date.now()) {
  const games = season.matches.filter((m) => m.players[pid]).map((m) => ({ t: new Date(m.date).getTime(), mins: m.players[pid][1] }))
    .filter((g) => g.t <= now).sort((a, b) => a.t - b.t);
  const within = (days) => games.filter((g) => now - g.t <= days * 86400e3);
  const m7 = within(7).reduce((s, g) => s + g.mins, 0);
  const m28 = within(28).reduce((s, g) => s + g.mins, 0);
  // "uncoupled" ratio: this week against the three weeks before it, so a
  // big week doesn't water down its own baseline
  const chronic = (m28 - m7) / 3;
  const acwr = chronic >= 45 ? m7 / chronic : null;
  const g14 = within(14).length;
  const last = games[games.length - 1];
  const rest = last ? Math.floor((now - last.t) / 86400e3) : null;
  const flags = [];
  if (acwr != null && acwr >= 1.5) flags.push("load spike");
  if (acwr == null && m7 >= 150) flags.push("big week after little football");
  if (g14 >= 4) flags.push("congested");
  if (acwr != null && acwr <= 0.5) flags.push("short of minutes");
  if (rest != null && rest <= 2 && m7 >= 150) flags.push("little rest");
  return { m7, m28, acwr, g14, rest, flags, games: games.length };
}

export const WORKLOAD_NOTE = "ACWR is minutes in the last 7 days against the weekly average of the 3 weeks before. Around 0.8 to 1.3 is the comfortable zone in the research; above 1.5 is a jump that has been linked to more soft-tissue injuries, and a big week after a long gap counts as one too. It only sees match minutes, not training, so treat it as a nudge.";

export function workloadRows(season, players) {
  return players.map((p) => ({ p, w: workload(season, p.id) })).filter((r) => r.w.m28 > 0)
    .sort((a, b) => b.w.flags.length - a.w.flags.length || (b.w.acwr ?? 0) - (a.w.acwr ?? 0));
}

// Short form for a sidebar: name, ACWR and the reason it was flagged.
export function workloadList(rows) {
  return h`<ul class="wl">${rows.map(({ p, w }) => h`<li><a href="#/player/${p.id}">${p.name}</a>
    <span class="n">${w.acwr == null ? "" : "ACWR " + w.acwr.toFixed(2)}</span>
    <div class="sub">${w.flags.join(", ")}</div></li>`)}</ul>`;
}

export function workloadTable(rows) {
  if (!rows.length) return h`<p class="empty">No minutes in the last four weeks.</p>`;
  return h`<div class="scroll"><table class="t fx">
    <colgroup><col><col class="w70"><col class="w70"><col class="w90"><col class="w70"><col class="w70"><col class="w200 hide-s"></colgroup>
    <tr><th>player</th><th class="n">7 days</th><th class="n">28 days</th><th class="n">games/14d</th><th class="n">ACWR</th><th class="n">rest</th><th class="hide-s">note</th></tr>
    ${rows.map(({ p, w }) => h`<tr class="${w.flags.length ? "me" : ""}"><td><a href="#/player/${p.id}">${p.name}</a></td><td class="n">${w.m7}</td><td class="n">${w.m28}</td><td class="n">${w.g14}</td>
      <td class="n">${w.acwr == null ? "-" : w.acwr.toFixed(2)}</td><td class="n">${w.rest == null ? "-" : w.rest + "d"}</td><td class="hide-s sub">${w.flags.join(", ")}</td></tr>`)}
  </table></div>`;
}
