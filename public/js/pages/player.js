// A player in our squad: season, rating trend, game log, workload, and a
// way through to the league-wide profile.
import { team, store, h, raw, esc, day, rt, comp } from "../core.js?v=7";
import { put, box, loading, pagehead, revealed, icons } from "../ui.js?v=7";
import { seasonData, playerSeason } from "../season.js?v=7";
import { workload } from "../league.js?v=7";

export async function player(el, pid) {
  put(el, loading());
  const s = await seasonData();
  const st = playerSeason(s, pid);
  const [name, pos] = s.names[pid] || ["Unknown player", ""];
  if (!st.apps) {
    put(el, h`<p class="crumbs"><a href="#/squad">squad</a></p>${pagehead(name)}<p class="empty">No competitive minutes this season yet.</p>`);
    return;
  }
  const fanVals = st.games.map((x) => (store("fan:" + x.m.id) || {})[pid]).filter(Boolean).map(Number);
  const fanAvg = fanVals.length ? fanVals.reduce((a, b) => a + b, 0) / fanVals.length : null;
  const rated = st.games.filter((x) => x.r != null);
  const w = workload(s, pid);

  put(el, h`<p class="crumbs"><a href="#/squad">squad</a></p>${pagehead(name, pos)}
    <div class="cols"><div>
      ${box("rating by match", rated.length > 1 ? spark(rated) : h`<p class="empty">needs a couple more games</p>`, `${rated.length} rated`)}
      <section class="box flat"><h2>game log</h2><div class="in scroll"><table class="t fx">
        <colgroup><col style="width:120px"><col><col style="width:50px"><col style="width:80px"><col style="width:70px"><col style="width:56px"></colgroup>
        <tr><th>date</th><th>match</th><th class="n">min</th><th></th><th class="c">rating</th><th class="c">you</th></tr>
        ${[...st.games].reverse().map((x) => h`<tr>
          <td class="nowrap">${day(new Date(x.m.date))}<br><span class="sub">${comp(x.m.league, x.m.comp)}</span></td>
          <td><a href="#/match/${x.m.league}/${x.m.id}/ratings">${x.m.home.abbr} ${revealed(x.m.id) ? `${x.m.home.score}-${x.m.away.score}` : "v"} ${x.m.away.abbr}</a>${x.st ? "" : h` <span class="sub">sub</span>`}</td>
          <td class="n">${x.mins}</td><td>${icons(x)}</td>
          <td class="c">${rt(x.r, x.m.motm === pid ? "motm" : "")}</td><td class="c">${(store("fan:" + x.m.id) || {})[pid] || ""}</td></tr>`)}
      </table></div></section>
    </div><aside>
      ${box("season", h`<dl class="kv">
        <dt>apps</dt><dd>${st.apps} (${st.starts} starts)</dd><dt>minutes</dt><dd>${st.mins}</dd>
        <dt>goals</dt><dd>${st.g}</dd><dt>assists</dt><dd>${st.a}</dd><dt>yellows</dt><dd>${st.y}</dd>
        <dt>avg rating</dt><dd>${st.avg != null ? rt(Math.round(st.avg * 100) / 100) : "-"}</dd>
        <dt>your avg</dt><dd>${fanAvg != null ? fanAvg.toFixed(2) : h`<span class="sub">rate him on a match page</span>`}</dd>
        <dt>player of the match</dt><dd>${st.motm}</dd></dl>`)}
      ${box("league profile", h`${team().leagues.map((lg) => h`<p><a href="#/pro/${lg}/${pid}">${comp(lg)}: percentiles, xG and xA</a></p>`)}`)}
      ${box("workload", h`<dl class="kv">
        <dt>last 7 days</dt><dd>${w.m7} min</dd><dt>last 28 days</dt><dd>${w.m28} min</dd>
        <dt>games in 14 days</dt><dd>${w.g14}</dd><dt>ACWR</dt><dd>${w.acwr == null ? "-" : w.acwr.toFixed(2)}</dd>
        <dt>days since last game</dt><dd>${w.rest ?? "-"}</dd></dl>
        ${w.flags.length ? h`<p class="warn">${w.flags.join(", ")}</p>` : ""}
        <p class="sub"><a href="#/about">What these mean.</a></p>`)}
    </aside></div>`);
}

function spark(pts) {
  const W = 300, H = 80, pad = 14;
  const xs = (i) => pad + (i * (W - pad * 2)) / Math.max(1, pts.length - 1);
  const ys = (r) => H - pad - ((r - 4) / 6) * (H - pad * 2);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)},${ys(p.r).toFixed(1)}`).join(" ");
  return raw(`<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="rating trend">
    ${[6, 7, 8].map((v) => `<line class="gd" x1="${pad}" x2="${W - pad}" y1="${ys(v)}" y2="${ys(v)}"/><text x="0" y="${ys(v) + 3}">${v}</text>`).join("")}
    <path class="ln" d="${path}"/>
    ${pts.map((p, i) => `<circle class="dt" r="2.5" cx="${xs(i).toFixed(1)}" cy="${ys(p.r).toFixed(1)}"><title>${esc(p.m.home.abbr + " v " + p.m.away.abbr + ": " + p.r)}</title></circle>`).join("")}
  </svg>`);
}
