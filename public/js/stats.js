// League-wide numbers: explorer, player profiles, opponent scouting, workload.
// Everything here reads the static files the collector writes under /data/lg/.
import { staticJson, prefs, h, html, raw, esc, day, rt, comp } from "./core.js?v=6";

export const LEAGUES = {
  men: ["esp.1", "uefa.champions"],
  women: ["esp.w.1", "uefa.wchampions"],
  castilla: [],
};
const POS = { GK: "Goalkeepers", DEF: "Defenders", DM: "Def. midfield", MID: "Midfielders", AM: "Att. midfield", ATT: "Forwards" };
const GROUP = { GK: "GK", DEF: "DEF", DM: "MID", MID: "MID", AM: "ATT", ATT: "ATT" }; // peer groups for percentiles

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

const put = (el, v) => { el.innerHTML = html(v); };
const box = (title, body, aside = "") => h`<div class="box"><h2>${title}<small>${aside}</small></h2><div class="in">${body}</div></div>`;
const per90 = (v, mins) => (mins ? (v * 90) / mins : 0);
const f2 = (v) => (v == null || Number.isNaN(v) ? "-" : v.toFixed(2));
const f1 = (v) => (v == null || Number.isNaN(v) ? "-" : v.toFixed(1));
const noData = () => h`<p class="empty">The league numbers aren't collected yet. They fill in after the hourly job runs on GitHub, or run collect.bat once on your PC.</p>`;

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

