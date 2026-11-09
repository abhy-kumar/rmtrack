// Pitch drawings built from the positions in ESPN's commentary.
// Positions come as 0-100 on both axes, in the attacking frame of the side
// that made the play: x=100 is the goal they're shooting at.
import { h, raw, esc } from "./core.js?v=11";

const L = 105, W = 68;          // pitch in metres
const X = (x) => (x / 100) * L;
// ESPN's y runs from the attacker's right (0) to his left (100). Attacking
// to the right of the screen, his right is the bottom, so y is flipped.
const Y = (y) => W - (y / 100) * W;

// home attacks right, away attacks left
const place = (side, x, y) => (side === "away" ? [L - X(x), W - Y(y)] : [X(x), Y(y)]);

function lines(half = false) {
  const s = 'class="pl-line"';
  const box = (x0, dir) => {
    const d = dir * 16.5, d6 = dir * 5.5;
    return `<rect ${s} x="${Math.min(x0, x0 + d)}" y="${(W - 40.32) / 2}" width="16.5" height="40.32"/>
      <rect ${s} x="${Math.min(x0, x0 + d6)}" y="${(W - 18.32) / 2}" width="5.5" height="18.32"/>
      <circle class="pl-dot" cx="${x0 + dir * 11}" cy="${W / 2}" r="0.4"/>
      <rect ${s} x="${dir > 0 ? x0 - 1.6 : x0}" y="${(W - 7.32) / 2}" width="1.6" height="7.32"/>`;
  };
  return `<rect class="pl-turf" x="0" y="0" width="${L}" height="${W}"/>
    <rect ${s} x="0" y="0" width="${L}" height="${W}"/>
    ${half ? "" : `<line ${s} x1="${L / 2}" y1="0" x2="${L / 2}" y2="${W}"/><circle ${s} cx="${L / 2}" cy="${W / 2}" r="9.15"/><circle class="pl-dot" cx="${L / 2}" cy="${W / 2}" r="0.5"/>`}
    ${box(0, 1)}${box(L, -1)}`;
}

function svg(inner, cls = "") {
  return raw(`<svg class="pitchmap ${cls}" viewBox="-2 -2 ${L + 4} ${W + 4}" role="img">${lines()}${inner}</svg>`);
}

// one marker per outcome; shape carries the meaning, fill carries the side
function marker(k, x, y, side, tip, size = 1) {
  const c = `mk ${side}`;
  const R = (r) => (r * size).toFixed(2);
  const t = tip ? `<title>${esc(tip)}</title>` : "";
  switch (k) {
    case "goal": return `<g>${t}<circle class="${c}" cx="${x}" cy="${y}" r="${R(1.7)}"/><circle class="mk-ring" cx="${x}" cy="${y}" r="${R(2.6)}"/></g>`;
    case "saved": return `<g>${t}<circle class="${c} hollow" cx="${x}" cy="${y}" r="${R(1.3)}"/></g>`;
    case "blocked": return `<g>${t}<rect class="${c}" x="${x - 0.9}" y="${y - 0.9}" width="1.8" height="1.8"/></g>`;
    case "post": return `<g>${t}<rect class="${c} hollow" x="${x - 1}" y="${y - 1}" width="2" height="2" transform="rotate(45 ${x} ${y})"/></g>`;
    case "fw": return `<g>${t}<path class="${c}" d="M${x} ${y - 1.3}L${x + 1.2} ${y + 0.9}L${x - 1.2} ${y + 0.9}Z"/></g>`;
    case "fc": return `<g>${t}<path class="${c} hollow" d="M${x} ${y + 1.3}L${x + 1.2} ${y - 0.9}L${x - 1.2} ${y - 0.9}Z"/></g>`;
    case "ofs": return `<g>${t}<path class="${c} hollow" d="M${x - 0.8} ${y + 1.3}V${y - 1.3}H${x + 1.1}L${x + 0.5} ${y - 0.7}L${x + 1.1} ${y - 0.1}H${x - 0.8}"/></g>`;
    default: return `<g>${t}<path class="${c} cross" d="M${x - 1} ${y - 1}L${x + 1} ${y + 1}M${x + 1} ${y - 1}L${x - 1} ${y + 1}"/></g>`;
  }
}

