// A player in our squad: season, rating trend, game log, workload, and a
// way through to the league-wide profile.
import { team, store, h, esc, day, rt, comp } from "../core.js?v=8";
import { put, box, loading, pagehead, revealed, icons } from "../ui.js?v=8";
import { seasonData, playerSeason } from "../season.js?v=8";
import { workload } from "../league.js?v=8";

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
      ${box("rating by match", rated.length > 1 ? h`<div class="spark" data-spark></div>` : h`<p class="empty">needs a couple more games</p>`, `${rated.length} rated`)}
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
  const slot = el.querySelector("[data-spark]");
  if (slot) drawSpark(slot, rated);
}

const opponent = (m) => (/real madrid/i.test(m.home.name) ? m.away : m.home).abbr;

// Drawn at the box's real pixel width so dots stay round and labels stay
// readable; redrawn when the box changes size.
function drawSpark(slot, pts) {
  const draw = () => {
    const W = Math.max(240, Math.floor(slot.clientWidth));
    const H = 130, left = 26, right = 18, top = 18, bottom = 22;
    const lo = Math.min(6, Math.floor(Math.min(...pts.map((p) => p.r))));
    const hi = Math.max(8, Math.ceil(Math.max(...pts.map((p) => p.r))));
    const step = (W - left - right) / Math.max(1, pts.length - 1);
    const xs = (i) => left + (pts.length === 1 ? (W - left - right) / 2 : i * step);
    const ys = (r) => top + ((hi - r) / (hi - lo)) * (H - top - bottom);
    const roomy = step >= 30;
    const grid = [];
    for (let v = lo; v <= hi; v++) {
      grid.push(`<line class="gd" x1="${left}" x2="${W - right}" y1="${ys(v)}" y2="${ys(v)}"/><text class="ax" x="${left - 8}" y="${ys(v) + 3.5}">${v}</text>`);
    }
    const path = pts.map((p, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)},${ys(p.r).toFixed(1)}`).join(" ");
    const dots = pts.map((p, i) => {
      const x = xs(i).toFixed(1), y = ys(p.r).toFixed(1);
      const label = `${day(new Date(p.m.date))}, ${p.m.home.abbr} v ${p.m.away.abbr}: ${p.r}`;
      return `<a href="#/match/${esc(p.m.league)}/${esc(p.m.id)}/ratings"><title>${esc(label)}</title>
        <circle class="dt" r="4" cx="${x}" cy="${y}"/>
        ${roomy ? `<text class="v" x="${x}" y="${(y - 8).toFixed(1)}">${p.r.toFixed(1)}</text><text class="op" x="${x}" y="${H - 6}">${esc(opponent(p.m))}</text>` : ""}</a>`;
    }).join("");
    slot.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="rating by match, oldest first">
      ${grid.join("")}<path class="ln" d="${path}"/>${dots}</svg>`;
  };
  draw();
  if ("ResizeObserver" in window) {
    let last = slot.clientWidth;
    new ResizeObserver(() => {
      if (Math.abs(slot.clientWidth - last) < 2) return;
      last = slot.clientWidth;
      draw();
    }).observe(slot);
  }
}
