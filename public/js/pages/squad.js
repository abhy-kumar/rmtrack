// 400 SQUAD: who's available, who's carrying a load, then the squad itself.
import { api, prefs, team, h, day, rt } from "../core.js?v=7";
import { put, box, fail, loading, pagehead } from "../ui.js?v=7";
import { seasonData, playerSeason } from "../season.js?v=7";
import { workloadRows, workloadList, workloadTable, WORKLOAD_NOTE } from "../league.js?v=7";

const POS_ORDER = { G: 0, D: 1, M: 2, F: 3 };
const POS_NAME = ["Goalkeepers", "Defenders", "Midfielders", "Forwards"];

export async function squad(el) {
  put(el, loading("loading the squad and this season's numbers"));
  let sq, s;
  try { [sq, s] = await Promise.all([api(`/api/squad?team=${prefs.team}`, { ttl: 600 }), seasonData()]); }
  catch { put(el, fail("the squad")); return; }

  const notes = availability(sq.players, s);
  const load = workloadRows(s, sq.players);
  const flagged = load.filter((r) => r.w.flags.length);
  const groups = [[], [], [], []];
  for (const p of sq.players) groups[POS_ORDER[p.pos?.[0]] ?? 2].push({ p, st: playerSeason(s, p.id) });

  put(el, h`${pagehead("Squad", `${team().name}${sq.coach ? ", coach " + sq.coach : ""}`)}
    <div class="cols">
      <div>${groups.map((g, i) => g.length ? group(POS_NAME[i], g) : "")}
        <p class="sub">Apps (starts) and ratings cover competitive games this season. Friendlies don't count.</p>
        ${load.length ? h`<details class="tool" id="load"><summary>match load for everyone who played in the last 4 weeks (${load.length})</summary>
          ${workloadTable(load)}<p class="sub">${WORKLOAD_NOTE}</p></details>` : ""}</div>
      <aside>
        ${box("availability", notes.length ? notes : h`<p class="sub">No injuries, bans or suspension risks on record.</p>`)}
        ${box("workload watch", h`
          ${flagged.length ? workloadList(flagged) : h`<p class="sub">Nobody's load stands out right now.</p>`}
          ${load.length ? h`<p class="sub"><a href="#/squad" data-open="load">full load table</a></p>` : ""}`, "all competitions")}
      </aside>
    </div>`);
}

// The sidebar link opens the load table below the squad instead of navigating.
document.addEventListener("click", (e) => {
  const a = e.target.closest("[data-open]");
  if (!a) return;
  const d = document.getElementById(a.dataset.open);
  if (!d) return;
  e.preventDefault();
  d.open = true;
  d.scrollIntoView({ behavior: "smooth", block: "start" });
});

function availability(players, s) {
  const notes = [];
  const league = s.matches.filter((m) => m.league === team().domestic);
  const last = league[league.length - 1];
  for (const p of players) {
    const yellows = league.reduce((t, m) => t + (m.players[p.id]?.[4] || 0), 0);
    if (p.injuries?.length) {
      const i = p.injuries[0];
      notes.push(h`<div class="warn"><span class="inj">INJ</span> <b>${p.name}</b>: ${i.detail || i.status || "injured"}${i.back ? h`, back around ${day(new Date(i.back))}` : ""}</div>`);
    }
    if (last?.players[p.id]?.[5]) notes.push(h`<div class="warn"><b>${p.name}</b> was sent off in the last league game, so most likely misses the next one.</div>`);
    if (yellows && yellows % 5 === 4) notes.push(h`<div class="warn"><b>${p.name}</b> is on ${yellows} league yellows. One more is a one-match ban.</div>`);
  }
  return notes;
}

function group(title, rows) {
  return h`<section class="box flat"><h2>${title}</h2><div class="in scroll"><table class="t fx">
    <colgroup><col style="width:44px"><col><col class="hide-s" style="width:56px"><col class="hide-s" style="width:130px"><col style="width:76px"><col style="width:64px"><col style="width:40px"><col style="width:40px"><col class="hide-s" style="width:40px"><col style="width:70px"></colgroup>
    <tr><th>#</th><th>player</th><th class="n hide-s">age</th><th class="hide-s">nat.</th><th class="n">apps</th><th class="n">min</th><th class="n">G</th><th class="n">A</th><th class="n hide-s">Y</th><th class="c">avg</th></tr>
    ${rows.sort((a, b) => (+a.p.no || 99) - (+b.p.no || 99)).map(({ p, st }) => h`<tr>
      <td>${p.no || ""}</td>
      <td><a href="#/player/${p.id}">${p.name}</a>${p.injuries?.length ? h` <span class="inj">INJ</span>` : ""}${st.motm ? h` <span class="sub">${st.motm}x motm</span>` : ""}</td>
      <td class="n hide-s">${p.age || ""}</td><td class="hide-s sub">${p.nat || ""}</td>
      <td class="n">${st.apps ? h`${st.apps}<span class="sub">(${st.starts})</span>` : "-"}</td><td class="n">${st.mins || "-"}</td>
      <td class="n">${st.g || ""}</td><td class="n">${st.a || ""}</td><td class="n hide-s">${st.y || ""}</td>
      <td class="c">${st.avg != null ? rt(Math.round(st.avg * 100) / 100) : ""}</td></tr>`)}
  </table></div></section>`;
}
