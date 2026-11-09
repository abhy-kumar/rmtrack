// This season's competitive games for the selected team: the static
// archive plus anything newer from the API, merged by match id.
import { api, staticJson, prefs } from "./core.js?v=7";

const memo = {};

export async function seasonData(teamKey = prefs.team) {
  if (memo[teamKey] && Date.now() - memo[teamKey].t < 600e3) return memo[teamKey].v;
  const arch = (await staticJson(`/data/${teamKey}/index.json`)) || { matches: [], names: {} };
  const skip = arch.matches.map((m) => m.id).sort().join(",");
  let fresh = { matches: [], names: {} };
  try {
    fresh = await api(`/api/season?team=${teamKey}${skip ? "&skip=" + skip : ""}`, { ttl: 600, timeout: 30000 });
  } catch { /* archive alone is still useful */ }
  const byId = {};
  [...arch.matches, ...fresh.matches].forEach((m) => (byId[m.id] = m));
  const v = {
    matches: Object.values(byId).sort((a, b) => (a.date || "").localeCompare(b.date || "")),
    names: { ...fresh.names, ...arch.names },
  };
  memo[teamKey] = { t: Date.now(), v };
  return v;
}

// per-player season line from the compact match rows [r, mins, g, a, y, rc, started]
export function playerSeason(s, pid) {
  const games = s.matches.filter((m) => m.players[pid]).map((m) => {
    const [r, mins, g, a, y, rc, st] = m.players[pid];
    return { m, r, mins, g, a, y, rc, st };
  });
  const rated = games.filter((x) => x.r != null);
  const sum = (k) => games.reduce((t, x) => t + x[k], 0);
  return {
    games,
    apps: games.length,
    starts: games.filter((x) => x.st).length,
    mins: sum("mins"), g: sum("g"), a: sum("a"), y: sum("y"),
    avg: rated.length ? rated.reduce((t, x) => t + x.r, 0) / rated.length : null,
    motm: games.filter((x) => x.m.motm === pid).length,
  };
}
