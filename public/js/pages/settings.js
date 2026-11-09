// 600 SETTINGS. Everything lives in this browser's storage.
import { api, prefs, savePrefs, store, applyTheme, h, userTz, inSpain, flash, TEAMS } from "../core.js?v=10";
import { beep } from "../alerts.js?v=10";
import { put, box, pagehead } from "../ui.js?v=10";

export async function settings(el, onTeamChange) {
  const notif = !("Notification" in window) ? "not supported in this browser" : Notification.permission;
  const src = await api("/api/sources", { ttl: 3600 }).catch(() => null);
  const all = [...(src?.journalists || []), ...(src?.outlets || [])];
  const baseTier = (n) => all.find((x) => x.name === n)?.tier;
  const tierFor = (n) => prefs.tierOverride[n] || baseTier(n);
  const opt = (k, v, label) => h`<label><input type="radio" name="${k}" value="${v}" ${String(prefs[k]) === String(v) ? "checked" : ""}> ${label}</label>`;

  put(el, h`${pagehead("Settings", "saved in this browser only")}
    <div class="cols"><div>
      ${box("team", h`<div class="row">${Object.entries(TEAMS).map(([k, t]) => opt("team", k, t.name))}</div>
        <p class="sub">Castilla coverage is thin: ESPN doesn't carry Primera Federación, so you'll mostly see friendlies.</p>`)}
      ${box("look", h`<div class="row">${opt("theme", "auto", "follow my device")}${opt("theme", "light", "light")}${opt("theme", "dark", "dark grey")}${opt("theme", "amoled", "pure black")}</div>`)}
      ${box("times", h`<div class="row">${opt("times", "both", "mine and Madrid")}${opt("times", "local", "just mine")}${opt("times", "madrid", "just Madrid")}</div>
        <p class="sub">Your timezone: ${userTz}${inSpain ? " (that's Spain, so Madrid time is your time)" : ""}</p>`)}
      ${box("match day", h`
        <div class="row"><label><input type="checkbox" id="alerts" ${prefs.alerts ? "checked" : ""}> notifications for kick-off, goals, red cards, half-time and full-time</label> <span class="sub">(${notif})</span></div>
        <div class="row"><label><input type="checkbox" id="beep" ${prefs.beep ? "checked" : ""}> beep on goals</label> <button type="button" id="testbeep">test</button></div>
        <div class="row"><label><input type="checkbox" id="spoilers" ${prefs.spoilers ? "checked" : ""}> spoiler mode: hide scores until I click</label></div>
        <p class="sub">Alerts work while rmtrack is open in a tab, even in the background. On a phone, add it to your home screen.</p>`)}
    </div><aside>
      ${box("news sources", h`
        <p class="sub">How much you trust each source. A trusted, B solid, C pinch of salt.</p>
        <table class="t">${all.map((s) => h`<tr><td>${s.name}</td><td class="nowrap">${["A", "B", "C"].map((t) => h`<label><input type="radio" name="tier:${s.name}" value="${t}" ${tierFor(s.name) === t ? "checked" : ""}> ${t}</label> `)}</td></tr>`)}</table>
        <p><label for="who">Extra journalists, comma separated</label><br><input type="text" id="who" class="wide" value="${prefs.who}" placeholder="e.g. Guillermo Rai"></p>
        <p><label for="bsky">Extra Bluesky accounts, comma separated</label><br><input type="text" id="bsky" class="wide" value="${prefs.bsky}" placeholder="someone.bsky.social"></p>
        <button type="button" id="savesrc">save sources</button>`)}
      ${box("your data", h`<p>Your ratings for ${Object.keys(store("fanidx") || {}).length} match(es), ${(store("pins") || []).length} pinned item(s).</p>
        <button type="button" id="export">download as JSON</button> <button type="button" id="wipe">clear everything</button>`)}
    </aside></div>`);

  el.querySelectorAll("input[type=radio][name=team], input[type=radio][name=theme], input[type=radio][name=times]").forEach((r) =>
    r.addEventListener("change", () => {
      prefs[r.name] = r.value;
      savePrefs();
      applyTheme();
      if (r.name === "team") onTeamChange();
    }));
  const toggle = (id, then) => el.querySelector("#" + id).addEventListener("change", (e) => { prefs[id] = e.target.checked; savePrefs(); then?.(e); });
  toggle("beep");
  toggle("spoilers");
  toggle("alerts", async (e) => {
    if (!e.target.checked || !("Notification" in window) || Notification.permission === "granted") return;
    if ((await Notification.requestPermission()) !== "granted") {
      prefs.alerts = false;
      savePrefs();
      e.target.checked = false;
      flash("Notifications are blocked for this site in your browser settings.");
    }
  });
  el.querySelector("#testbeep").addEventListener("click", () => beep(4));
  el.querySelector("#savesrc").addEventListener("click", () => {
    el.querySelectorAll("input[type=radio][name^='tier:']:checked").forEach((r) => {
      const n = r.name.slice(5);
      if (r.value === baseTier(n)) delete prefs.tierOverride[n]; else prefs.tierOverride[n] = r.value;
    });
    prefs.who = el.querySelector("#who").value.split(",").map((s) => s.trim()).filter(Boolean).join(", ");
    prefs.bsky = el.querySelector("#bsky").value.split(",").map((s) => s.trim().replace(/^@/, "")).filter(Boolean).join(",");
    savePrefs();
    flash("Saved. The news page picks it up on its next refresh.");
  });
  el.querySelector("#export").addEventListener("click", () => {
    const dump = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith("rm:")) dump[k] = localStorage.getItem(k);
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(dump, null, 1)], { type: "application/json" }));
    a.download = "rmtrack-data.json";
    a.click();
  });
  el.querySelector("#wipe").addEventListener("click", () => {
    if (!confirm("Clear your settings, ratings and pins from this browser?")) return;
    Object.keys(localStorage).filter((k) => k.startsWith("rm:")).forEach((k) => localStorage.removeItem(k));
    location.reload();
  });
}
