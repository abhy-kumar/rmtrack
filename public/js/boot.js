// Runs before first paint so a dark theme never flashes white.
try {
  const p = JSON.parse(localStorage.getItem("rm:prefs") || "{}");
  let t = p.theme || "auto";
  if (t === "auto") t = matchMedia("(prefers-color-scheme: dark)").matches ? "amoled" : "light";
  document.documentElement.dataset.theme = t;
} catch {
  document.documentElement.dataset.theme = "light";
}
