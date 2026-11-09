// 100 HOME: what's on now or next, how the last game went, the wires.
import { api, prefs, team, h, until, hhmm, userTz, inSpain, rt, comp } from "../core.js?v=9";
import { live } from "../alerts.js?v=9";
import { put, box, fail, loading, board, formStrip, revealed, isMine, matchList, actions, personLink, teamHref, feedLine } from "../ui.js?v=9";
import { loadNews, visible, newsItem } from "../newsfeed.js?v=9";

const QUIET = ["foul", "offside", "corner", "other"];

export async function home(el) {
  put(el, loading("fetching the latest"));
  let ov;
  try { ov = await api(`/api/overview?team=${prefs.team}`, { ttl: 15 }); }
  catch { put(el, fail("the overview")); return; }

  const liveFixture = ov.live?.[0];
  const next = ov.next?.[0];
  const upcoming = (ov.next || []).slice(liveFixture ? 0 : 1, 6);

  put(el, h`<div class="cols">
    <div>
      <div id="top">${liveFixture ? loading("loading the live match") : next ? nextUp(next) : ""}</div>
      <div id="last">${ov.last ? loading("loading the last result") : ""}</div>
      <div id="homenews">${loading("fetching the wires")}</div>
    </div>
    <aside>
      ${box("form", h`${formStrip(ov.form)}<p class="sub more">last ${ov.form.length}, oldest on the left. Each one opens the match.</p>`)}
      ${box("coming up", upcoming.length ? matchList(upcoming) : h`<p class="empty">nothing scheduled</p>`, h`<a href="#/fixtures">all</a>`)}
      <div id="mini"></div>
    </aside>
  </div>`);

  if (liveFixture) liveCard(el.querySelector("#top"), liveFixture);
  if (ov.last) lastCard(el.querySelector("#last"), ov.last);
  if (team().domestic) miniTable(el.querySelector("#mini"), team().domestic);
  homeNews(el.querySelector("#homenews"));

  const cd = el.querySelector("[data-countdown]");
  const tick = cd && setInterval(() => { cd.textContent = until(cd.dataset.countdown); }, 1000);
  const poll = liveFixture ? setInterval(() => liveCard(el.querySelector("#top"), liveFixture), 20000) : null;
  return () => { clearInterval(tick); clearInterval(poll); };
}

function nextUp(f) {
  const base = `#/match/${f.league}/${f.id}`;
  return box("next up", h`${board({ ...f, timeline: [] }, { countdown: true })}
    ${actions([["preview and scouting", `${base}/preview`], ["all fixtures", "#/fixtures"]])}`,
  !inSpain ? `times in ${userTz.replace(/_/g, " ")}` : "");
}

async function liveCard(el, f) {
  let m = live.details[f.id];
  try { m = await api(`/api/match/${f.league}/${f.id}`, { ttl: 10 }); } catch { /* keep what we have */ }
  if (!m) { put(el, box("live now", fail("the live match"))); return; }
  const base = `#/match/${m.league}/${m.id}`;
  const lines = [...m.feed].reverse().filter((x) => !QUIET.includes(x.k)).slice(0, 5);
  put(el, box("live now", h`${board(m)}
    ${revealed(m.id) && lines.length ? h`<ul class="feed mt">${lines.map(feedLine)}</ul>` : ""}
    ${actions([["commentary", `${base}/live`], ["live ratings", `${base}/ratings`], ["xG and shots", `${base}/stats`]])}`,
  "updates every 15s"));
}

// the last game with the answer to "how did we play?": scorers, xG and the best three
async function lastCard(el, f) {
  let m;
  try { m = await api(`/api/match/${f.league}/${f.id}`, { ttl: 300 }); } catch { m = { ...f, timeline: [] }; }
  const base = `#/match/${m.league}/${m.id}`;
  const mine = isMine(m.home) ? m.home : isMine(m.away) ? m.away : null;
  const best = mine?.xi && revealed(m.id)
    ? [...mine.xi, ...mine.bench].filter((p) => p.r != null).sort((a, b) => b.r - a.r).slice(0, 3) : [];
  put(el, box("last time out", h`${board(m)}
    ${best.length ? h`<div class="best">${best.map((p) => h`<span>${rt(p.r, p.id === m.motm ? "motm" : "")} ${personLink(m, mine, p.id, p.short)}</span>`)}</div>` : ""}
    ${actions([["ratings", `${base}/ratings`], ["shot map and xG", `${base}/stats`], ["commentary", `${base}/live`]])}`));
}

async function miniTable(el, league) {
  try {
    const t = await api(`/api/table/${league}`, { ttl: 300 });
    const rows = t.groups[0]?.rows || [];
    const i = rows.findIndex((r) => r.id === team().id);
    if (i < 0) return;
    const from = Math.max(0, Math.min(i - 3, rows.length - 7));
    put(el, box(comp(league, t.name), h`<table class="t fx"><colgroup><col style="width:30px"><col><col style="width:36px"><col style="width:44px"></colgroup>
      <tr><th>#</th><th>team</th><th class="n">P</th><th class="n">Pts</th></tr>
      ${rows.slice(from, from + 7).map((r) => h`<tr class="${r.id === team().id ? "me" : ""}"><td>${r.rank}</td><td><a href="${teamHref(r.id)}">${r.name}</a></td><td class="n">${r.p}</td><td class="n">${r.pts}</td></tr>`)}
      </table>`, h`<a href="#/stats/${league}/table">full</a>`));
  } catch { /* the sidebar can live without it */ }
}

async function homeNews(el) {
  try {
    const n = await loadNews();
    put(el, box("the wires", h`<ul class="news compact">${visible(n.items).slice(0, 10).map((i) => newsItem(i, true))}</ul>
      ${actions([["all news", "#/news"]], "left")}`, n.built ? "as of " + hhmm(new Date(n.built)) : ""));
  } catch { put(el, box("the wires", fail("the news"))); }
}
