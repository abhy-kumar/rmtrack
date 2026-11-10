// 200 FIXTURES: upcoming games first; results newest first; friendlies
// hidden unless asked for.
import { api, prefs, team, h, day, hhmm, viewTz, tzName, madridToo, inSpain, comp, MADRID } from "../core.js?v=12";
import { put, fail, loading, pagehead, seg, revealed, result, resultBadge, isMine } from "../ui.js?v=12";
import { kit } from "../kits.js?v=12";

const FRIENDLY = "club.friendly";
const monthOf = (iso) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: viewTz() }).format(new Date(iso));

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
      <a class="btn" href="webcal://${location.host}/api/calendar.ics?team=${prefs.team}">subscribe in my calendar</a>
      <a class="btn" href="/api/calendar.ics?team=${prefs.team}" download>.ics file</a>
      ${!inSpain ? h`<span class="sub">Times in ${tzName()}${madridToo() ? ", Madrid time underneath" : ""}. <a href="#/settings">change</a></span>` : ""}</div>` : ""}
    ${!rows.length ? h`<p class="empty">Nothing here with those filters.</p>` : ""}
    ${months.map(([mo, fs]) => h`<section class="box flat"><h2>${mo}<small>${fs.length} ${fs.length === 1 ? "match" : "matches"}</small></h2><div class="in"><div class="fx-list">
      ${fs.map((f) => row(f))}</div></div></section>`)}`);

  el.querySelector("#fxcomp").addEventListener("change", (e) => { state.comp = e.target.value; fixtures(el, view); });
  el.querySelector("#fxfr").addEventListener("change", (e) => { state.friendlies = e.target.checked; fixtures(el, view); });
}

// One line per match, the whole line is the link. Kick-off time sits where
// the score will go, so upcoming and finished games read the same way.
function row(f) {
  const d = new Date(f.date);
  const st = f.status.state;
  const show = revealed(f.id);
  const odd = /postp|cancel|suspend/i.test(f.status.detail || "");
  const mid = st === "pre"
    ? h`<span class="s pre">${odd ? "off" : hhmm(d)}</span>`
    : show ? h`<span class="s">${f.home.score ?? 0}-${f.away.score ?? 0}</span>` : h`<span class="s">?-?</span>`;
  const extra = [
    st === "in" && h`<span class="live">LIVE</span> ${f.status.clock || ""}`,
    odd && f.status.detail,
    st === "pre" && madridToo() && `${hhmm(d, MADRID)} Madrid`,
    st === "pre" && f.tv?.length && f.tv.join(", "),
  ].filter(Boolean);
  return h`<a class="fx-row ${st === "in" ? "now" : ""}" href="#/match/${f.league}/${f.id}">
    <span class="d">${day(d)}<span class="sub">${comp(f.league, f.comp)}</span></span>
    <span class="h"><span class="${isMine(f.home) ? "mine" : ""}">${f.home.name}</span>${kit(f.home, 18, "home")}</span>
    ${mid}
    <span class="a">${kit(f.away, 18, "away")}<span class="${isMine(f.away) ? "mine" : ""}">${f.away.name}</span></span>
    <span class="r">${st === "post" && show ? resultBadge(result(f)) : ""}</span>
    ${extra.length ? h`<span class="x">${extra.map((x, i) => h`${i ? " | " : ""}${x}`)}</span>` : ""}
  </a>`;
}
