// 200 FIXTURES: upcoming games first; results newest first; friendlies
// hidden unless asked for.
import { api, prefs, team, h, day, hhmm, userTz, inSpain, comp } from "../core.js?v=8";
import { put, fail, loading, pagehead, seg, revealed, veil, result, resultBadge } from "../ui.js?v=8";

const FRIENDLY = "club.friendly";
const monthOf = (iso) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: userTz }).format(new Date(iso));

export async function fixtures(el, view) {
  put(el, loading());
  let d;
  try { d = await api(`/api/fixtures?team=${prefs.team}`, { ttl: 60 }); }
  catch { put(el, fail("fixtures")); return; }

  const state = fixtures.state ||= { comp: "", friendlies: false };
  const comps = [...new Set(d.rows.map((f) => f.league))].filter((c) => c !== FRIENDLY);
  const keep = (f) => (state.friendlies || f.league !== FRIENDLY) && (!state.comp || f.league === state.comp);
  const ahead = d.rows.filter((f) => f.status.state !== "post" && keep(f));
  const done = d.rows.filter((f) => f.status.state === "post" && keep(f)).reverse();
  view = view === "results" || (!ahead.length && view !== "upcoming") ? "results" : "upcoming";
  const rows = view === "upcoming" ? ahead : done;

  const months = [];
  for (const f of rows) {
    const k = monthOf(f.date);
    if (!months.length || months[months.length - 1][0] !== k) months.push([k, []]);
    months[months.length - 1][1].push(f);
  }

  put(el, h`${pagehead("Fixtures and results", team().name)}
    <div class="row">
      ${seg([["upcoming", `upcoming (${ahead.length})`, "#/fixtures/upcoming"], ["results", `results (${done.length})`, "#/fixtures/results"]], view)}
      <select id="fxcomp" aria-label="competition"><option value="">all competitions</option>${comps.map((c) => h`<option value="${c}" ${c === state.comp ? "selected" : ""}>${comp(c)}</option>`)}</select>
      <label><input type="checkbox" id="fxfr" ${state.friendlies ? "checked" : ""}> friendlies</label>
    </div>
    ${view === "upcoming" ? h`<div class="row">
      <a class="btn" href="webcal://${location.host}/api/calendar.ics?team=${prefs.team}">add to my calendar</a>
      <a class="btn" href="/api/calendar.ics?team=${prefs.team}" download>.ics file</a>
      ${!inSpain ? h`<span class="sub">Times in ${userTz.replace(/_/g, " ")}, Madrid time underneath.</span>` : ""}</div>` : ""}
    ${!rows.length ? h`<p class="empty">Nothing here with those filters.</p>` : ""}
    ${months.map(([mo, fs]) => h`<section class="box flat"><h2>${mo}</h2><div class="in scroll"><table class="t fx">
      <colgroup><col style="width:120px"><col style="width:110px"><col><col style="width:90px"><col style="width:48px"></colgroup>
      ${fs.map((f) => row(f))}</table></div></section>`)}`);

  el.querySelector("#fxcomp").addEventListener("change", (e) => { state.comp = e.target.value; fixtures(el, view); });
  el.querySelector("#fxfr").addEventListener("change", (e) => { state.friendlies = e.target.checked; fixtures(el, view); });
}

function row(f) {
  const done = f.status.state === "post";
  const show = revealed(f.id);
  const odd = /postp|cancel|suspend/i.test(f.status.detail || "");
  return h`<tr class="${f.status.state === "in" ? "me" : ""}">
    <td class="nowrap">${day(new Date(f.date))}<br><span class="sub">${done ? "" : hhmm(new Date(f.date))}</span></td>
    <td class="sub">${comp(f.league, f.comp)}</td>
    <td><a href="#/match/${f.league}/${f.id}">${f.home.name} v ${f.away.name}</a>
      ${!done && !inSpain && prefs.times !== "local" ? h`<br><span class="sub">${hhmm(new Date(f.date), "Europe/Madrid")} Madrid</span>` : ""}
      ${f.tv?.length && !done ? h`<br><span class="sub">${f.tv.join(", ")}</span>` : ""}</td>
    <td class="n nowrap">${f.status.state === "pre" ? (odd ? f.status.detail : "") : show ? h`<b>${f.home.score ?? 0}-${f.away.score ?? 0}</b>` : veil(f.id)}
      ${f.status.state === "in" ? h`<br><span class="live">LIVE</span>` : ""}</td>
    <td class="c">${done && show ? resultBadge(result(f)) : ""}</td>
  </tr>`;
}
