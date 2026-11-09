// 700 ABOUT: how the numbers are made and where the data comes from.
import { api, h } from "../core.js?v=11";
import { put, box, pagehead } from "../ui.js?v=11";
import { WORKLOAD_NOTE } from "../league.js?v=11";

export async function about(el) {
  let w = null;
  try { w = await api("/api/model", { ttl: 3600 }); } catch { /* page still reads fine without the numbers */ }
  const row = (label, v) => h`<tr><td>${label}</td><td class="n">${v > 0 ? "+" : ""}${Number(v).toFixed(2)}</td></tr>`;
  const fit = w?.xg?.fit_m;

  put(el, h`${pagehead("About the numbers")}
  <nav class="toc" aria-label="on this page"><a class="btn" href="#/about" data-jump="ratings">ratings</a> <a class="btn" href="#/about" data-jump="xg">xG</a> <a class="btn" href="#/about" data-jump="load">workload</a> <a class="btn" href="#/about" data-jump="data">data</a></nav>
  <div class="cols"><div class="prose">
    <h2 id="ratings">Player ratings</h2>
    <p>Every player starts on <b>6.0</b>. We read ESPN's minute-by-minute commentary (the same Opta-style feed the TV graphics use) and add or take away a little for everything he's involved in: goals, assists, chances made, shots, fouls won and given away, cards, offsides, saves, goals let in while he was on the pitch.</p>
    <p>The weights were fitted against FotMob's ratings for 449 player performances from the first sixteen competitive games of 2026-27, so the scale should feel familiar: 6.5 is a quiet night, 7.5 a good one, 8.5 and up is the headline. On games the fit hadn't seen we land about <b>0.3</b> from FotMob on average.</p>
    <p>What we can't see: passes, duels, dribbles and tackles per player. ESPN only gives those for whole teams, so a midfielder who runs the game without shooting or fouling can come out a little low. Team possession and the result are in the model partly to make up for that.</p>
    <p>Anyone on for less than ${w?.min_minutes ?? 10} minutes doesn't get a number. During a game ratings are live and drift up with minutes played. Every match page lets you add your own score next to ours; it stays in your browser.</p>

    <h2 id="xg">Expected goals (xG)</h2>
    <p>Every shot gets a number between 0 and 1: how often a shot like it goes in. It comes from where the shot was hit (distance, and how much of the goal mouth the shooter can see) and whether it was a header. Penalties get a flat ${w?.xg?.penalty ?? 0.76}.</p>
    <p>${fit ? `The model refits itself every time the league job runs. Last fit: ${fit.shots} shots, ${fit.goals} goals, ${fit.xg} expected.` : "Until the league job has collected enough shots it runs on a starting model tuned to the usual public xG values; after that it refits itself on every stored shot."}</p>
    <p>xA is the xG of the shots a player set up. npxG leaves penalties out, the fairer way to compare attackers.</p>
    ${w?.xg_examples ? h`<table class="t fx narrow"><colgroup><col><col style="width:80px"></colgroup>${Object.entries(w.xg_examples).map(([k, v]) => h`<tr><td>${k}</td><td class="n">${v.toFixed(2)}</td></tr>`)}</table>` : ""}

    <h2 id="load">Workload</h2>
    <p>${WORKLOAD_NOTE}</p>

    <h2 id="data">Where the data comes from</h2>
    <p>Scores, commentary, line-ups, tables and squads come from ESPN's public site feeds. News comes from the outlets credited on each line, through their RSS feeds, Google News and Bluesky, and is translated with Google's free web translator. Nothing here is official and nothing is affiliated with Real Madrid C.F.</p>
    <p>Tip: type a page number (100 to 700) anywhere to jump straight to it.</p>
  </div><aside>
    ${w ? box("rating weights", h`<table class="t">
      ${row("goal", w.events.goals)}${row("penalty goal (on top)", w.events.pen_goals)}${row("assist", w.events.assists)}
      ${row("chance created", w.events.key_passes)}${row("shot on target", w.events.sot)}${row("hit the woodwork", w.events.wood)}
      ${row("foul won", w.events.fouls_w)}${row("foul committed", w.events.fouls_c)}${row("offside", w.events.offs)}
      ${row("yellow card", w.events.yc)}${row("red card", w.events.rc)}${row("penalty won", w.events.pen_won)}
      ${row("penalty conceded", w.events.pen_conc)}${row("own goal", w.events.own_goals)}
      ${row("save (keeper)", w.save)}${row("keeper, per goal let in", w.conceded.GK)}${row("defender, per goal let in", w.conceded.DEF)}
      ${row("keeper clean sheet", w.clean.GK)}${row("full 90 minutes", w.minutes)}${row("win (midfielder)", w.result.MID)}
    </table>`, "per event") : ""}
  </aside></div>`);

  el.querySelector(".toc").addEventListener("click", (e) => {
    const a = e.target.closest("[data-jump]");
    if (!a) return;
    e.preventDefault();
    el.querySelector("#" + a.dataset.jump)?.scrollIntoView({ behavior: "smooth" });
  });
}
