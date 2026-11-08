// One-off: run in a browser tab on fotmob.com. Pairs FotMob's published
// ratings with the event counts our reader pulls from ESPN commentary.
// Mirrors app/events.py; keep the two in step if either changes.
const PAIRS = [
  ["esp.1", 401882808, 5868129], ["uefa.champions", 401915383, 6106401],
  ["esp.1", 401882819, 5868118], ["esp.1", 401882832, 5868105],
  ["uefa.champions", 401915313, 6106244], ["esp.1", 401882839, 5868098],
  ["uefa.champions", 401915414, 6106274], ["esp.1", 401882848, 5868089],
  ["esp.1", 401882865, 5868072], ["esp.1", 401882872, 5868065],
  ["esp.1", 401882880, 5868057], ["uefa.champions", 401915451, 6106242],
  ["esp.1", 401882894, 5868043], ["esp.1", 401882899, 5868038],
  ["esp.1", 401882919, 5868018], ["esp.1", 401882912, 5868025],
];
const norm = s => (s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/-/g, " ").replace(/[^a-z ]/g, "").trim();
const KEYS = ["goals","pen_goals","assists","key_passes","sot","soff","sblk","wood","fouls_c","fouls_w","yc","rc","offs","hand","pen_won","pen_conc","pen_miss","own_goals","saves","pen_saves","corners_conc","scored_on","conceded_on"];
function posGroup(a) {
  a = (a || "").toUpperCase();
  if (a === "G" || a === "GK") return "GK";
  if (/^(CD|LB|RB|LWB|RWB|SW)/.test(a) || a === "D") return "DEF";
  if (/^(DM|CM|LM|RM)/.test(a) || a === "M") return "MID";
  if (/^(AM|F|CF|LF|RF|LW|RW|S)/.test(a)) return "ATT";
  return "MID";
}
function read(s) {
  const all = [], byName = {}, byLast = {};
  for (const r of s.rosters || []) for (const p of r.roster) {
    const rec = { id: p.athlete.id, name: p.athlete.displayName, team: String(r.team.id), starter: !!p.starter, pos: p.position?.abbreviation || "", on: p.starter ? 0 : null, off: null, ev: Object.fromEntries(KEYS.map(k => [k, 0])) };
    all.push(rec); byName[norm(rec.name)] = rec;
    const last = norm(rec.name).split(" ").pop();
    (byLast[rec.team + "|" + last] ||= []).push(rec); (byLast["|" + last] ||= []).push(rec);
  }
  const find = (name, team) => { if (!name) return null; const n = norm(name); if (byName[n]) return byName[n]; const l = n.split(" ").pop(); const h = byLast[(team || "") + "|" + l] || byLast["|" + l] || []; return h.length === 1 ? h[0] : null; };
  const teamBy = {};
  for (const c of s.header.competitions[0].competitors) teamBy[norm(c.team.displayName)] = String(c.team.id || c.id);
  const ents = [...(s.commentary || [])].sort((a, b) => a.sequence - b.sequence);
  let lastT = 0; const goals = [];
  for (const c of ents) {
    const text = (c.text || "").trim(), play = c.play || {}, kind = play.type?.type || "";
    const t = c.time?.value || play.clock?.value || lastT; lastT = Math.max(lastT, t || 0);
    const team = teamBy[norm(play.team?.displayName)];
    const names = (play.participants || []).map(p => p.athlete?.displayName);
    const bump = (n, k, tm = team) => { const r = find(n, tm); if (r) r.ev[k]++; return r; };
    let m;
    if (kind === "goal" || text.startsWith("Goal!")) {
      const own = text.toLowerCase().includes("own goal");
      const sc = names.length ? find(names[0], own ? null : team) : null;
      let st;
      if (own && sc) { sc.ev.own_goals++; st = Object.values(teamBy).find(x => x !== sc.team) || team; }
      else { st = team || sc?.team; if (sc) { sc.ev.goals++; if (text.toLowerCase().includes("penalty")) sc.ev.pen_goals++; } if (names.length > 1) bump(names[1], "assists"); }
      goals.push([t, st]); continue;
    }
    if (kind === "substitution" || text.startsWith("Substitution")) {
      m = text.match(/Substitution, [^.]+\. (.+?) replaces (.+?)(?: because|\.|$)/);
      const [onN, offN] = names.length >= 2 ? names : (m ? [m[1], m[2]] : [null, null]);
      const off = find(offN, team), on = find(onN, team);
      if (off) off.off = t;
      if (on) { on.on = t; if (off && (!on.pos || on.pos === "SUB")) on.pos = off.pos; }
      continue;
    }
    if (kind.startsWith("shot") || /^(Attempt|Penalty saved|Penalty missed)/.test(text) || text.includes(" hits the ")) {
      const sh = names.length ? find(names[0], team) : null; const low = text.toLowerCase();
      if (sh) {
        if (/^Penalty (saved|missed)/.test(text)) sh.ev.pen_miss++;
        else if (text.includes(" hits the ") && (low.includes("post") || low.includes("bar"))) sh.ev.wood++;
        else if (text.startsWith("Attempt saved") || kind === "shot-on-target") sh.ev.sot++;
        else if (text.startsWith("Attempt blocked") || kind === "shot-blocked") sh.ev.sblk++;
        else sh.ev.soff++;
      }
      if (names.length > 1 && text.includes("Assisted by")) bump(names[1], "key_passes");
      m = text.match(/saved .*?by (.+?) \(/);
      if (m) { const k = find(m[1]); if (k) k.ev[text.startsWith("Penalty saved") ? "pen_saves" : "saves"]++; }
      continue;
    }
    if (kind === "foul" || text.startsWith("Foul by") || text.includes("wins a free kick")) {
      if ((m = text.match(/^Foul by (.+?) \(/))) bump(m[1], "fouls_c");
      if ((m = text.match(/^(.+?) \([^)]*\) wins a free kick/))) bump(m[1], "fouls_w");
      continue;
    }
    if (kind === "yellow-card" || kind === "red-card" || text.includes("is shown the")) {
      const r = names.length ? find(names[0], team) : null;
      if (r) { if (text.includes("second yellow") || kind === "red-card" || text.includes("red card")) { r.ev.rc++; if (r.off === null) r.off = t; } else r.ev.yc++; }
      continue;
    }
    if ((m = text.match(/Penalty conceded by (.+?) \(/))) { bump(m[1], "pen_conc"); continue; }
    if ((m = text.match(/(?:\. |^)([^.]+?) draws a foul in the penalty area/))) { bump(m[1], "pen_won"); continue; }
    if ((m = text.match(/(?:, but |\. )([^.,]+?) is caught offside/))) { bump(m[1], "offs"); continue; }
    if ((m = text.match(/^Handball by (.+?) \(/))) { bump(m[1], "hand"); continue; }
    if (text.startsWith("Corner,") && (m = text.match(/Conceded by (.+?)\.$/))) bump(m[1], "corners_conc", null);
  }
  const end = Math.max(lastT, 5400);
  for (const p of all) {
    if (p.on === null) continue;
    const off = p.off !== null ? p.off : end; p.seconds = Math.max(0, off - p.on);
    for (const [gt, tm] of goals) if (p.on <= gt && gt <= off) { if (tm === p.team) p.ev.scored_on++; else p.ev.conceded_on++; }
  }
  // final result per team
  const sc = {}; for (const c of s.header.competitions[0].competitors) sc[String(c.team.id || c.id)] = +c.score;
  const box = {}; for (const t of s.boxscore?.teams || []) box[String(t.team.id)] = Object.fromEntries(t.statistics.map(x => [x.name, +x.displayValue]));
  return { all, sc, box };
}
async function fotmob(id) {
  const html = await (await fetch(`/match/${id}`)).text();
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
  const j = JSON.parse(m[1]); const ps = j.props.pageProps.content.playerStats || {};
  return Object.values(ps).map(p => ({ name: p.name, team: p.teamName, rating: p.stats?.[0]?.stats?.["FotMob rating"]?.stat?.value, min: p.stats?.[0]?.stats?.["Minutes played"]?.stat?.value }));
}
const rows = [];
for (const [lg, eid, fid] of PAIRS) {
  const s = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${lg}/summary?event=${eid}`)).json();
  const { all, sc, box } = read(s);
  const fm = await fotmob(fid);
  const fmBy = {}; for (const f of fm) fmBy[norm(f.name)] = f;
  const fmLast = {}; for (const f of fm) (fmLast[norm(f.name).split(" ").pop()] ||= []).push(f);
  for (const p of all) {
    if (!p.seconds || p.seconds < 600) continue;
    let f = fmBy[norm(p.name)]; if (!f) { const h = fmLast[norm(p.name).split(" ").pop()] || []; if (h.length === 1) f = h[0]; }
    if (!f || f.rating == null) continue;
    const opp = Object.keys(sc).find(k => k !== p.team);
    const res = Math.sign(sc[p.team] - sc[opp]);
    const poss = box[p.team]?.possessionPct ?? 50;
    rows.push([eid, p.name, p.team === "86" ? 1 : 0, posGroup(p.pos), Math.round(p.seconds / 60), res, poss, ...KEYS.map(k => p.ev[k]), f.rating]);
  }
}
window.__rows = rows;
["eid","name","rm","pos","min","res","poss",...KEYS,"fotmob"].join(",") + "\n" + rows.map(r => r.join(",")).join("\n");
