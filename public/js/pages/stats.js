// 500 STATS: league table, xG table and player leaderboard for each of the
// team's competitions, plus a profile page for any player in them.
import { api, team, h, html, rt, comp, day } from "../core.js?v=9";
import { put, box, fail, loading, pagehead, tabs, seg, teamHref, resultBadge } from "../ui.js?v=9";
import { leagueData, profileRows, minMins, per90, f1, f2, noData, POS, GROUP } from "../league.js?v=9";

const VIEWS = [["table", "table"], ["xg", "xG table"], ["players", "players"]];

export async function stats(el, lg, view = "table") {
  const lgs = team().leagues;
  if (!lgs.length) {
    put(el, h`${pagehead("Stats")}<p class="empty">ESPN doesn't carry this team's league, so there are no tables or league stats.</p>`);
    return;
  }
  lg = lgs.includes(lg) ? lg : lgs[0];
  view = VIEWS.some(([k]) => k === view) ? view : "table";
  put(el, h`${pagehead("Stats", "tables, xG and every player")}
    ${tabs(lgs.map((l) => [l, comp(l), `#/stats/${l}/${view}`]), lg)}
    <div class="tabbody">
      <div class="row">${seg(VIEWS.map(([k, label]) => [k, label, `#/stats/${lg}/${k}`]), view)}</div>
      <div class="pane" id="sx">${loading()}</div>
    </div>`);
  const sx = el.querySelector("#sx");
  if (view === "table") return standings(sx, lg);
  const d = await leagueData(lg);
  if (!d) { put(sx, noData()); return; }
  if (view === "players") return playersTable(sx, d, lg);
  return teamsTable(sx, d);
}

// last five from the stored league files, newest on the right
function lastFive(logs, id) {
  const log = logs?.[id];
  if (!log?.length) return "";
  return h`<span class="form">${log.slice(-5).map(([mid, , opp, ha, gf, ga]) => {
    const r = gf > ga ? "W" : gf < ga ? "L" : "D";
    return resultBadge(r, `#/match/${logs.lg}/${mid}`, `${ha === "h" ? "v" : "at"} ${opp} ${gf}-${ga}`);
  })}</span>`;
}

async function standings(el, lg) {
  let t;
  try { t = await api(`/api/table/${lg}`, { ttl: 300 }); } catch { put(el, fail("the table")); return; }
  const d = await leagueData(lg).catch(() => null);
  const logs = d ? { lg, ...Object.fromEntries(Object.values(d.teams).map((x) => [x.id, x.log])) } : null;
  const mine = team().id;
  put(el, h`<p class="sub">${t.season}</p>${t.groups.map((g) => h`
    ${t.groups.length > 1 ? h`<h3>${g.name}</h3>` : ""}
    <div class="scroll"><table class="t fx">
    <colgroup><col style="width:40px"><col><col style="width:44px"><col class="hide-s" style="width:44px"><col class="hide-s" style="width:44px"><col class="hide-s" style="width:44px"><col class="hide-s" style="width:50px"><col class="hide-s" style="width:50px"><col style="width:56px"><col style="width:56px"><col class="hide-s" style="width:100px"></colgroup>
    <tr><th class="n">#</th><th>team</th><th class="n">P</th><th class="n hide-s">W</th><th class="n hide-s">D</th><th class="n hide-s">L</th><th class="n hide-s">GF</th><th class="n hide-s">GA</th><th class="n">GD</th><th class="n">Pts</th><th class="c hide-s">last 5</th></tr>
    ${g.rows.map((r, i) => {
      const zone = i && g.rows[i - 1].note !== r.note;
      return h`<tr class="${r.id === mine ? "me" : ""} ${zone ? "zone" : ""} ${zoneOf(r.note)}">
        <td class="n rk">${r.rank}</td><td><a href="${teamHref(r.id)}" title="${r.note || ""}">${r.name}</a></td>
        <td class="n">${r.p}</td><td class="n hide-s">${r.w}</td><td class="n hide-s">${r.d}</td><td class="n hide-s">${r.l}</td>
        <td class="n hide-s">${r.gf}</td><td class="n hide-s">${r.ga}</td><td class="n">${r.gd > 0 ? "+" : ""}${r.gd}</td><td class="n"><b>${r.pts}</b></td>
        <td class="c hide-s">${lastFive(logs, r.id)}</td></tr>`;
    })}
    </table></div>`)}
    ${keyline(t.groups)}`);
}

function zoneOf(note) {
  if (!note) return "";
  if (/relegat/i.test(note)) return "z-rel";
  if (/champions|knockout|round of 16|last 16/i.test(note)) return "z-cl";
  if (/europa/i.test(note)) return "z-el";
  if (/conference|play-?off/i.test(note)) return "z-co";
  return "";
}

function keyline(groups) {
  const notes = [...new Set(groups.flatMap((g) => g.rows.map((r) => r.note)).filter(Boolean))];
  if (!notes.length) return "";
  const colour = { "z-cl": "var(--r9)", "z-el": "var(--r6)", "z-co": "var(--r7)", "z-rel": "var(--loss)" };
  return h`<div class="keyline">${notes.filter((n) => zoneOf(n)).map((n) => h`<span><i style="background:${colour[zoneOf(n)]}"></i>${n}</span>`)}</div>`;
}

function teamsTable(el, d) {
  const rows = Object.values(d.teams).map((t) => ({ ...t, xgd: t.xgf - t.xga, npxgd: (t.npxgf - t.npxga) / (t.p || 1) }))
    .sort((a, b) => b.npxgd - a.npxgd);
  const mine = team().id;
  put(el, h`<div class="scroll"><table class="t fx">
    <colgroup><col style="width:34px"><col><col style="width:44px"><col style="width:80px"><col style="width:56px"><col style="width:56px"><col style="width:56px"><col style="width:56px"><col style="width:76px"><col style="width:66px"><col style="width:66px"><col style="width:60px" class="hide-s"><col style="width:66px" class="hide-s"></colgroup>
    <tr><th>#</th><th>team</th><th class="n">P</th><th class="n">W-D-L</th><th class="n">GF</th><th class="n">xGF</th><th class="n">GA</th><th class="n">xGA</th><th class="n" title="non-penalty xG difference per match">npxGD/m</th><th class="n">sh/m</th><th class="n">sh ag/m</th><th class="n hide-s">poss</th><th class="n hide-s">fouls/m</th></tr>
    ${rows.map((t, i) => h`<tr class="${t.id === mine ? "me" : ""}"><td>${i + 1}</td><td><a href="${teamHref(t.id)}">${t.name}</a></td><td class="n">${t.p}</td><td class="n">${t.w}-${t.d}-${t.l}</td>
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
    if (!list.length) {
      const most = Math.max(0, ...d.players.map((p) => p.mins));
      el.querySelector("#pl").innerHTML = html(h`<p class="empty">Nobody has ${state.min} minutes yet${state.pos ? " in that position" : ""}. The most anyone has played is ${most}. Try a lower floor.</p>`);
      return;
    }
    el.querySelector("#pl").innerHTML = html(h`<div class="scroll"><table class="t fx">
      <colgroup><col style="width:34px"><col><col style="width:56px"><col style="width:52px" class="hide-s"><col style="width:56px"><col style="width:46px"><col style="width:60px"><col style="width:46px"><col style="width:56px"><col style="width:82px"><col style="width:64px"></colgroup>
      <tr><th>#</th><th>player</th><th>team</th><th class="hide-s">pos</th><th class="n">min</th><th class="n">G</th><th class="n">npxG</th><th class="n">A</th><th class="n">xA</th><th class="n">${state.sort === "r" || state.sort === "mins" || state.sort === "g" ? "npxG+xA/90" : sorts[state.sort][0].replace(" per 90", "/90")}</th><th class="c">rating</th></tr>
      ${list.map((p, i) => h`<tr><td>${i + 1}</td><td><a href="#/pro/${lg}/${p.id}">${p.name}</a></td><td class="sub"><a href="${teamHref(p.team)}">${d.teams[p.team]?.abbr || ""}</a></td><td class="hide-s sub">${p.pos}</td>
        <td class="n">${p.mins}</td><td class="n">${p.g}</td><td class="n">${f2(p.npxg)}</td><td class="n">${p.a}</td><td class="n">${f2(p.xa)}</td>
        <td class="n"><b>${f2(["r", "mins", "g"].includes(state.sort) ? per90(p.npxg + p.xa, p.mins) : fn(p))}</b></td><td class="c">${p.r != null ? rt(p.r) : ""}</td></tr>`)}
    </table></div>`);
  };
  put(el, h`<div class="row">
      <select id="ppos" aria-label="position"><option value="">all positions</option>${["GK", "DEF", "MID", "ATT"].map((g) => h`<option value="${g}" ${state.pos === g ? "selected" : ""}>${{ GK: "keepers", DEF: "defenders", MID: "midfielders", ATT: "forwards and No.10s" }[g]}</option>`)}</select>
      <select id="psort" aria-label="sort by">${Object.entries(sorts).map(([k, [label]]) => h`<option value="${k}" ${state.sort === k ? "selected" : ""}>sort: ${label}</option>`)}</select>
      <label>min. minutes <input type="number" id="pmin" value="${state.min}" min="0" step="90" inputmode="numeric" class="w5"></label>
    </div><div id="pl"></div>
    <p class="sub">npxG is xG without penalties. xA is the xG of the shots a player set up. Per-90 numbers need a decent sample, so players under the minutes floor are left out.</p>`);
  el.querySelector("#ppos").addEventListener("change", (e) => { state.pos = e.target.value; draw(); });
  el.querySelector("#psort").addEventListener("change", (e) => { state.sort = e.target.value; draw(); });
  el.querySelector("#pmin").addEventListener("change", (e) => { state.min = Math.max(0, parseInt(e.target.value, 10) || 0); draw(); });
  draw();
}

function bars(rows) {
  return h`<table class="t fx pct"><colgroup><col><col style="width:80px"><col style="width:45%"></colgroup>
    ${rows.map((r) => h`<tr><td>${r.label}</td><td class="n">${r.fmt(r.v)}</td>
      <td>${r.pct == null ? h`<span class="sub">n/a</span>` : h`<div class="third"><i style="width:${r.pct}%"></i><span>${r.pct}</span></div>`}</td></tr>`)}
  </table>`;
}

// ---------------------------------------------------------------- profile

export async function profile(el, lg, pid) {
  put(el, loading());
  const d = await leagueData(lg);
  const p = d?.players.find((x) => x.id === pid);
  if (!p) { put(el, d ? h`<p class="empty">No ${comp(lg)} minutes for this player yet.</p>` : noData()); return; }
  put(el, h`<p class="crumbs"><a href="#/stats/${lg}/players">${comp(lg)} players</a></p>
    ${pagehead(p.name, h`<a href="${teamHref(p.team)}">${d.teams[p.team]?.name || ""}</a>, ${POS[p.pos] || p.pos}, ${comp(lg)}`)}
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
  return h`<section class="box flat"><h2>match by match</h2><div class="in scroll"><table class="t fx">
    <colgroup><col style="width:110px"><col><col style="width:50px"><col style="width:40px"><col style="width:40px"><col style="width:60px"><col style="width:60px"><col style="width:70px"></colgroup>
    <tr><th>date</th><th>v</th><th class="n">min</th><th class="n">G</th><th class="n">A</th><th class="n">xG</th><th class="n">xA</th><th class="c">rating</th></tr>
    ${[...p.log].reverse().map(([mid, date, opp, mins, g, a, x, xa, r]) => h`<tr><td>${date ? day(new Date(date)) : ""}</td><td><a href="#/match/${lg}/${mid}">${opp}</a></td>
      <td class="n">${mins}</td><td class="n">${g || ""}</td><td class="n">${a || ""}</td><td class="n">${f2(x)}</td><td class="n">${f2(xa)}</td><td class="c">${rt(r)}</td></tr>`)}
  </table></div></section>`;
}