const shape = (k) => (k === "off" || k === "pmiss" ? "miss" : k);
const KIND = { goal: "goal", saved: "saved", blocked: "blocked", off: "off target", post: "woodwork", pmiss: "penalty missed" };
const NAMES = { goal: "goal", saved: "saved", blocked: "blocked", miss: "off target", post: "woodwork", fw: "foul won", fc: "foul given away", ofs: "offside" };

export function legend(items) {
  return raw(`<div class="legend">${items.map((i) =>
    `<span><svg viewBox="-3 -3 6 6" width="14" height="14">${marker(i, 0, 0, "home", "")}</svg>${NAMES[i]}</span>`).join("")}</div>`);
}

export function shotMap(m) {
  if (!m.shots?.length) return h`<p class="empty">No shot positions for this match.</p>`;
  const marks = [];
  for (const s of m.shots) {
    const [x, y] = place(s.s, s.x, s.y);
    const tip = `${s.name} ${s.m}, ${KIND[s.k] || s.k}${s.head ? ", header" : ""}${s.pen ? ", penalty" : ""}${s.xg != null ? `, xG ${s.xg.toFixed(2)}` : ""}`;
    if ((s.k === "goal" || s.k === "saved") && s.x2 != null) {
      const [x2, y2] = place(s.s, s.x2, s.y2);
      marks.push(`<line class="trail" x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`);
    }
    marks.push(marker(shape(s.k), +x.toFixed(1), +y.toFixed(1), s.s, tip, 0.7 + 1.6 * Math.sqrt(s.xg || 0)));
  }
  const sum = (side) => {
    const sh = m.shots.filter((s) => s.s === side);
    const inBox = sh.filter((s) => s.x >= 84.3 && s.y >= 20.4 && s.y <= 79.6).length;
    const x = sh.reduce((t, s) => t + (s.xg || 0), 0);
    const best = sh.filter((s) => (s.xg || 0) >= 0.3).length;
    return h`<td class="n"><b>${x.toFixed(2)}</b></td><td class="n">${sh.length}</td><td class="n">${sh.filter((s) => s.k === "goal" || s.k === "saved").length}</td><td class="n">${inBox}</td><td class="n">${best}</td><td class="n">${sh.length ? (x / sh.length).toFixed(2) : "-"}</td>`;
  };
  return h`
    <div class="mapcap"><span>&lt; ${m.away.name} attack this way</span><span>${m.home.name} attack this way &gt;</span></div>
    ${svg(marks.join(""))}
    ${legend(["goal", "saved", "blocked", "miss", "post"])}
    <p class="sub">Light markers are ${m.home.name}, dark are ${m.away.name}. Bigger markers are better chances (higher xG). Lines show where shots on target ended up. Hover a marker for who, when and the xG.</p>
    <div class="scroll"><table class="t fx" style="max-width:700px"><colgroup><col><col style="width:64px"><col style="width:64px"><col style="width:84px"><col style="width:64px"><col style="width:100px"><col style="width:84px"></colgroup>
      <tr><th></th><th class="n">xG</th><th class="n">shots</th><th class="n">on target</th><th class="n">in box</th><th class="n" title="shots worth 0.3 xG or more">big chances</th><th class="n">xG/shot</th></tr>
      <tr><td>${m.home.name}</td>${sum("home")}</tr><tr><td>${m.away.name}</td>${sum("away")}</tr></table></div>`;
}