function minMins(players) {
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

function bars(rows) {
  return h`<table class="t fx pct"><colgroup><col><col style="width:80px"><col style="width:45%"></colgroup>
    ${rows.map((r) => h`<tr><td>${r.label}</td><td class="n">${r.fmt(r.v)}</td>
      <td>${r.pct == null ? h`<span class="sub">n/a</span>` : h`<div class="third"><i style="width:${r.pct}%"></i><span>${r.pct}</span></div>`}</td></tr>`)}
  </table>`;
}

// ---------------------------------------------------------------- explorer

export async function explorer(el, lg, view = "teams") {
  const lgs = LEAGUES[prefs.team] || [];
  if (!lgs.length) { put(el, h`<h1 class="pagehead">Stats</h1><p class="empty">There's no league data for this team yet.</p>`); return; }
  lg = lgs.includes(lg) ? lg : lgs[0];
  put(el, h`<h1 class="pagehead">Stats <small>every team and player</small></h1>
    <div class="tabs">${lgs.map((l) => h`<a href="#/stats/${l}/${view}" class="${l === lg ? "on" : ""}">${comp(l)}</a>`)}</div>
    <div class="tabbody">
      <div class="row"><a class="btn ${view === "teams" ? "on" : ""}" href="#/stats/${lg}/teams">teams</a><a class="btn ${view === "players" ? "on" : ""}" href="#/stats/${lg}/players">players</a></div>
      <div id="sx"><p class="loading">loading...</p></div></div>`);
  const sx = el.querySelector("#sx");
  const d = await leagueData(lg);
  if (!d) { put(sx, noData()); return; }
  if (view === "players") return playersTable(sx, d, lg);
  return teamsTable(sx, d);
}

function teamsTable(el, d) {
  const rows = Object.values(d.teams).map((t) => ({ ...t, xgd: t.xgf - t.xga, npxgd: (t.npxgf - t.npxga) / (t.p || 1) }))
    .sort((a, b) => b.npxgd - a.npxgd);
  const mine = { men: "86", women: "21128", castilla: "7000" }[prefs.team];
  put(el, h`<div class="scroll"><table class="t fx">
    <colgroup><col style="width:34px"><col><col style="width:44px"><col style="width:80px"><col style="width:56px"><col style="width:56px"><col style="width:56px"><col style="width:56px"><col style="width:76px"><col style="width:66px"><col style="width:66px"><col style="width:60px" class="hide-s"><col style="width:66px" class="hide-s"></colgroup>
    <tr><th>#</th><th>team</th><th class="n">P</th><th class="n">W-D-L</th><th class="n">GF</th><th class="n">xGF</th><th class="n">GA</th><th class="n">xGA</th><th class="n" title="non-penalty xG difference per match">npxGD/m</th><th class="n">sh/m</th><th class="n">sh ag/m</th><th class="n hide-s">poss</th><th class="n hide-s">fouls/m</th></tr>
    ${rows.map((t, i) => h`<tr class="${t.id === mine ? "me" : ""}"><td>${i + 1}</td><td>${t.name}</td><td class="n">${t.p}</td><td class="n">${t.w}-${t.d}-${t.l}</td>
      <td class="n">${t.gf}</td><td class="n">${f1(t.xgf)}</td><td class="n">${t.ga}</td><td class="n">${f1(t.xga)}</td>
      <td class="n"><b>${t.npxgd > 0 ? "+" : ""}${f2(t.npxgd)}</b></td><td class="n">${f1(t.sh / t.p)}</td><td class="n">${f1(t.sha / t.p)}</td>
      <td class="n hide-s">${t.poss ?? "-"}</td><td class="n hide-s">${f1(t.fc / t.p)}</td></tr>`)}
  </table></div>
  <p class="sub">Sorted by non-penalty xG difference per match, the best single read on how good a side has really been. Goals minus xG shows who's finishing (or keeping) above or below the chances.</p>`);
}

function playersTable(el, d, lg) {
  const floor = minMins(d.players);
  const state = playersTable.state ||= { pos: "", sort: "npxa90", min: floor };
  const sorts = {
    npxa90: ["npxG + xA per 90", (p) => per90(p.npxg + p.xa, p.mins)],
    npxg90: ["npxG per 90", (p) => per90(p.npxg, p.mins)],
    xa90: ["xA per 90", (p) => per90(p.xa, p.mins)],
    g: ["goals", (p) => p.g],
    gmx: ["goals minus xG", (p) => p.g - p.xg],
    kp90: ["chances created per 90", (p) => per90(p.kp, p.mins)],
    r: ["average rating", (p) => p.r ?? 0],
    mins: ["minutes", (p) => p.mins],
  };
  const draw = () => {
    const fn = sorts[state.sort][1];
    const list = d.players.filter((p) => p.mins >= state.min && (!state.pos || GROUP[p.pos] === state.pos))
      .sort((a, b) => fn(b) - fn(a)).slice(0, 60);
    el.querySelector("#pl").innerHTML = html(h`<div class="scroll"><table class="t fx">
      <colgroup><col style="width:34px"><col><col style="width:56px"><col style="width:52px" class="hide-s"><col style="width:56px"><col style="width:46px"><col style="width:60px"><col style="width:46px"><col style="width:56px"><col style="width:82px"><col style="width:64px"></colgroup>
      <tr><th>#</th><th>player</th><th>team</th><th class="hide-s">pos</th><th class="n">min</th><th class="n">G</th><th class="n">npxG</th><th class="n">A</th><th class="n">xA</th><th class="n">${state.sort === "r" || state.sort === "mins" || state.sort === "g" ? "npxG+xA/90" : sorts[state.sort][0].replace(" per 90", "/90")}</th><th class="c">rating</th></tr>
      ${list.map((p, i) => h`<tr><td>${i + 1}</td><td><a href="#/pro/${lg}/${p.id}">${p.name}</a></td><td class="sub">${d.teams[p.team]?.abbr || ""}</td><td class="hide-s sub">${p.pos}</td>
        <td class="n">${p.mins}</td><td class="n">${p.g}</td><td class="n">${f2(p.npxg)}</td><td class="n">${p.a}</td><td class="n">${f2(p.xa)}</td>
        <td class="n"><b>${f2(["r", "mins", "g"].includes(state.sort) ? per90(p.npxg + p.xa, p.mins) : fn(p))}</b></td><td class="c">${p.r != null ? rt(p.r) : ""}</td></tr>`)}
    </table></div>`);
  };
  put(el, h`<div class="row">
      <select id="ppos"><option value="">all positions</option>${["GK", "DEF", "MID", "ATT"].map((g) => h`<option value="${g}" ${state.pos === g ? "selected" : ""}>${{ GK: "keepers", DEF: "defenders", MID: "midfielders", ATT: "forwards and No.10s" }[g]}</option>`)}</select>
      <select id="psort">${Object.entries(sorts).map(([k, [label]]) => h`<option value="${k}" ${state.sort === k ? "selected" : ""}>sort: ${label}</option>`)}</select>
      <label>min. minutes <input type="text" id="pmin" value="${state.min}" size="4"></label>
    </div><div id="pl"></div>
    <p class="sub">npxG is xG without penalties. xA is the xG of the shots a player set up. Per-90 numbers need a decent sample, so players under the minutes floor are left out.</p>`);
  el.querySelector("#ppos").addEventListener("change", (e) => { state.pos = e.target.value; draw(); });
  el.querySelector("#psort").addEventListener("change", (e) => { state.sort = e.target.value; draw(); });
  el.querySelector("#pmin").addEventListener("change", (e) => { state.min = Math.max(0, parseInt(e.target.value, 10) || 0); draw(); });
  draw();
}

// ---------------------------------------------------------------- profile

export async function profile(el, lg, pid) {
  put(el, h`<p class="loading">loading...</p>`);
  const d = await leagueData(lg);
  const p = d?.players.find((x) => x.id === pid);
  if (!p) { put(el, d ? h`<p class="empty">No ${comp(lg)} minutes for this player yet.</p>` : noData()); return; }
  put(el, h`<h1 class="pagehead">${p.name} <small>${d.teams[p.team]?.name || ""}, ${POS[p.pos] || p.pos}, ${comp(lg)}</small></h1>
    <div class="cols"><div>
      ${box("against his peers", h`${bars(profileRows(p, d.players))}
        <p class="sub">Percentile against ${(POS[GROUP[p.pos]] || "players").toLowerCase()} in ${comp(lg)} with ${minMins(d.players)}+ minutes. 50 is the middle of the pack; for fouls, cards and goals let in a high number means fewer.</p>`)}
      ${matchLog(p, lg)}
    </div><div>
      ${box("season", h`<dl class="kv">
        <dt>apps</dt><dd>${p.apps} (${p.starts} starts)</dd><dt>minutes</dt><dd>${p.mins}</dd>
        <dt>goals</dt><dd>${p.g}${p.pg ? ` (${p.pg} pen)` : ""}</dd><dt>xG</dt><dd>${f2(p.xg)} <span class="sub">npxG ${f2(p.npxg)}</span></dd>
        <dt>assists</dt><dd>${p.a}</dd><dt>xA</dt><dd>${f2(p.xa)}</dd>
        <dt>shots</dt><dd>${p.sh} (${p.sot} on target)</dd><dt>chances created</dt><dd>${p.kp}</dd>
        <dt>cards</dt><dd>${p.yc} Y, ${p.rc} R</dd><dt>avg rating</dt><dd>${p.r != null ? rt(p.r) : "-"}</dd></dl>`)}
      ${box("reading it", finishing(p))}
    </div></div>`);
}

function finishing(p) {
  const notes = [];
  const npg = p.g - p.pg, diff = npg - p.npxg;
  if (p.sh >= 8) {
    if (diff >= 2) notes.push(`Scoring well above his chances (${npg} non-penalty goals from ${f2(p.npxg)} npxG). Good finishers do that a bit; this much usually cools off.`);
    else if (diff <= -2) notes.push(`Underperforming his chances (${npg} from ${f2(p.npxg)} npxG). If the shots keep coming the goals tend to follow.`);
    else notes.push(`Finishing roughly in line with his chances (${npg} from ${f2(p.npxg)} npxG).`);
    const q = p.xg / p.sh;
    notes.push(q >= 0.15 ? `Gets into good spots: ${f2(q)} xG a shot.` : q <= 0.07 ? `Takes a lot from range: ${f2(q)} xG a shot.` : `Average shot quality, ${f2(q)} xG a shot.`);
  }
  if (p.kp >= 5 && p.a - p.xa <= -1.5) notes.push(`Teammates have left assists on the table: ${p.a} from ${f2(p.xa)} xA.`);
  if (p.mins >= 450 && per90(p.fc, p.mins) >= 2) notes.push(`Gives away ${f2(per90(p.fc, p.mins))} fouls a game. Booking risk.`);
  return notes.length ? h`${notes.map((n) => h`<p>${n}</p>`)}` : h`<p class="sub">Not enough shots yet to say much.</p>`;
}

function matchLog(p, lg) {
  return h`<div class="box flat"><h2>match by match</h2><div class="in scroll"><table class="t fx">
    <colgroup><col style="width:110px"><col><col style="width:50px"><col style="width:40px"><col style="width:40px"><col style="width:60px"><col style="width:60px"><col style="width:70px"></colgroup>
    <tr><th>date</th><th>v</th><th class="n">min</th><th class="n">G</th><th class="n">A</th><th class="n">xG</th><th class="n">xA</th><th class="c">rating</th></tr>
    ${[...p.log].reverse().map(([mid, date, opp, mins, g, a, x, xa, r]) => h`<tr><td>${date ? day(new Date(date)) : ""}</td><td><a href="#/match/${lg}/${mid}">${opp}</a></td>
      <td class="n">${mins}</td><td class="n">${g || ""}</td><td class="n">${a || ""}</td><td class="n">${f2(x)}</td><td class="n">${f2(xa)}</td><td class="c">${rt(r)}</td></tr>`)}
  </table></div></div>`;
}

// ---------------------------------------------------------------- scouting

export async function scouting(m) {
  const myId = { men: "86", women: "21128", castilla: "7000" }[prefs.team];
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

export function workloadTable(season, players) {
  const rows = players.map((p) => ({ p, w: workload(season, p.id) })).filter((r) => r.w.m28 > 0)
    .sort((a, b) => (b.w.acwr ?? 0) - (a.w.acwr ?? 0));
  if (!rows.length) return h`<p class="empty">No minutes in the last four weeks.</p>`;
  return h`<div class="scroll"><table class="t fx">
    <colgroup><col><col style="width:70px"><col style="width:70px"><col style="width:80px"><col style="width:70px"><col style="width:70px"><col style="width:170px" class="hide-s"></colgroup>
    <tr><th>player</th><th class="n">7 days</th><th class="n">28 days</th><th class="n">games/14d</th><th class="n">ACWR</th><th class="n">rest</th><th class="hide-s">note</th></tr>
    ${rows.map(({ p, w }) => h`<tr class="${w.flags.length ? "me" : ""}"><td><a href="#/player/${p.id}">${p.name}</a></td><td class="n">${w.m7}</td><td class="n">${w.m28}</td><td class="n">${w.g14}</td>
      <td class="n">${w.acwr == null ? "-" : w.acwr.toFixed(2)}</td><td class="n">${w.rest == null ? "-" : w.rest + "d"}</td><td class="hide-s sub">${w.flags.join(", ")}</td></tr>`)}
  </table></div>
  <p class="sub">ACWR here is minutes in the last 7 days against the weekly average of the 3 weeks before. Around 0.8 to 1.3 is the comfortable zone in the research; above 1.5 is a jump that's been linked to more soft-tissue injuries, and a big week after a long gap counts as one too. It only sees match minutes, not training, so treat it as a nudge.</p>`;
}
