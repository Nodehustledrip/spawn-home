"use strict";

/**
 * Style presets — a deterministic CSS theme layer appended to styles.css between markers.
 * No model call: instant, free, reversible (re-applying replaces the layer; "original" removes it).
 * It re-points the site's own :root custom properties (classified by name) and adds a small set of
 * typography / shape / depth rules so any generated site visibly takes on the preset.
 */

const START = "/* spawn-style-preset:start */";
const END = "/* spawn-style-preset:end */";

const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, "Times New Roman", serif';
const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const ROUNDED = 'ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", "Arial Rounded MT Bold", system-ui, sans-serif';
const HEAVY = '"Arial Black", "Helvetica Neue", Impact, ui-sans-serif, system-ui, sans-serif';

const PRESETS = {
  luxury: {
    label: "Luxury",
    blurb: "Serif display, ivory and gold, quiet depth",
    font: SANS, head: SERIF, headWeight: 500, tracking: "-0.01em", headCase: "none",
    radius: "4px", btnRadius: "2px", space: 1.12,
    dark: { bg: "#0e0d0b", surface: "#17150f", text: "#f3ede1", muted: "#b5ab97", accent: "#c9a45c", accentInk: "#15120b", border: "rgba(201,164,92,.22)" },
    light: { bg: "#f8f4ec", surface: "#fffdf8", text: "#1d1a14", muted: "#6c6455", accent: "#9a7635", accentInk: "#fffdf8", border: "rgba(154,118,53,.25)" },
    shadow: "0 1px 2px rgba(0,0,0,.18), 0 24px 60px -28px rgba(0,0,0,.45)",
  },
  playful: {
    label: "Playful",
    blurb: "Rounded type, candy colour, bouncy shapes",
    font: ROUNDED, head: ROUNDED, headWeight: 800, tracking: "-0.015em", headCase: "none",
    radius: "22px", btnRadius: "999px", space: 1.04,
    dark: { bg: "#1a1033", surface: "#251848", text: "#fff6fb", muted: "#cdbfe6", accent: "#ff6fb1", accentInk: "#1a1033", border: "rgba(255,111,177,.28)" },
    light: { bg: "#fff8ef", surface: "#ffffff", text: "#2a1b4a", muted: "#6d5f8a", accent: "#ff4f9a", accentInk: "#ffffff", border: "rgba(255,79,154,.25)" },
    shadow: "0 10px 0 -4px rgba(0,0,0,.12), 0 18px 40px -18px rgba(0,0,0,.35)",
  },
  minimal: {
    label: "Minimal",
    blurb: "Quiet neutrals, hairlines, lots of air",
    font: SANS, head: SANS, headWeight: 600, tracking: "-0.025em", headCase: "none",
    radius: "10px", btnRadius: "8px", space: 1.18,
    dark: { bg: "#0b0b0c", surface: "#131315", text: "#ededee", muted: "#8e8e93", accent: "#ededee", accentInk: "#0b0b0c", border: "rgba(255,255,255,.09)" },
    light: { bg: "#ffffff", surface: "#fafafa", text: "#111113", muted: "#6b6b72", accent: "#111113", accentInk: "#ffffff", border: "rgba(0,0,0,.08)" },
    shadow: "none",
  },
  bold: {
    label: "Bold",
    blurb: "Heavy display type, high contrast, punchy",
    font: SANS, head: HEAVY, headWeight: 900, tracking: "-0.035em", headCase: "none",
    radius: "0px", btnRadius: "0px", space: 1,
    dark: { bg: "#0a0a0a", surface: "#161616", text: "#ffffff", muted: "#b9b9b9", accent: "#ffe500", accentInk: "#0a0a0a", border: "rgba(255,255,255,.22)" },
    light: { bg: "#fffef5", surface: "#ffffff", text: "#0a0a0a", muted: "#3d3d3d", accent: "#ff3b1f", accentInk: "#ffffff", border: "#0a0a0a" },
    shadow: "6px 6px 0 0 currentColor",
  },
  dark: {
    label: "Dark",
    blurb: "Deep graphite with a cool glow, always dark",
    font: SANS, head: SANS, headWeight: 700, tracking: "-0.02em", headCase: "none",
    radius: "14px", btnRadius: "10px", space: 1.06,
    dark: { bg: "#07090d", surface: "#10141c", text: "#e8edf5", muted: "#8b95a7", accent: "#7cc4ff", accentInk: "#07090d", border: "rgba(124,196,255,.16)" },
    light: null, // stays dark under the light toggle too
    shadow: "0 1px 0 rgba(255,255,255,.04) inset, 0 20px 50px -24px rgba(0,0,0,.8)",
  },
};

function strip(css) {
  const s = String(css || "");
  const a = s.indexOf(START);
  if (a === -1) return s;
  const b = s.indexOf(END, a);
  const tail = b === -1 ? "" : s.slice(b + END.length);
  return (s.slice(0, a).replace(/\s+$/, "") + tail.replace(/^\s+/, "\n")).replace(/\n*$/, "\n");
}

function current(css) {
  const m = /spawn-style-preset:start \*\/\s*\/\* preset=([a-z]+)/.exec(String(css || ""));
  return m ? m[1] : null;
}