// who was on top, five minutes at a time
export function momentum(m) {
  if (!m.acts?.length) return "";
  const end = Math.max(90, ...m.acts.map((a) => a[0] / 60));
  const bins = Math.ceil(end / 5);
  const val = { goal: 3, shot: 1.2, cor: 0.6, off: 0.3, fw: 0.3, fc: 0 };
  const score = { home: Array(bins).fill(0), away: Array(bins).fill(0) };
  for (const [t, side, k, x] of m.acts) {
    if (!side) continue;
    let v = val[k] ?? 0;
    if (k === "fw" && x < 60) v = 0;        // only free kicks won up the pitch count
    if (k === "shot" && x >= 84) v += 0.6;   // from inside the box
    score[side][Math.min(bins - 1, Math.floor(t / 300))] += v;
  }
  const top = Math.max(2, ...score.home, ...score.away);
  const Wd = 300, H = 90, mid = H / 2, bw = Wd / bins;
  const bars = [];
  score.home.forEach((v, i) => v && bars.push(`<rect class="mo-h" x="${(i * bw + 0.5).toFixed(1)}" y="${(mid - (v / top) * (mid - 4)).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${((v / top) * (mid - 4)).toFixed(1)}"><title>${i * 5}-${i * 5 + 5}': ${v.toFixed(1)}</title></rect>`));
  score.away.forEach((v, i) => v && bars.push(`<rect class="mo-a" x="${(i * bw + 0.5).toFixed(1)}" y="${mid}" width="${(bw - 1).toFixed(1)}" height="${((v / top) * (mid - 4)).toFixed(1)}"><title>${i * 5}-${i * 5 + 5}': ${v.toFixed(1)}</title></rect>`));
  const goals = m.acts.filter((a) => a[2] === "goal").map((a) => {
    const x = (a[0] / 60 / (bins * 5)) * Wd;
    return `<line class="mo-goal" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${a[1] === "home" ? 2 : mid}" y2="${a[1] === "home" ? mid : H - 2}"/>`;
  });
  const ticks = [15, 30, 45, 60, 75, 90].filter((t) => t <= bins * 5).map((t) => {
    const x = (t / (bins * 5)) * Wd;
    return `<line class="mo-tick" x1="${x}" x2="${x}" y1="0" y2="${H}"/><text x="${x + 1}" y="${H - 2}">${t}'</text>`;
  });
  return h`<h3 class="maph">Momentum</h3>
    ${raw(`<svg class="momentum" viewBox="0 0 ${Wd} ${H}" preserveAspectRatio="none" role="img" aria-label="momentum">${ticks.join("")}<line class="mo-mid" x1="0" x2="${Wd}" y1="${mid}" y2="${mid}"/>${bars.join("")}${goals.join("")}</svg>`)}
    <div class="mapcap"><span>up: ${m.home.name}</span><span>down: ${m.away.name}</span></div>
    <p class="sub">Each bar is five minutes of attacking: shots (more from inside the box), corners, free kicks won in the final third and offsides. Vertical lines are goals.</p>`;
}

// where each side's actions happened, by third of the pitch
export function territory(m) {
  if (!m.acts?.length) return "";
  const row = (side, name) => {
    const a = m.acts.filter((x) => x[1] === side && x[2] !== "fc");
    if (!a.length) return "";
    const th = [0, 0, 0];
    a.forEach((x) => th[x[3] < 33.3 ? 0 : x[3] < 66.6 ? 1 : 2]++);
    const pct = th.map((n) => Math.round((n / a.length) * 100));
    return h`<tr><td>${name}</td>${pct.map((p, i) => h`<td><div class="third"><i style="width:${p}%"></i><span>${p}%</span></div></td>`)}</tr>`;
  };
  return h`<h3 class="maph">Where they played</h3>
    <div class="scroll"><table class="t fx" style="max-width:640px"><colgroup><col><col style="width:22%"><col style="width:22%"><col style="width:22%"></colgroup>
    <tr><th></th><th>own third</th><th>middle</th><th>final third</th></tr>
    ${row("home", m.home.name)}${row("away", m.away.name)}</table></div>
    <p class="sub">Share of each side's logged actions (shots, free kicks won, corners, offsides) in each third, seen from their own end.</p>`;
}

