// Little pixel shirts in each club's colours, shaded with ordered dithering
// the way 256-colour screens used to fake gradients. Drawn as crisp SVG
// rects, so they stay sharp at any size and cost nothing to load.
import { api, raw, team, prefs } from "./core.js?v=11";

let colours = {};

const STORE = "rm:kits";

// keeps the last copy so shirts are there on first paint next time
export function loadKits() {
  try {
    const c = JSON.parse(localStorage.getItem(STORE) || "null");
    if (c?.team === team().id) colours = c.v;
  } catch { /* nothing cached */ }
  return api(`/api/kits?team=${encodeURIComponent(prefs.team)}`, { ttl: 86400 })
    .then((v) => {
      colours = v || {};
      try { localStorage.setItem(STORE, JSON.stringify({ team: team().id, v: colours })); } catch { /* full */ }
    })
    .catch(() => {});
}

// 16 x 14. o outline, P body, S trim (collar, cuffs, hem), . nothing
const SHIRT = [
  "....oo....oo....",
  "..ooPPoSSoPPoo..",
  ".oPPPPPooPPPPPo.",
  "oPPPPPPPPPPPPPPo",
  "oSSPPPPPPPPPPSSo",
  "oooPPPPPPPPPPooo",
  "..oPPPPPPPPPPo..",
  "..oPPPPPPPPPPo..",
  "..oPPPPPPPPPPo..",
  "..oPPPPPPPPPPo..",
  "..oPPPPPPPPPPo..",
  "..oPPPPPPPPPPo..",
  "..oSSSSSSSSSSo..",
  "..oooooooooooo..",
];
const W = 16, H = SHIRT.length;

// 4x4 Bayer matrix, the classic ordered-dither threshold map
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]].map((r) => r.map((v) => (v + 0.5) / 16));

const rgb = (hex) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c) => "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// a darker (or, for very dark kits, lighter) shade to dither against
function shadeOf(c) {
  return lum(c) < 0.18 ? mix(c, [255, 255, 255], 0.25) : mix(c, [0, 0, 0], 0.3);
}

const FALLBACK = { home: ["d4d4d4", "8a8a8a"], away: ["5a5a5a", "b0b0b0"] };

export function kitColours(side, which = "home") {
  const k = side?.kit || colours[side?.id] || FALLBACK[which] || FALLBACK.home;
  return k;
}

// readable number colour on top of the shirt
export const inkOn = (hex) => (lum(rgb(hex)) > 0.55 ? "#111111" : "#ffffff");

const cache = new Map();

function shirtSvg(primary, trim, size, label) {
  const key = `${primary}${trim}${size}${label}`;
  if (cache.has(key)) return cache.get(key);
  const P = rgb(primary), S = rgb(trim);
  // trim the same as the body would vanish, so fall back to a shade
  const T = Math.abs(lum(P) - lum(S)) < 0.08 ? shadeOf(P) : S;
  const pal = { P: [toHex(P), toHex(shadeOf(P))], S: [toHex(T), toHex(shadeOf(T))] };
  const runs = [];
  for (let y = 0; y < H; y++) {
    let cur = null, start = 0;
    const flush = (x) => { if (cur) runs.push([start, y, x - start, cur]); };
    for (let x = 0; x <= W; x++) {
      const ch = SHIRT[y][x];
      let fill = null;
      if (ch === "o") fill = "currentColor";
      else if (ch === "P" || ch === "S") {
        // light from the top left: the further down and right, the more shade pixels
        const t = Math.max(0, (x / W) * 0.6 + (y / H) * 0.75 - 0.5);
        fill = pal[ch][t > BAYER[y % 4][x % 4] ? 1 : 0];
      }
      if (fill !== cur) { flush(x); cur = fill; start = x; }
    }
  }
  const h = Math.round((size * H) / W);
  const svg = `<svg class="kit" width="${size}" height="${h}" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges" aria-hidden="true">${runs.map(([x, y, w, f]) => `<rect x="${x}" y="${y}" width="${w}" height="1" fill="${f}"/>`).join("")}${label}</svg>`;
  cache.set(key, svg);
  return svg;
}

// side: a team object with id (and maybe kit); which: "home" or "away" for the fallback greys
export function kit(side, size = 16, which = "home") {
  const [a, b] = kitColours(side, which);
  return raw(shirtSvg(a, b, size, ""));
}

// a shirt with a squad number on it, for the line-ups
export function numberedKit(side, no, size = 30, which = "home") {
  const [a, b] = kitColours(side, which);
  const label = `<text x="8" y="10.4" text-anchor="middle" font-size="6.2" font-weight="700" font-family="Iosevka, monospace" fill="${inkOn(a)}" stroke="#${a}" stroke-width="1.4" paint-order="stroke">${String(no ?? "").replace(/[^0-9]/g, "").slice(0, 2)}</text>`;
  return raw(shirtSvg(a, b, size, label));
}
