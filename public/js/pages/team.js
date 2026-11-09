// Any club in our competitions: record, xG, results and its players, built
// from the league files the collector writes.
import { api, team, h, day, rt, comp } from "../core.js?v=11";
import { put, box, loading, pagehead, tabs, resultBadge, actions, revealed } from "../ui.js?v=11";
import { leagueData, f1, f2, per90, POS } from "../league.js?v=11";
import { kit } from "../kits.js?v=11";

export async function teamPage(el, id, wanted) {
  put(el, loading());
  const found = (await Promise.all(team().leagues.map(async (lg) => [lg, await leagueData(lg)])))
    .filter(([, d]) => d?.teams[id]);
  if (!found.length) {
    put(el, h`<p class="crumbs"><a href="#/stats">stats</a></p>${pagehead("Team")}
      <p class="empty">No league numbers for this side yet. They only exist for teams in ${team().leagues.map((l) => comp(l)).join(" and ") || "our leagues"}.</p>`);
    return;
  }
  const [lg, d] = found.find(([l]) => l === wanted) || found[0];
  const t = d.teams[id];
  const mine = id === team().id;
  let rank = null;
  try {
    const tab = await api(`/api/table/${lg}`, { ttl: 300 });
    rank = tab.groups.flatMap((g) => g.rows).find((r) => r.id === id) || null;
  } catch { /* the page stands without it */ }

  const npxgd = (t.npxgf - t.npxga) / (t.p || 1);
  const tile = (v, label) => h`<div class="stat"><b>${v}</b><span>${label}</span></div>`;
  put(el, h`<p class="crumbs"><a href="#/stats/${lg}/table">${comp(lg)} table</a></p>
    <div class="teamhead">${kit({ id }, 44)}${pagehead(t.name, rank ? `${ordinal(rank.rank)} in ${comp(lg)}, ${rank.pts} pts` : comp(lg))}</div>
    ${found.length > 1 ? h`${tabs(found.map(([l]) => [l, comp(l), `#/team/${id}/${l}`]), lg)}<div class="tabbody"><div class="pane">` : h`<div>`}
    <div class="statgrid">
      ${tile(t.p, "played")}${tile(`${t.w}-${t.d}-${t.l}`, "won drawn lost")}
      ${tile(`${t.gf}-${t.ga}`, "goals")}${tile(`${f1(t.xgf)}-${f1(t.xga)}`, "xG for, against")}
      ${tile(`${npxgd > 0 ? "+" : ""}${f2(npxgd)}`, "npxG diff a game")}${tile(t.poss != null ? `${t.poss}%` : "-", "possession")}
    </div>
    ${mine ? actions([["our squad page", "#/squad"], ["fixtures", "#/fixtures"]], "left") : ""}
    <div class="cols mt"><div>${results(t, lg)}</div><aside>${players(d, id, lg)}</aside></div>
    </div>${found.length > 1 ? h`</div>` : ""}`);
}

const ordinal = (n) => n + (["th", "st", "nd", "rd"][(n % 100 - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");

function results(t, lg) {
  const rows = [...(t.log || [])].reverse();
  return box("results", rows.length ? h`<div class="scroll"><table class="t fx">
    <colgroup><col style="width:104px"><col><col style="width:60px"><col style="width:34px"><col style="width:100px"></colgroup>
    <tr><th>date</th><th>opponent</th><th class="n">score</th><th></th><th class="n">xG</th></tr>
    ${rows.map(([mid, date, opp, ha, gf, ga, xf, xa]) => {
      const r = gf > ga ? "W" : gf < ga ? "L" : "D";
      const show = revealed(mid);
      return h`<tr><td>${date ? day(new Date(date)) : ""}</td>
        <td><a href="#/match/${lg}/${mid}">${ha === "h" ? "v" : "at"} ${opp}</a></td>
        <td class="n"><b>${show ? `${gf}-${ga}` : "?-?"}</b></td><td class="c">${show ? resultBadge(r, `#/match/${lg}/${mid}`) : ""}</td>
        <td class="n">${show ? `${f2(xf)} - ${f2(xa)}` : ""}</td></tr>`;
    })}</table></div>` : h`<p class="empty">no games stored yet</p>`, `${rows.length} games`, "flat");
}

function players(d, id, lg) {
  const list = d.players.filter((p) => p.team === id && p.mins).sort((a, b) => b.mins - a.mins);
  if (!list.length) return box("players", h`<p class="empty">none yet</p>`);
  const top = (fn, label, fmt) => {
    const p = [...list].sort((a, b) => fn(b) - fn(a))[0];
    return h`<dt>${label}</dt><dd><a href="#/pro/${lg}/${p.id}">${p.name}</a> ${fmt(fn(p))}</dd>`;
  };
  return h`${box("leaders", h`<dl class="kv">
      ${top((p) => p.g, "goals", (v) => v)}${top((p) => p.a, "assists", (v) => v)}
      ${top((p) => p.xg, "xG", f2)}${top((p) => p.xa, "xA", f2)}
      ${top((p) => (p.mins >= 270 ? p.r || 0 : 0), "avg rating", (v) => v.toFixed(2))}
    </dl>`)}
    ${box("players", h`<table class="t fx"><colgroup><col><col style="width:44px"><col style="width:52px"><col style="width:48px"></colgroup>
      <tr><th>player</th><th class="n">min</th><th class="n">G+A</th><th class="c">avg</th></tr>
      ${list.map((p) => h`<tr><td><a href="#/pro/${lg}/${p.id}">${p.name}</a><br><span class="sub">${POS[p.pos] || p.pos}</span></td>
        <td class="n">${p.mins}</td><td class="n">${p.g + p.a}</td><td class="c">${rt(p.r)}</td></tr>`)}
    </table><p class="sub more">npxG + xA per 90 for the busiest: ${list.slice(0, 3).map((p) => `${p.name.split(" ").pop()} ${f2(per90(p.npxg + p.xa, p.mins))}`).join(", ")}</p>`, "", "flat")}`;
}