// one player's match, attacking left to right
export function playerMap(m, pid) {
  const shots = (m.shots || []).filter((s) => s.pid === pid);
  const acts = (m.acts || []).filter((a) => a[5] === pid && ["fw", "fc", "off"].includes(a[2]));
  if (!shots.length && !acts.length) return h`<p class="sub">Nothing with a position for him in the commentary.</p>`;
  const marks = [];
  for (const s of shots) {
    if ((s.k === "goal" || s.k === "saved") && s.x2 != null) marks.push(`<line class="trail" x1="${X(s.x).toFixed(1)}" y1="${Y(s.y).toFixed(1)}" x2="${X(s.x2).toFixed(1)}" y2="${Y(s.y2).toFixed(1)}"/>`);
    marks.push(marker(shape(s.k), +X(s.x).toFixed(1), +Y(s.y).toFixed(1), "home", `${s.m} ${KIND[s.k] || s.k}`));
  }
  for (const [t, , k, x, y] of acts) {
    const kk = k === "off" ? "ofs" : k;
    marks.push(marker(kk, +X(x).toFixed(1), +Y(y).toFixed(1), "home", `${Math.floor(t / 60) + 1}' ${NAMES[kk]}`));
  }
  return h`<div class="pmap">${svg(marks.join(""), "small")}${legend(["goal", "saved", "blocked", "miss", "fw", "fc", "ofs"])}<p class="sub">Attacking left to right.</p></div>`;
}

// running xG total for both sides, goals marked
export function xgRace(m) {
  const shots = (m.shots || []).filter((s) => s.xg != null).sort((a, b) => a.t - b.t);
  if (!shots.length) return "";
  const end = Math.max(90, ...shots.map((s) => s.t / 60)) + 2;
  const tot = { home: 0, away: 0 };
  const pts = { home: [[0, 0]], away: [[0, 0]] };
  const goals = [];
  for (const s of shots) {
    if (!s.s) continue;
    pts[s.s].push([s.t / 60, tot[s.s]]);
    tot[s.s] += s.xg;
    pts[s.s].push([s.t / 60, tot[s.s]]);
    if (s.k === "goal") goals.push([s.s, s.t / 60, tot[s.s], `${s.name} ${s.m}, xG ${s.xg.toFixed(2)}`]);
  }
  pts.home.push([end, tot.home]);
  pts.away.push([end, tot.away]);
  const top = Math.max(1, tot.home, tot.away) * 1.1;
  const W2 = 300, H2 = 110, px = (t) => ((t / end) * (W2 - 20) + 16).toFixed(1), py = (v) => (H2 - 12 - (v / top) * (H2 - 20)).toFixed(1);
  const line = (side) => `<path class="race ${side}" d="${pts[side].map(([t, v], i) => `${i ? "L" : "M"}${px(t)} ${py(v)}`).join("")}"/>`;
  const grid = [15, 30, 45, 60, 75, 90].map((t) => `<line class="mo-tick" x1="${px(t)}" x2="${px(t)}" y1="4" y2="${H2 - 12}"/><text x="${px(t)}" y="${H2 - 2}" text-anchor="middle">${t}'</text>`).join("");
  const ys = [0.5, 1, 1.5, 2, 2.5, 3, 4].filter((v) => v < top).map((v) => `<text x="1" y="${(+py(v) + 2).toFixed(1)}">${v}</text>`).join("");
  const dots = goals.map(([side, t, v, tip]) => `<circle class="race-goal ${side}" cx="${px(t)}" cy="${py(v)}" r="2.6"><title>${esc(tip)}</title></circle>`).join("");
  return h`<h3 class="maph">xG race</h3>
    ${raw(`<svg class="momentum race-svg" viewBox="0 0 ${W2} ${H2}" role="img" aria-label="xG race">${grid}${ys}${line("away")}${line("home")}${dots}</svg>`)}
    <div class="mapcap"><span>solid: ${esc(m.home.name)} ${tot.home.toFixed(2)}</span><span>dashed: ${esc(m.away.name)} ${tot.away.toFixed(2)}</span></div>
    <p class="sub">Each step is a shot, sized by its xG. Circles are goals. A side well above the other for long spells made the better chances, whatever the score says.</p>`;
}
