// League-wide numbers: data loading, per-90 metrics and percentiles,
// opponent scouting and workload. Reads the static files the collector
// writes under /data/lg/.
import { staticJson, team, h, day, comp } from "./core.js?v=12";

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
  // cup games have no league files of their own, so scout from the domestic league
  const lg = team().leagues.includes(m.league) ? m.league : team().domestic;
  const d = lg ? await leagueData(lg) : null;
  if (!d) return h`<h3 class="maph">Scouting ${opp.name}</h3>${noData()}`;
  const us = d.teams[myId], them = d.teams[opp.id];
  if (!them) return h`<h3 class="maph">Scouting ${opp.name}</h3><p class="empty">${opp.name} have no ${comp(lg)} games in the data yet.</p>`;
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
  return h`<h3 class="maph">Scouting ${opp.name} <span class="sub">${comp(lg)}, per match</span></h3>
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
      ${threat.map((p) => h`<tr><td><a href="#/pro/${lg}/${p.id}">${p.name}</a> <span class="sub">${p.pos}</span></td><td class="n">${p.mins}</td><td class="n">${p.g}</td><td class="n">${f2(p.npxg)}</td><td class="n">${f2(p.xa)}</td><td class="n"><b>${f2(per90(p.npxg + p.xa, p.mins))}</b></td></tr>`)}
    </table>` : h`<p class="empty">Not enough minutes logged yet.</p>`}
    ${rough.length ? h`<p class="sub">Most likely to foul or get booked: ${rough.map((p, i) => h`${i ? ", " : ""}${p.name} (${f2(per90(p.fc, p.mins))} fouls, ${p.yc} yellows)`)}.</p>` : ""}`;
}

// ---------------------------------------------------------------- workload

// How hard a position runs, relative to a forward. Midfielders and full-backs
// cover the most ground in the match-tracking studies, centre-backs less,
// goalkeepers a fraction. It turns minutes into a rough load.
const ROLE = [
  [/^G/, "goalkeeper", 0.3],
  [/^(CD|CB|SW)/, "centre-back", 0.9],
  [/^(LB|RB|LWB|RWB|WB)/, "full-back", 1.05],
  [/^(DM|CM|AM)/, "midfield", 1.1],
  [/^(LM|RM|LW|RW)/, "wide", 1.05],
  [/^(F|CF|ST|S)/, "forward", 0.95],
];
const ROLE_BY_GROUP = { G: ROLE[0], D: ["", "defender", 0.95], M: ["", "midfield", 1.1], F: ["", "forward", 0.95] };

function roleOf(espnPos, squadPos) {
  const r = ROLE.find(([re]) => re.test(espnPos || "")) || ROLE_BY_GROUP[(squadPos || "")[0]] || ["", "", 1];
  return { role: r[1], factor: r[2] };
}

const DAY = 86400e3;
const clamp = (v) => Math.max(0, Math.min(1, v));

// Squad-wide involvements per 90 for each role, so one player can be compared
// with his own kind. Only rows that carry the count (archive version 2) count.
function involvementNorms(season, roleById) {
  const per = {};
  for (const m of season.matches) {
    for (const [pid, row] of Object.entries(m.players)) {
      if (row.length < 8 || row[1] < 30) continue;
      const r = roleById(pid);
      (per[r] ||= { acts: 0, mins: 0 }).acts += row[7];
      per[r].mins += row[1];
    }
  }
  return Object.fromEntries(Object.entries(per).map(([r, v]) => [r, v.mins ? (v.acts / v.mins) * 90 : null]));
}

/*
  Match load for one player, all competitions, from match data only.

  load per game = minutes x role factor x involvement factor
  The score out of 100 adds up four things a fitness coach would look at:
    volume     45  load over the last 28 days, on a curve that flattens out
                   (seven full games for a midfielder gets about 40)
    turnaround 25  games of 45+ minutes with three days or less since his last
    next game  20  another game within three days of a long shift
    spike      15  last week well above the three weeks before (ratio over 1.3),
                   only when that week was real minutes
  Turnarounds and the next game are scaled down for roles that run less.
*/
export function workload(season, pid, { now = Date.now(), next = null, squadPos = "", norms = null } = {}) {
  const pos = season.names?.[pid]?.[1] || "";
  const { role, factor } = roleOf(pos, squadPos);
  const games = season.matches.filter((m) => m.players[pid]).map((m) => {
    const row = m.players[pid];
    return { t: new Date(m.date).getTime(), mins: row[1], st: row[6], acts: row.length >= 8 ? row[7] : null };
  }).filter((g) => g.t <= now).sort((a, b) => a.t - b.t);

  // involvement: his actions per 90 against the squad's for his role, kept to +-12%
  let inv = 1;
  const counted = games.filter((g) => g.acts != null && g.mins >= 30);
  const minsC = counted.reduce((t, g) => t + g.mins, 0);
  const norm = norms?.[role];
  if (norm && minsC >= 270) inv = 0.88 + 0.24 * clamp(((counted.reduce((t, g) => t + g.acts, 0) / minsC) * 90 / norm - 0.75) / 0.6);

  const loadOf = (g) => g.mins * factor * inv;
  const since = (days) => games.filter((g) => now - g.t <= days * DAY);
  const g28 = since(28), g7 = since(7);
  const L28 = g28.reduce((t, g) => t + loadOf(g), 0);
  const L7 = g7.reduce((t, g) => t + loadOf(g), 0);
  const m28 = g28.reduce((t, g) => t + g.mins, 0);
  const m7 = g7.reduce((t, g) => t + g.mins, 0);
  const starts28 = g28.filter((g) => g.st).length;

  // the team's games in the same window, for "share of the minutes going"
  const teamGames28 = season.matches.filter((m) => { const t = new Date(m.date).getTime(); return t <= now && now - t <= 28 * DAY; }).length;
  const share = teamGames28 ? m28 / (teamGames28 * 90) : 0;

  // quick turnarounds: a real shift (45+) within 3.5 days of his previous game
  let turnarounds = 0;
  for (let i = 1; i < games.length; i++) {
    const g = games[i];
    if (now - g.t <= 21 * DAY && g.mins >= 45 && g.t - games[i - 1].t <= 3.5 * DAY) turnarounds++;
  }

  const chronic = (L28 - L7) / 3;
  const ratio = chronic >= 60 ? L7 / chronic : null;
  const last = games[games.length - 1];
  const rest = last ? (now - last.t) / DAY : null;
  const nextIn = next ? (new Date(next).getTime() - now) / DAY : null;

  // recovery matters less the less a role runs, so a keeper's quick turnarounds count for little
  const legs = Math.min(1, factor / 0.95);
  const parts = {
    volume: 45 * (1 - Math.exp(-L28 / 450)),
    turnaround: 25 * clamp(turnarounds / 3) * legs,
    next: nextIn != null && nextIn >= 0 && nextIn <= 3.2 && last && rest <= 4 && last.mins >= 60 ? 20 * (last.mins >= 85 ? 1 : 0.6) * legs : 0,
    spike: ratio != null && m7 >= 150 ? 15 * clamp((ratio - 1.3) / 0.5) : 0,
  };
  const score = Math.min(100, Math.round(Object.values(parts).reduce((a, b) => a + b, 0)));
  const band = score >= 65 ? "high" : score >= 45 ? "watch" : "fine";

  const why = [];
  if (parts.volume >= 28) why.push(`${starts28} starts, ${m28} min in 4 weeks (${Math.round(share * 100)}% of what was going)`);
  if (turnarounds) why.push(`${turnarounds} ${turnarounds === 1 ? "game" : "games"} on 3 days' rest or less`);
  if (parts.next) why.push(`plays again in ${Math.max(1, Math.round(nextIn))} ${Math.round(nextIn) === 1 ? "day" : "days"} after ${last.mins} min`);
  if (parts.spike) why.push("far more this week than the three before");
  if (inv >= 1.06 && parts.volume >= 28) why.push("very involved for his role");
  if (!why.length && m28) why.push(`${m28} min in 4 weeks`);

  return { score, band, parts, why, role, factor, inv, m7, m28, L28: Math.round(L28), starts28, share, turnarounds,
    ratio, rest, nextIn, games: games.length };
}

