// News helpers shared by the home page, the news page and the ticker.
import { api, prefs, h, esc, ago } from "./core.js?v=10";
import { live } from "./alerts.js?v=10";
import { revealed } from "./ui.js?v=10";

export const tierOf = (item) =>
  prefs.tierOverride[item.journalist] || prefs.tierOverride[item.source] || item.tier || "C";

export const visible = (items) => items.filter((i) => prefs.tiers[tierOf(i)]);

export function newsUrl() {
  const q = new URLSearchParams({ team: prefs.team });
  if (prefs.bsky) q.set("bsky", prefs.bsky);
  if (prefs.who) q.set("who", prefs.who);
  return `/api/news?${q}`;
}

export const loadNews = (ttl = 120) => api(newsUrl(), { ttl });

export function newsItem(it, compact = false) {
  const t = tierOf(it);
  const byline = it.kind === "mention" ? h`citing ${it.journalist}, `
    : it.journalist && it.journalist !== it.source ? h`${it.journalist}, ` : "";
  return h`<li>
    <div class="hd"><span class="tier ${t}" title="tier ${t}">${t}</span><a href="${it.url}" target="_blank" rel="noopener noreferrer">${it.title_en || it.title}</a></div>
    ${it.title_en && !compact ? h`<div class="orig" lang="${it.lang || "es"}">${it.title}</div>` : ""}
    <div class="by">${byline}${it.source}${it.kind === "post" ? " post" : ""}, ${ago(it.published)}${it.title_en ? h`, <span title="translated from ${it.lang || "?"}">translated</span>` : ""}</div>
  </li>`;
}

export async function fillTicker() {
  const tk = document.querySelector("#ticker .tk");
  if (!tk) return;
  try {
    const n = await loadNews(300);
    const scores = live.matches.map((f) => {
      const m = live.details[f.id] || f;
      return revealed(m.id)
        ? `<b>LIVE ${esc(m.home.abbr)} ${m.home.score ?? 0}-${m.away.score ?? 0} ${esc(m.away.abbr)} ${esc(m.status.clock || "")}</b>`
        : `<b>LIVE ${esc(m.home.abbr)} v ${esc(m.away.abbr)}</b>`;
    });
    const heads = visible(n.items).slice(0, 14)
      .map((i) => `[${esc(tierOf(i))}] ${esc(i.title_en || i.title)} <i>(${esc(i.source)})</i>`);
    tk.innerHTML = [...scores, ...heads].map((s) => `<span>${s}</span>`).join("") || "<span>quiet on the wires</span>";
  } catch {
    tk.innerHTML = "<span>wires down, trying again shortly</span>";
  }
}
