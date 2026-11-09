// 300 NEWS: the wire, filters first; the paste-and-translate tool folded away.
import { prefs, savePrefs, store, staticJson, h, html, esc, ago, flash } from "../core.js?v=11";
import { put, fail, loading, pagehead } from "../ui.js?v=11";
import { loadNews, newsItem, tierOf } from "../newsfeed.js?v=11";

export async function news(el) {
  const pins = store("pins") || [];
  put(el, h`${pagehead("News", "translated where needed")}
    <div class="row" id="filters">
      ${["A", "B", "C"].map((t) => h`<label><input type="checkbox" data-tier="${t}" ${prefs.tiers[t] ? "checked" : ""}> <span class="tier ${t}">${t}</span></label>`)}
      <select id="src" aria-label="source"><option value="">every source</option></select>
      <select id="dayp" aria-label="day"><option value="">latest</option></select>
      <a href="#/settings" class="sub">change sources</a>
    </div>
    <details class="tool" ${pins.length ? "open" : ""}>
      <summary>paste a tweet or a quote to translate and pin${pins.length ? ` (${pins.length} pinned)` : ""}</summary>
      <textarea id="pastebox" aria-label="link or text" placeholder="https://x.com/... or a quote in Spanish, Portuguese, whatever"></textarea>
      <div class="row"><input type="text" id="pasteby" class="grow" aria-label="who said it" placeholder="who said it (optional)"><button type="button" id="pastego">translate and pin</button></div>
      <div id="pins">${pins.map(pinHtml)}</div>
    </details>
    <div id="nl">${loading("fetching the wires")}</div>`);

  let data = null, archive = null;
  const list = el.querySelector("#nl");
  const draw = () => {
    const src = el.querySelector("#src").value;
    const shown = (archive || data?.items || []).filter((i) => prefs.tiers[tierOf(i)] && (!src || i.source === src || i.journalist === src));
    put(list, shown.length ? h`<ul class="news">${shown.map((i) => newsItem(i))}</ul>` : h`<p class="empty">Nothing matches those filters.</p>`);
  };
  try {
    data = await loadNews();
    const names = [...new Set(data.items.flatMap((i) => [i.journalist, i.source]).filter(Boolean))].sort();
    el.querySelector("#src").insertAdjacentHTML("beforeend", names.map((n) => `<option>${esc(n)}</option>`).join(""));
    if (data.failed) flash(`${data.failed} source(s) didn't answer this time.`);
    draw();
  } catch { put(list, fail("the news")); }

  staticJson(`/data/${prefs.team}/news/days.json`).then((days) => {
    if (days?.length) el.querySelector("#dayp").insertAdjacentHTML("beforeend", [...days].reverse().map((d) => `<option>${esc(d)}</option>`).join(""));
  });
  el.querySelector("#dayp").addEventListener("change", async (e) => {
    archive = e.target.value ? ((await staticJson(`/data/${prefs.team}/news/${e.target.value}.json`))?.items || []) : null;
    draw();
  });
  el.querySelector("#src").addEventListener("change", draw);
  el.querySelectorAll("[data-tier]").forEach((c) => c.addEventListener("change", () => {
    prefs.tiers[c.dataset.tier] = c.checked;
    savePrefs();
    draw();
  }));
  el.querySelector("#pastego").addEventListener("click", () => paste(el));
  el.querySelector("#pins").addEventListener("click", (e) => {
    const x = e.target.closest("[data-unpin]");
    if (!x) return;
    const all = (store("pins") || []).filter((p) => p.at !== x.dataset.unpin);
    store("pins", all);
    el.querySelector("#pins").innerHTML = all.map((p) => html(pinHtml(p))).join("");
  });
}

async function paste(el) {
  const txt = el.querySelector("#pastebox").value.trim();
  if (!txt) return;
  const isUrl = /^https?:\/\//.test(txt);
  const btn = el.querySelector("#pastego");
  btn.disabled = true;
  btn.textContent = "working...";
  try {
    const r = await fetch("/api/paste", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(isUrl ? { url: txt.slice(0, 300) } : { text: txt.slice(0, 3000) }),
    }).then((res) => res.json());
    if (r.error) throw new Error(r.error);
    const pin = { ...r, author: el.querySelector("#pasteby").value.trim() || r.author, at: new Date().toISOString() };
    const all = [pin, ...(store("pins") || [])].slice(0, 30);
    store("pins", all);
    el.querySelector("#pins").innerHTML = all.map((p) => html(pinHtml(p))).join("");
    el.querySelector("#pastebox").value = "";
  } catch {
    flash(isUrl ? "Couldn't read that link. X sometimes blocks it; paste the text instead." : "Translation failed, try again in a minute.");
  } finally {
    btn.disabled = false;
    btn.textContent = "translate and pin";
  }
}

function pinHtml(p) {
  const same = (p.text_en || "").trim().toLowerCase() === (p.text || "").trim().toLowerCase();
  return h`<div class="pin"><button type="button" class="x" data-unpin="${p.at}" aria-label="remove">x</button>
    <div>${p.text_en || p.text}</div>
    ${!same ? h`<div class="orig">${p.text}</div>` : ""}
    <div class="by">${p.author || "unknown"}, pinned ${ago(p.at)}${p.url ? h`, <a href="${p.url}" target="_blank" rel="noopener noreferrer">source</a>` : ""}</div></div>`;
}