export const WORKLOAD_NOTE = "Load is minutes weighted by how much the role runs (midfielders and full-backs most, keepers least) and by how involved the player is compared with others in his role. The score out of 100 adds four things: volume over the last four weeks, games played on three days' rest or less, a long shift with the next game coming within three days, and a jump in the last week against the three before. Over 65 is high, 45 to 65 is worth watching. It counts competitive matches for the club only, so training, friendlies and international games are invisible to it.";

export function workloadRows(season, players, next) {
  const squadPos = Object.fromEntries(players.map((p) => [p.id, p.pos]));
  const roleById = (pid) => roleOf(season.names?.[pid]?.[1], squadPos[pid]).role;
  const norms = involvementNorms(season, roleById);
  return players.map((p) => ({ p, w: workload(season, p.id, { next, squadPos: p.pos, norms }) }))
    .filter((r) => r.w.m28 > 0)
    .sort((a, b) => b.w.score - a.w.score);
}

const meter = (w) => h`<span class="meter ${w.band}" title="${w.score} out of 100"><i style="width:${w.score}%"></i></span>`;

// Short form for a sidebar: name, score and why.
export function workloadList(rows) {
  return h`<ul class="wl">${rows.map(({ p, w }) => h`<li><a href="#/player/${p.id}">${p.name}</a>
    <span class="n"><b>${w.score}</b> <span class="sub">${w.band}</span></span>
    ${meter(w)}
    <div class="sub">${w.why.slice(0, 2).join(", ")}</div></li>`)}</ul>`;
}

export function workloadTable(rows) {
  if (!rows.length) return h`<p class="empty">No minutes in the last four weeks.</p>`;
  return h`<div class="scroll"><table class="t fx">
    <colgroup><col><col class="w90 hide-s"><col class="w70"><col class="w70"><col class="w90"><col class="w70"><col class="w90"></colgroup>
    <tr><th>player</th><th class="hide-s">role</th><th class="n">min 28d</th><th class="n">starts</th><th class="n" title="games on 3 days' rest or less, last 3 weeks">quick turns</th><th class="n">rest</th><th class="n">load</th></tr>
    ${rows.map(({ p, w }) => h`<tr class="${w.band === "high" ? "me" : ""}"><td><a href="#/player/${p.id}">${p.name}</a></td>
      <td class="hide-s sub">${w.role}</td><td class="n">${w.m28}</td><td class="n">${w.starts28}</td><td class="n">${w.turnarounds}</td>
      <td class="n">${w.rest == null ? "-" : Math.floor(w.rest) + "d"}</td><td class="n"><b>${w.score}</b> <span class="sub">${w.band}</span></td></tr>`)}
  </table></div>`;
}

// one player, for his own page
export function playerWorkload(season, pid, next) {
  const norms = involvementNorms(season, (id) => roleOf(season.names?.[id]?.[1], "").role);
  return workload(season, pid, { next, norms });
}