/** Custom properties declared in the site's CSS, grouped by role from their names. */
function classify(css) {
  const names = new Set();
  const re = /(--[a-z0-9_-]+)\s*:/gi;
  let m;
  while ((m = re.exec(css))) names.add(m[1].toLowerCase());
  const roles = { bg: [], surface: [], border: [], muted: [], accentInk: [], accent: [], text: [], radius: [], shadow: [], font: [], head: [] };
  names.forEach(function (n) {
    const k = n.slice(2);
    if (/radius|rounded/.test(k)) roles.radius.push(n);
    else if (/shadow|elevation/.test(k)) roles.shadow.push(n);
    else if (/font|family|typeface/.test(k)) (/head|display|title|serif/.test(k) ? roles.head : roles.font).push(n);
    else if (/glow|gradient|grad|overlay|size|space|gap|width|max|pad|ease|dur|z-|weight|leading|tracking/.test(k)) return;
    else if (/border|line|stroke|divider|outline|ring|rule|hair/.test(k)) roles.border.push(n);
    else if (/(accent|primary|brand|cta)[-_]?(ink|fg|text|contrast|on)|on[-_](accent|primary|brand)|badge-fg/.test(k)) roles.accentInk.push(n);
    else if (/accent|primary|brand|highlight|cta|link/.test(k)) roles.accent.push(n);
    else if (/surface|panel|card|elev|raised|bg[-_]?(2|alt|soft|muted|sub)|tile|well|badge-bg/.test(k)) roles.surface.push(n);
    else if (/^(bg|background|base|canvas|page|paper|body)/.test(k)) roles.bg.push(n);
    else if (/muted|soft|subtle|faint|dim|secondary|text[-_]?2|quiet|meta/.test(k)) roles.muted.push(n);
    else if (/text|fg|ink|foreground|copy|heading|body-color|color$/.test(k)) roles.text.push(n);
  });
  return roles;
}

function varBlock(roles, pal, preset) {
  const out = [];
  ["bg", "surface", "border", "muted", "accentInk", "accent", "text"].forEach(function (r) {
    roles[r].forEach(function (n) { out.push(n + ":" + pal[r]); });
  });
  roles.radius.forEach(function (n) { out.push(n + ":" + preset.radius); });
  roles.shadow.forEach(function (n) { out.push(n + ":" + preset.shadow); });
  roles.font.forEach(function (n) { out.push(n + ":" + preset.font); });
  roles.head.forEach(function (n) { out.push(n + ":" + preset.head); });
  out.push("--sp-bg:" + pal.bg, "--sp-surface:" + pal.surface, "--sp-text:" + pal.text, "--sp-muted:" + pal.muted, "--sp-accent:" + pal.accent, "--sp-accent-ink:" + pal.accentInk, "--sp-border:" + pal.border);
  return out.join(";");
}

function layer(css, id) {
  const p = PRESETS[id];
  const roles = classify(css);
  const dark = varBlock(roles, p.dark, p);
  const light = varBlock(roles, p.light || p.dark, p);
  const sec = (n) => "calc(" + n + " * " + p.space + ")";
  return [
    START,
    "/* preset=" + id + " — added by a one-tap style preset; pick “Original” to remove */",
    ":root{" + dark + ";color-scheme:dark}",
    ':root[data-theme="dark"]{' + dark + "}",
    ':root[data-theme="light"]{' + light + ";color-scheme:" + (p.light ? "light" : "dark") + "}",
    "html body{background:var(--sp-bg) !important;color:var(--sp-text) !important;font-family:" + p.font + " !important}",
    "body :is(h1,h2,h3,h4){font-family:" + p.head + " !important;font-weight:" + p.headWeight + " !important;letter-spacing:" + p.tracking + ";text-transform:" + p.headCase + ";color:var(--sp-text)}",
    "body :is(p,li,dd,small,figcaption,label){font-family:" + p.font + "}",
    "body :is(header,nav,footer){border-color:var(--sp-border) !important}",
    "body section{padding-block:" + sec("clamp(56px,8vw,112px)") + "}",
    "body :is(header,footer,nav){background-color:color-mix(in srgb,var(--sp-bg) 86%,transparent) !important}",
    'body :is([class*="card"],[class*="tile"],[class*="panel"],details,article){background-color:var(--sp-surface) !important;border-color:var(--sp-border) !important;border-radius:' + p.radius + " !important;box-shadow:" + p.shadow + " !important}",
    'body :is(button,[class*="btn"],[class*="button"],input[type="submit"]):not([data-theme-toggle]):not([data-nav-toggle]){border-radius:' + p.btnRadius + " !important}",
    'body :is([class*="btn-primary"],[class*="primary"],[class*="cta"],button[type="submit"],input[type="submit"]){background:var(--sp-accent) !important;color:var(--sp-accent-ink) !important;border-color:var(--sp-accent) !important}',
    "body :is(input,textarea,select){border-radius:" + p.radius + " !important;border-color:var(--sp-border) !important;background-color:var(--sp-surface) !important;color:var(--sp-text) !important}",
    "body a:not([class]){color:var(--sp-accent)}",
    "body :is(p,li,dd,small,figcaption)[class*=\"muted\"],body [class*=\"lede\"],body [class*=\"sub\"]{color:var(--sp-muted) !important}",
    "::selection{background:var(--sp-accent);color:var(--sp-accent-ink)}",
    END,
  ].join("\n");
}

/** Returns styles.css with the preset layer applied (or removed for "original"). */
function apply(css, id) {
  const base = strip(css);
  if (id === "original" || !id) return base;
  if (!PRESETS[id]) throw Object.assign(new Error("Unknown style preset"), { status: 400 });
  return base.replace(/\s*$/, "\n\n") + layer(base, id) + "\n";
}

function list() {
  return Object.keys(PRESETS).map(function (k) {
    const p = PRESETS[k];
    return { id: k, label: p.label, blurb: p.blurb, swatch: [p.dark.bg, p.dark.surface, p.dark.accent, p.light ? p.light.bg : p.dark.text] };
  });
}

module.exports = { apply, strip, current, classify, list, PRESETS, START, END };
