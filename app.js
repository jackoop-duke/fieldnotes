// FIELDNOTES UI. Data: data/<mode>.json (docs/DATA_CONTRACT.md). Logic: engine.mjs (pure). Strings: i18n.js.
import { taskStatus, planMaps, handIns, endRaid } from "./engine.mjs";
import { makeT } from "./i18n.js";
import { renderLibrary, LIBRARY_CSS } from "./library.mjs";
import { buildIndex, prerequisiteChain, unlocksOf, exclusiveWith, keystones, unlockTotals } from "./relations.mjs";
import { STORY_TRADER, storyTasks, routesOf, onRoute, currentSteps, planView, migrateLibraryStory } from "./story.mjs";
import { storyPrerequisites, taskPrerequisites } from "./cascade.mjs";
import { CURRENCY, EDITIONS, builtLevel, floorLevel, gotKey, nextLevel, buildStatus, itemsNeeded } from "./hideout.mjs";

const MAP_COLOR = {
  customs: "--map-customs", factory: "--map-factory", interchange: "--map-interchange", woods: "--map-woods",
  shoreline: "--map-shoreline", reserve: "--map-reserve", lighthouse: "--map-lighthouse",
  "streets-of-tarkov": "--map-streets", "ground-zero": "--map-groundzero", "the-lab": "--map-lab",
  terminal: "--map-terminal", "the-labyrinth": "--map-labyrinth", icebreaker: "--map-icebreaker"
};
const TRADER_ORDER = ["story", "prapor", "therapist", "fence", "skier", "peacekeeper", "mechanic", "ragman", "jaeger",
  "ref", "lightkeeper", "btr-driver", "taran", "radio-station", "mr-kerman", "voevoda", "survivor"];
const LL_TRADERS = ["prapor", "therapist", "skier", "peacekeeper", "mechanic", "ragman", "jaeger", "ref"];

// ---------- persistence (per mode) ----------
const PREF_KEY = "fieldnotes-v2-prefs";
const MODES = ["regular", "pve", "pvp-season"];
const stateKey = (mode) => "fieldnotes-v2-state-" + mode;
const libraryKey = (mode) => "fieldnotes-v2-library-" + mode;
const memory = new Map();
let storageFailed = false;
function load(key, fallback) {
  if (memory.has(key)) return structuredClone(memory.get(key)) ?? fallback;
  try { const v = JSON.parse(localStorage.getItem(key)); memory.set(key, v); return v ?? fallback; }
  catch { return fallback; }
}
function store(key, value) {
  memory.set(key, structuredClone(value));
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { storageFailed = true; storageBanner(); return false; }
}
function storageBanner() {
  let banner = document.getElementById("storage-warning");
  if (!storageFailed) return;
  if (!banner) { banner = document.createElement("div"); banner.id = "storage-warning"; banner.className = "warn"; banner.setAttribute("role", "status"); document.getElementById("app").before(banner); }
  banner.textContent = t("storageUnavailable");
}
const validId = (id) => typeof id === "string" && /^[A-Za-z0-9#:_-]+$/.test(id) && !["__proto__", "prototype", "constructor"].includes(id);
function object(x) { if (!x || typeof x !== "object" || Array.isArray(x)) throw new TypeError("Expected object"); return x; }
function number(x, min = 0, max = Number.MAX_SAFE_INTEGER) { if (!Number.isFinite(x) || x < min || x > max) throw new TypeError("Invalid number"); return x; }
function bool(x) { if (typeof x !== "boolean") throw new TypeError("Expected boolean"); return x; }
function dict(x, normalize) { return Object.fromEntries(Object.entries(object(x)).filter(([k]) => validId(k)).map(([k, v]) => [k, normalize(v)])); }
function normalizeState(x) {
  object(x);
  const s = blankState();
  if (x.level != null) s.level = number(x.level, 1, 79);
  if (x.prestige != null) s.prestige = number(x.prestige, 0, 6);
  if (x.faction != null && !["BEAR", "USEC"].includes(x.faction)) throw new TypeError("Invalid faction");
  s.faction = x.faction ?? null;
  for (const k of ["held", "done", "prog", "ll"]) s[k] = dict(x[k] === undefined ? {} : x[k], k === "prog" ? number : k === "ll" ? (v) => number(v, 1, 4) : bool);
  s.storyRoute = dict(x.storyRoute === undefined ? {} : x.storyRoute, (v) => {
    const routes = typeof v === "string" ? [v] : v;
    if (!Array.isArray(routes) || routes.some((r) => typeof r !== "string")) throw new TypeError("Invalid routes");
    return [...new Set(routes)];
  });
  if (x.storyMigrated !== undefined) s.storyMigrated = bool(x.storyMigrated);
  s.hideout = dict(x.hideout === undefined ? {} : x.hideout, (v) => number(v, 0, 10));
  s.got = dict(x.got === undefined ? {} : x.got, (v) => number(v, 0, 1e7));
  if (x.edition != null && !Object.hasOwn(EDITIONS, x.edition)) throw new TypeError("Invalid edition");
  s.edition = x.edition ?? null;
  return s;
}
function normalizeRaid(x) {
  if (x == null) return null;
  object(x); if (!validId(x.map)) throw new TypeError("Invalid map");
  return { map: x.map, gains: dict(x.gains, number), bring: dict(x.bring, bool) };
}
function normalizeLibrary(x) {
  object(x);
  return { story: dict(x.story === undefined ? {} : x.story, bool), ach: dict(x.ach === undefined ? {} : x.ach, bool),
    collector: dict(x.collector === undefined ? {} : x.collector, (v) => {
      object(v); return Object.fromEntries(["found", "handed"].filter((k) => k in v).map((k) => [k, bool(v[k])]));
    }) };
}
function normalizePrefs(x) {
  object(x);
  const p = { mode: "regular", lang: "zh", view: "next", onlyHeld: false, q: "", open: {}, libSection: "collector",
    hideoutScope: "next", hideoutQuests: "held", hideoutFir: false, hideoutQ: "", hideoutTab: "stations", hideoutFilter: "ready", taskFilter: "all", taskGroup: "trader" };
  for (const [k, choices] of Object.entries({ mode: MODES, lang: ["zh", "en"], view: ["next", "raid", "tasks", "hideout", "library"], hideoutScope: ["next", "all"], hideoutQuests: ["held", "open"], hideoutTab: ["stations", "keep"], hideoutFilter: ["ready", "blocked", "maxed", "all"], taskFilter: ["all", "held", "available", "locked", "done"], taskGroup: ["trader", "map"], libSection: ["collector", "achievements", "prestige", "about"] })) {
    if (x[k] !== undefined) { if (!choices.includes(x[k])) throw new TypeError("Invalid preference"); p[k] = x[k]; }
  }
  if (x.onlyHeld !== undefined) p.onlyHeld = bool(x.onlyHeld);
  if (x.taskFilter === undefined && p.onlyHeld) p.taskFilter = "held";
  if (x.hideoutFir !== undefined) p.hideoutFir = bool(x.hideoutFir);
  if (x.hideoutQ !== undefined) { if (typeof x.hideoutQ !== "string") throw new TypeError("Invalid search"); p.hideoutQ = x.hideoutQ; }
  if (x.q !== undefined) { if (typeof x.q !== "string") throw new TypeError("Invalid search"); p.q = x.q; }
  if (x.open !== undefined) p.open = dict(x.open, bool);
  return p;
}
function recover(normalize, value, fallback) { try { return normalize(value); } catch { console.warn("FIELDNOTES: invalid saved record; using defaults"); return normalize(fallback); } }

const prefs = recover(normalizePrefs, load(PREF_KEY, {}), {});
const LIB_KEY = "fieldnotes-v2-library";
let libState = normalizeLibrary({});
let lib = null, rel = null, story = null, storyLinks = {};
const detailOpen = new Set();
const t = makeT(() => prefs.lang);
let data = null, fullData = null, idx = null, S = null, ui = { raid: null };
let activeMode = null, loadSequence = 0, loadingMode = false;

function blankState() { return { level: null, prestige: null, faction: null, ll: {}, held: {}, done: {}, prog: {}, hideout: {}, got: {}, edition: null }; }
function saveAll() {
  store(PREF_KEY, prefs);
  if (S && activeMode) { store(stateKey(activeMode), { state: S, raid: ui.raid }); store(libraryKey(activeMode), libState); }
}
function migrateLibrary(mode) {
  const old = load(LIB_KEY, null);
  if (!old || load(LIB_KEY + "-migrated", null)) return;
  const normalized = recover(normalizeLibrary, old, {});
  store(libraryKey(mode), load(libraryKey(mode), normalized));
  store(LIB_KEY + "-migrated", old);
  memory.set(LIB_KEY, null);
  try { localStorage.removeItem(LIB_KEY); } catch { storageFailed = true; storageBanner(); }
}

// ---------- data ----------
async function loadMode(mode) {
  const sequence = ++loadSequence;
  loadingMode = true;
  clearTimeout(qTimer);
  app.innerHTML = '<div class="loading">' + esc(t("loading")) + "</div>";
  endSlot.innerHTML = "";
  try {
    const r = await fetch("data/" + mode + ".json");
    if (!r.ok) throw new Error("HTTP " + r.status);
    const nextFull = await r.json();
    if (sequence !== loadSequence) return;
    const saved = load(stateKey(mode), null);
    const nextState = recover(normalizeState, saved?.state || {}, {});
    const nextLib = recover(normalizeLibrary, load(libraryKey(mode), {}), {});
    let nextStory = story;
    if (!nextStory) { try { const r = await fetch("data/story.json"); if (r.ok) nextStory = await r.json(); } catch { /* planner works without it */ } }
    if (sequence !== loadSequence) return;
    const links = {};
    if (nextStory) {
      nextFull.traders.push(STORY_TRADER);
      nextFull.tasks = storyTasks(nextStory).concat(nextFull.tasks);
      nextStory.chapters.forEach((c) => c.links.forEach((l) => (links[l.task] = links[l.task] || []).push({ chapter: c.id, relation: l.relation, detail: l.detail })));
    }
    validateIds(nextFull);
    dedupeObjectiveIds(nextFull);
    nextFull.tasks.forEach((tk) => { tk.searchText = (tk.name.en + " " + tk.name.zh + " " + tk.objectives.map((o) => o.text.en + " " + o.text.zh + " " + o.maps.join(" ")).join(" ")).toLowerCase(); });
    if (nextStory) migrateLibraryStory({ chapters: nextStory.chapters.filter((c) => nextFull.tasks.some((tk) => tk.id === c.id)).map((c) => ({ ...c, objectives: c.objectives.filter((o) => validId(o.id)) })) }, nextLib.story, nextState);
    const nextData = factionView(nextFull, nextState);
    const nextIndex = makeIndex(nextData), nextRel = buildIndex(nextData);
    const raid = recover(normalizeRaid, saved?.raid, null);
    // Commit once: a superseded request never changes the active data or progress.
    if (sequence !== loadSequence) return;
    fullData = nextFull; data = nextData; S = nextState; idx = nextIndex; rel = nextRel;
    story = nextStory; storyLinks = links; libState = nextLib; activeMode = mode;
    ui.raid = raid && idx.map[raid.map] ? raid : null;
    loadingMode = false;
    render();
  } catch (e) {
    if (sequence !== loadSequence) return;
    app.innerHTML = '<div class="empty" style="margin-top:24px">' + esc(t("loadFail", mode, e.message)) + "</div>";
  }
}
function factionView(d, s) { return { ...d, tasks: d.tasks.filter((tk) => !tk.legacy && (!s.faction || !tk.faction || tk.faction === s.faction)) }; }
function makeIndex(d) {
  const ix = { task: {}, obj: {}, objTask: {}, map: {}, trader: {}, traderKey: {}, stop: {} };
  d.tasks.forEach((tk) => { ix.task[tk.id] = tk; tk.objectives.forEach((o) => { ix.obj[o.id] = o; ix.objTask[o.id] = tk; }); });
  d.maps.forEach((m) => { if (!ix.map[m.group] || m.key === m.group) ix.map[m.group] = m; });
  d.traders.forEach((tr) => { ix.trader[tr.id] = tr; ix.traderKey[tr.key] = tr; });
  d.stops.forEach((s) => { ix.stop[s.id] = s; });
  return ix;
}
function validateIds(d) {
  let dropped = 0;
  const filter = (rows, ok) => rows.filter((r) => { if (ok(r)) return true; dropped++; return false; });
  d.maps = filter(d.maps, (m) => [m.id, m.key, m.group].every(validId));
  d.traders = filter(d.traders, (tr) => [tr.id, tr.key].every(validId));
  d.items = Object.fromEntries(filter(Object.entries(d.items), ([id]) => validId(id)));
  d.tasks = filter(d.tasks, (tk) => [tk.id, tk.key, tk.trader].every(validId) && d.traders.some((tr) => tr.id === tk.trader));
  d.tasks.forEach((tk) => {
    tk.requires = filter(tk.requires, (r) => validId(r.task));
    tk.failIf = filter(tk.failIf, (r) => validId(r.task));
    tk.traderLL = filter(tk.traderLL, (r) => validId(r.trader));
    tk.traderRep = filter(tk.traderRep || [], (r) => validId(r.trader));
    tk.objectives = filter(tk.objectives, (o) => [o.id, ...o.maps, ...o.items, ...o.keys.flat(), ...(o.stop ? [o.stop] : []), ...(o.questItem ? [o.questItem.id] : []), ...(o.zones || []).map((z) => z.map)].every(validId));
    tk.objectives.forEach((o) => { o.conditions = filter(o.conditions || [], (c) => [...(c.items || []), ...(c.groups || []).flat()].every(validId)); });
  });
  d.stops = filter(d.stops || [], (s) => [s.id, s.map].every(validId));
  if (dropped) console.warn("FIELDNOTES: dropped " + dropped + " records with invalid ids or references");
}
function validateLibraryIds(value) {
  let dropped = 0;
  const visit = (x) => {
    if (Array.isArray(x)) return x.filter((r) => {
      if (r && typeof r === "object" && Object.hasOwn(r, "id") && !validId(r.id)) { dropped++; return false; }
      return true;
    }).map(visit);
    if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, visit(v)]));
    return x;
  };
  const result = visit(value);
  if (dropped) console.warn("FIELDNOTES: dropped " + dropped + " library records with invalid ids");
  return result;
}

// tarkov.dev reuses objective ids across the three chained "Make Amends" tasks. Progress is keyed by
// objective id, so later copies get "<id>#<task key>"; the first (earliest id = earliest in the chain)
// keeps the raw id and any saved progress. Stops list every copy.
function dedupeObjectiveIds(d) {
  const seen = new Set(), copies = {};
  d.tasks.forEach((tk) => tk.objectives.forEach((o) => {
    if (!seen.has(o.id)) { seen.add(o.id); return; }
    const id = o.id + "#" + tk.key;
    (copies[o.id] = copies[o.id] || []).push(id);
    o.id = id;
  }));
  const live = new Set(d.tasks.flatMap((tk) => tk.objectives.map((o) => o.id)));
  (d.stops || []).forEach((s) => { s.objectives = s.objectives.flatMap((id) => [id].concat(copies[id] || [])).filter((id) => live.has(id)); });
  // Same-named tasks carry a variant label from the pipeline (faction, branch, chain position, prestige).
  d.tasks.forEach((tk) => {
    if (!tk.variant) return;
    Object.keys(tk.name).forEach((lang) => { tk.name[lang] += " (" + (tk.variant[lang] || tk.variant.en) + ")"; });
  });
}

// ---------- helpers ----------
const app = document.getElementById("app");
const endSlot = document.getElementById("endbar-slot");
function esc(s) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function L(n) { if (!n) return ""; return prefs.lang === "zh" ? (n.zh || n.en) : (n.en || n.zh); }
function mapName(g) { return idx.map[g] ? (L(idx.map[g].name) || g) : g; }
function mapColor(g) { return "var(" + (MAP_COLOR[g] || "--map-other") + ")"; }
function traderName(id) { const tr = idx.trader[id]; return tr ? L(tr.name) : "?"; }
function itemName(id) { const it = data.items[id]; return it ? L(it.name) : id; }
function need(o) { return o.count || 1; }
function have(o) { return S.prog[o.id] || 0; }
function taskName(id) { return idx.task[id] ? L(idx.task[id].name) : id; }
function raidObjectives(tk) { return tk.objectives.filter((o) => o.where === "raid" && !o.optional); }
// ---------- objective restrictions (how it counts, not what to do) ----------
const ALL_PARTS = 7;
function condList(ids, sep, max = 4) {
  const names = ids.map(itemName);
  return names.slice(0, max).join(sep) + (names.length > max ? " " + t("condMore", names.length - max) : "");
}
function condText(c, full = false) {
  const sep = prefs.lang === "zh" ? "、" : ", ";
  const parts = (ps) => ps.length >= ALL_PARTS ? t("allParts") : ps.map((p) => t("part_" + p)).join(sep);
  const hh = (h) => String(h).padStart(2, "0") + ":00";
  switch (c.kind) {
    case "weapon": return t("cond_weapon", condList(c.items, sep, full ? Infinity : 4));
    case "weaponMods": return t("cond_weaponMods", c.groups.map((g) => g.map(itemName).join(" + ")).join(t("or")));
    case "wearing": return t("cond_wearing", c.groups.map((g) => g.map(itemName).join(" + ")).join(t("or")));
    case "notWearing": return t("cond_notWearing", condList(c.items, sep, full ? Infinity : 4));
    case "bodyPart": return t("cond_bodyPart", parts(c.parts));
    case "distance": return t("cond_distance", c.compare === "<=" ? "≤" : "≥", c.value);
    case "time": return t("cond_time", hh(c.from), hh(c.until));
    default: {
      const eff = c.effects.map((e) => t("eff_" + e)).concat((c.items || []).map((id) => t("effUnder", itemName(id))));
      return t("cond_" + c.kind, eff.join(sep));
    }
  }
}
function condBox(o, full = false) {
  return o.conditions && o.conditions.length ? '<ul class="conds">' + o.conditions.map((c) => "<li>" + esc(condText(c, full)) + "</li>").join("") + "</ul>" : "";
}
function condKinds(objs) { return [...new Set(objs.flatMap((o) => (o.conditions || []).map((c) => c.kind)))]; }
function repText(tk) {
  return (tk.traderRep || []).map((r) => t("rep", traderName(r.trader), r.compare.replace(">=", "≥").replace("<=", "≤"), r.value)).join(" · ");
}

function lockText(reasons) {
  return reasons.filter((r) => r.code !== "requires").map((r) =>
    r.code === "minLevel" ? t("lockLevel", r.required) : r.code === "traderLL" ? t("lockLL", traderName(r.trader), r.required) : r.code).join(", ");
}

// ---------- render ----------
function renderChrome() {
  storageBanner();
  document.querySelector("nav.tabs").setAttribute("aria-label", t("navLabel"));
  document.getElementById("mode").setAttribute("aria-label", t("modeLabel"));
  document.documentElement.lang = prefs.lang === "zh" ? "zh-Hant" : "en";
  document.getElementById("tagline").textContent = t("tagline");
  document.getElementById("tab-next").textContent = t("tabNext");
  document.getElementById("tab-tasks").textContent = t("tabTasks");
  document.getElementById("tab-library").textContent = t("tabLibrary");
  document.getElementById("tab-hideout").textContent = t("tabHideout");
  const raidTab = document.getElementById("tab-raid");
  raidTab.disabled = !ui.raid;
  raidTab.innerHTML = esc(t("tabRaid")) + (ui.raid ? "<small>" + esc(mapName(ui.raid.map)) + "</small>" : "");
  document.querySelectorAll("nav.tabs button").forEach((b) => {
    if (b.dataset.view === prefs.view) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  document.getElementById("lvl").textContent = S.level ?? "?";
  document.querySelectorAll("#lang button").forEach((b) => {
    b.textContent = b.dataset.lang === "zh" ? "中" : "EN";
    b.setAttribute("aria-pressed", String(b.dataset.lang === prefs.lang));
  });
  document.getElementById("lang").setAttribute("aria-label", t("langLabel"));
  markMode();
  document.getElementById("datalabel").textContent = t("dataChip", data.snapshot);
  document.getElementById("datanote").innerHTML = esc(t("dataNote", "\u0000", data.snapshot))
    .replace("\u0000", '<a href="https://tarkov.dev" target="_blank" rel="noopener">tarkov.dev</a>');
}

function render() {
  if (!data || loadingMode) return;
  const focus = captureFocus();
  if (prefs.view === "raid" && !ui.raid) prefs.view = "next";
  renderChrome();
  endSlot.innerHTML = "";
  if (prefs.view === "raid") renderRaid();
  else if (prefs.view === "tasks") renderTasks();
  else if (prefs.view === "hideout") renderHideout();
  else if (prefs.view === "library") renderLib();
  else { prefs.view = "next"; renderNext(); }
  saveAll();
  restoreFocus(focus);
}

function flagsHTML(p) {
  const f = [];
  if (p.oneRaid.length) f.push('<span class="flag sameraid">' + esc(t("flagOneRaid", p.oneRaid.length)) + "</span>");
  if (p.survive.length) f.push('<span class="flag survive">' + esc(t("flagSurvive", p.survive.length)) + "</span>");
  const n = p.bring.reduce((a, b) => a + b.count, 0);
  if (n) f.push('<span class="flag bring">' + esc(t("flagBring", n)) + "</span>");
  if (p.keys.length) f.push('<span class="flag bring">' + esc(t("flagKeys", p.keys.length)) + "</span>");
  return f.length ? '<div class="flags">' + f.join("") + "</div>" : "";
}

function skipText(s) {
  if (s.code === "oneRaidSplit") return t("skipOneRaidSplit");
  if (s.code === "locked") return t("skipLocked", lockText(s.detail || []));
  if (s.code === "requires") return t("skipRequires");
  return s.code;
}

function renderNext() {
  const plans = planMaps(planView(data, S), S);
  const good = plans.filter((p) => p.onMap > 0 || p.along > 0);
  const rest = plans.filter((p) => !p.onMap && !p.along && p.skipped.length);
  const heldN = Object.keys(S.held).filter((id) => S.held[id] && !S.done[id] && idx.task[id]).length;
  let html = "<h1>" + esc(t("nextTitle")) + '</h1><p class="lede">' + esc(t("nextLede", heldN)) + "</p>";
  if (!good.length) {
    const held = data.tasks.filter((tk) => S.held[tk.id] && !S.done[tk.id]);
    const emptyKey = !heldN ? "nextEmptyNone" : held.every((tk) => taskStatus(data, S, tk.id).status === "locked") ? "nextEmptyLocked" : plans.some((p) => p.skipped.length) ? "nextEmptyBlocked" : "nextEmptyHeld";
    html += '<div class="empty" style="margin-top:20px">' + esc(t(emptyKey)) +
      '<br><br><button class="btn" data-view="tasks" type="button">' + esc(t("goPick")) + "</button></div>";
  } else {
    html += '<div class="board">';
    good.forEach((p, i) => {
      const list = p.tasks.map((it) =>
        "<li><span>" + esc(taskName(it.task)) + ' <span class="tr">' + esc(traderName(idx.task[it.task].trader)) + "</span></span>" +
        (idx.task[it.task].story ? '<span class="tr">' + esc(t("storyAdvance")) + "</span>" : it.alongOnly ? '<span class="tr">' + esc(t("along")) + "</span>" : it.finishes ? '<span class="done-all">' + esc(t("finishHere")) + "</span>" : '<span class="tr">' + esc(t("nObjectives", it.objectives.length)) + "</span>") + "</li>").join("");
      const sk = p.skipped.slice(0, 4).map((s) => '<p class="skipped"><b>' + esc(taskName(s.task)) + "</b> " + esc(t("skippedPrefix") + skipText(s)) + "</p>").join("");
      html += '<article class="mapcard"><div class="maphead" style="--c:' + esc(mapColor(p.map)) + '"><div class="name">' + esc(mapName(p.map)) + '</div><div class="rank">' + esc(i === 0 ? t("rankFirst") : t("rankN", i + 1)) + "</div></div>" +
        '<div class="mapbody"><div style="display:flex;flex-direction:column;gap:14px;min-width:0">' +
        '<div class="stats"><div class="stat"><b>' + p.onMap + "</b><span>" + esc(t("statOnMap")) + '</span></div><div class="stat"><b>' + p.tasks.filter((it) => it.finishes && !idx.task[it.task].story).length + "</b><span>" + esc(t("statFinish")) + "</span></div>" +
        (p.along ? '<div class="stat"><b>+' + p.along + "</b><span>" + esc(t("statAlong")) + "</span></div>" : "") + "</div>" + flagsHTML(p) +
        '<button class="btn" type="button" data-go="' + esc(p.map) + '">' + esc(t("goRaid")) + "</button></div>" +
        '<div style="display:flex;flex-direction:column;gap:10px;min-width:0"><ul class="tasklist">' + list + "</ul>" + sk + "</div></div></article>";
    });
    html += "</div>";
  }
  if (rest.length) {
    html += '<div class="section-label">' + esc(t("notRecommended")) + '</div><div class="others">' + rest.map((p) =>
      '<span class="othermap">' + esc(mapName(p.map)) + ": " + esc(p.skipped.map((s) => taskName(s.task) + " " + skipText(s)).join("; ")) + "</span>").join("") + "</div>";
  }
  const ks = keystones(rel, S, 5).filter((k) => k.total > 0);
  if (ks.length) {
    html += '<div class="section-label">' + esc(t("keystoneTitle")) + '</div><div class="handin keystones"><ul>' + ks.map((k) =>
      "<li><span>" + esc(taskName(k.task)) + ' <span class="tr">' + esc(traderName(idx.task[k.task].trader)) + '</span></span><span style="color:var(--muted);font-size:13px;white-space:nowrap">' + esc(t("keystoneLine", k.direct, k.total)) + "</span></li>").join("") + "</ul></div>";
  }
  const h = handIns(planView(data, S), S);
  if (h.length) {
    html += '<div class="section-label">' + esc(t("handIn")) + '</div><div class="handin"><ul>' + h.map((x) =>
      "<li><span>" + esc(L(idx.obj[x.objective].text)) + '</span><span style="color:var(--muted);font-size:13px">' + esc(taskName(x.task)) + " · " + esc(traderName(idx.task[x.task].trader)) + "</span></li>").join("") + "</ul></div>";
  }
  app.innerHTML = html;
}

function objRow(o) {
  const tk = idx.objTask[o.id];
  const gain = ui.raid.gains[o.id] || 0;
  const tag = '<span class="tasktag">' + esc(L(tk.name)) + "</span>";
  const notes = [];
  if (o.survive) notes.push('<span class="meta" style="color:var(--survive)">' + esc(t("noteSurvive")) + "</span>");
  if (o.oneRaid) notes.push('<span class="meta" style="color:var(--sameraid)">' + esc(t("noteOneRaid")) + "</span>");
  if (o.keys && o.keys.length) notes.push('<span class="meta">' + esc(t("noteKeys", o.keys.map((alt) => alt.map(itemName).join(" + ")).join(t("or")))) + "</span>");
  notes.push(condBox(o));
  if (need(o) > 1) {
    return '<div class="counter"><span class="txt">' + esc(L(o.text)) + tag + notes.join("") + "</span>" +
      '<span class="stepper"><button type="button" data-step="-1" data-obj="' + esc(o.id) + '" aria-label="' + esc(t("minus")) + '">−</button><output>' + (o.oneRaid ? gain : have(o) + gain) + " / " + need(o) + "</output>" +
      '<button type="button" data-step="1" data-obj="' + esc(o.id) + '" aria-label="' + esc(t("plus")) + '">+</button></span></div>';
  }
  return '<label class="check' + (gain ? " isdone" : "") + '"><input type="checkbox" data-obj="' + esc(o.id) + '"' + (gain ? " checked" : "") + '><span><span class="txt">' + esc(L(o.text)) + "</span>" + tag + notes.join("") + "</span></label>";
}

function renderRaid() {
  const p = planMaps(planView(data, S), S).find((x) => x.map === ui.raid.map);
  if (!p) { ui.raid = null; prefs.view = "next"; return render(); }
  const color = mapColor(p.map);
  const included = new Set(p.tasks.flatMap((x) => x.objectives));
  const inRoute = new Set(p.route.flatMap((r) => r.objectives));
  const whole = [...included].filter((id) => !inRoute.has(id) && idx.obj[id].maps.includes(p.map));
  const along = [...included].filter((id) => !idx.obj[id].maps.length);
  let html = '<div class="sheethead"><div class="maphead" style="--c:' + esc(color) + '"><div class="name">' + esc(mapName(p.map)) + '</div><div class="rank">' + esc(t("sheet")) + "</div></div></div>";
  if (p.oneRaid.length) html += '<div class="warn purple">' + esc(t("warnOneRaid", p.oneRaid.map((id) => L(idx.obj[id].text)).join(", "))) + "</div>";
  if (p.survive.length) html += '<div class="warn">' + esc(t("warnSurvive", p.survive.map(taskName).join(", "))) + "</div>";
  const condObjs = [...included].map((id) => idx.obj[id]).filter((o) => o.conditions && o.conditions.length);
  const reps = [...new Set(p.tasks.map((x) => repText(idx.task[x.task])).filter(Boolean))];
  if (condObjs.length || reps.length) html += '<div class="warn cond">' + esc(t("condWarn")) + "<ul>" + reps.map((r) => "<li>" + esc(r) + "</li>").join("") + condObjs.map((o) =>
    "<li><b>" + esc(L(o.text)) + "</b> — " + esc(o.conditions.map((c) => condText(c)).join(" · ")) +
    (o.conditions.some((c) => condText(c) !== condText(c, true)) ? '<details><summary>' + esc(t("showAllRestrictions")) + "</summary>" + condBox(o, true) + "</details>" : "") + "</li>").join("") + "</ul></div>";
  html += '<div class="sheet"><div class="panel"><h2>' + esc(t("bringTitle")) + "</h2>" +
    (p.bring.length ? p.bring.map((b) => {
      const k = b.item, c = ui.raid.bring[k];
      return '<label class="check' + (c ? " isdone" : "") + '"><input type="checkbox" data-bring="' + esc(k) + '"' + (c ? " checked" : "") + '><span class="txt">' + esc(itemName(k)) + (b.count > 1 ? " ×" + b.count : "") + "</span></label>";
    }).join("") : '<p class="lede" style="margin:0">' + esc(t("bringNone")) + "</p>") +
    (p.keys.length ? '<h2 style="margin-top:16px">' + esc(t("keysTitle")) + "</h2>" + p.keys.map((k) => '<div class="keyline">' + esc(k.alternatives.map((alt) => alt.map(itemName).join(" + ")).join(t("or"))) + "</div>").join("") : "") + "</div>";
  html += '<div class="panel" style="--c:' + esc(color) + '"><h2>' + esc(t("routeTitle")) + "</h2>";
  p.route.forEach((r, i) => {
    const st = idx.stop[r.stop];
    html += '<div class="stop"><div class="stopno">' + (i + 1) + '</div><div><div class="stopname">' + esc(st ? L(st.label) : r.stop) + "</div>" + r.objectives.map((id) => objRow(idx.obj[id])).join("") + "</div></div>";
  });
  if (whole.length) html += '<div class="stop"><div class="stopno">∞</div><div><div class="stopname">' + esc(t("anywhere")) + "</div>" + whole.map((id) => objRow(idx.obj[id])).join("") + "</div></div>";
  if (along.length) html += '<div class="stop"><div class="stopno">+</div><div><div class="stopname">' + esc(t("alongAny")) + "</div>" + along.map((id) => objRow(idx.obj[id])).join("") + "</div></div>";
  html += "</div></div>";
  app.innerHTML = html;
  endSlot.innerHTML = '<div class="endbar"><div class="endbar-inner"><span class="q" id="endq">' + esc(t("endQ")) + '</span><div class="actions" id="endactions">' +
    '<button class="btn ok" type="button" data-end="survived">' + esc(t("endSurvived")) + '</button><button class="btn danger" type="button" data-end="died">' + esc(t("endDied")) + "</button>" +
    '<button class="btn ghost" type="button" data-end="cancel">' + esc(t("endCancel")) + "</button></div></div></div>";
}

// Task status for the filter: done / held / available / locked (engine.taskStatus; unknown level or LL never locks).
function statusMap() { const m = new Map(); for (const tk of data.tasks) m.set(tk.id, taskStatus(data, S, tk.id).status); return m; }
// Progress summary at the top of My tasks (after TarkovTracker's dashboard).
function summaryHTML(st) {
  const trader = data.tasks.filter((tk) => !tk.story), chapters = data.tasks.filter((tk) => tk.story);
  const n = (list, f) => list.filter((tk) => f(st.get(tk.id))).length;
  const kappa = data.tasks.filter((tk) => tk.kappa), col = data.tasks.find((tk) => tk.key === "collector");
  const colIds = [...new Set((col?.objectives || []).filter((o) => o.type === "giveItem").flatMap((o) => o.items))];
  const handed = colIds.filter((id) => libState.collector?.[id]?.handed).length;
  const tile = (num, label, sub) => '<div class="stile"><b>' + num + "</b><span>" + esc(label) + "</span>" + (sub ? "<small>" + esc(sub) + "</small>" : "") + "</div>";
  return tile(n(data.tasks, (x) => x === "held"), t("sumHeld")) + tile(n(data.tasks, (x) => x === "available"), t("sumAvailable")) +
    tile(n(trader, (x) => x === "done") + "<small> / " + trader.length + "</small>", t("sumDone")) +
    (chapters.length ? tile(n(chapters, (x) => x === "done") + "<small> / " + chapters.length + "</small>", t("sumStory")) : "") +
    (kappa.length ? tile(n(kappa, (x) => x === "done") + "<small> / " + kappa.length + "</small>", t("sumKappa"), colIds.length ? t("sumCollector", handed, colIds.length) : "") : "");
}
function filterHTML(st) {
  const c = { all: data.tasks.length, held: 0, available: 0, locked: 0, done: 0 };
  for (const v of st.values()) c[v]++;
  return seg2("taskFilter", prefs.taskFilter, ["held", "available", "locked", "done", "all"].map((k) => [k, t("tFilter_" + k, c[k])]));
}
const seg2 = (name, value, opts) => '<div class="seg" role="group">' + opts.map(([v, label]) =>
  '<button type="button" data-tpref="' + name + '" data-tval="' + v + '" aria-pressed="' + (value === v) + '">' + esc(label) + "</button>").join("") + "</div>";
const taskMaps = (tk) => { const r = raidObjectives(tk); return r.length ? [...new Set(r.flatMap((o) => o.maps.length ? o.maps : ["*"]))] : ["-"]; };
// Visible tasks grouped by trader or by map (a task touching several maps appears under each).
function taskGroups(st) {
  const q = (prefs.q || "").trim().toLowerCase(), f = prefs.taskFilter, groups = new Map();
  for (const tk of data.tasks) {
    if (f !== "all" && st.get(tk.id) !== f) continue;
    if (q && !tk.searchText.includes(q)) continue;
    for (const key of prefs.taskGroup === "map" ? taskMaps(tk) : [tk.trader]) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(tk);
    }
  }
  const rank = (key) => {
    if (prefs.taskGroup === "map") { const i = (data.maps || []).findIndex((m) => m.group === key || m.key === key); return key === "*" ? 900 : key === "-" ? 950 : i < 0 ? 800 : i; }
    const i = TRADER_ORDER.indexOf(idx.trader[key]?.key); return i < 0 ? 99 : i;
  };
  return [...groups].sort((a, b) => rank(a[0]) - rank(b[0])).map(([key, list]) => ({ key, list: sortTasks(list) }));
}
function groupLabel(key) { return prefs.taskGroup === "map" ? (key === "*" ? t("anyMap") : key === "-" ? t("noRaidGroup") : mapName(key)) : traderName(key); }
function renderTasks() {
  const q = (prefs.q || "").trim().toLowerCase(), st = statusMap();
  let html = "<h1>" + esc(t("tasksTitle")) + '</h1><p class="lede">' + esc(t("tasksLede")) + "</p>";
  html += '<div class="summary" id="tsum">' + summaryHTML(st) + "</div>";
  const llSet = LL_TRADERS.filter((k) => idx.traderKey[k] && S.ll[idx.traderKey[k].id]).length, llAll = LL_TRADERS.filter((k) => idx.traderKey[k]).length;
  const profOpen = ui.profileOpen ?? (S.level == null && !llSet);
  html += '<details class="profile-box"' + (profOpen ? " open" : "") + "><summary>" + esc(t("profileSummary", S.level ?? "?", llSet, llAll, S.prestige ?? "?")) + "</summary>";
  html += '<div class="profile"><div class="field"><label for="f-level">' + esc(t("pmcLevel")) + '</label><input id="f-level" type="number" min="1" max="79" placeholder="?" value="' + esc(S.level ?? "") + '"></div>' +
    // prestige level (Jack 2026-10-07): marks claimed / next levels in Library → Prestige
    '<div class="field"><label for="f-prestige">' + esc(t("prestigeLevel")) + '</label><select id="f-prestige"><option value="">?</option>' +
    [0, 1, 2, 3, 4, 5, 6].map((n) => "<option" + (S.prestige === n ? " selected" : "") + ">" + n + "</option>").join("") + "</select></div>" +
    '<div class="field"><label for="f-faction">' + esc(t("faction")) + '</label><select id="f-faction"><option value="">' + esc(t("factionBoth")) + "</option>" +
    ["BEAR", "USEC"].map((f) => "<option" + (S.faction === f ? " selected" : "") + ">" + f + "</option>").join("") + "</select></div>" +
    LL_TRADERS.filter((k) => idx.traderKey[k]).map((k) => {
      const tr = idx.traderKey[k], v = S.ll[tr.id];
      return '<div class="field"><label for="f-ll-' + esc(k) + '">' + esc(L(tr.name)) + ' LL</label><select id="f-ll-' + esc(k) + '" data-ll="' + esc(tr.id) + '"><option value="">?</option>' +
        [1, 2, 3, 4].map((n) => "<option" + (v === n ? " selected" : "") + ">" + n + "</option>").join("") + "</select></div>";
    }).join("") + '</div><p class="meta">' + esc(t("profileWhy")) + "</p></details>";
  html += '<div class="toolbar"><input type="search" id="f-q" placeholder="' + esc(t("search")) + '" value="' + esc(prefs.q) + '" aria-label="' + esc(t("search")) + '"></div>' +
    '<div class="toolbar tfilters"><div id="tfilter">' + filterHTML(st) + "</div>" + seg2("taskGroup", prefs.taskGroup, [["trader", t("groupTrader")], ["map", t("groupMap")]]) + "</div>";
  const groups = taskGroups(st);
  if (!groups.length) html += '<div class="empty" style="margin-top:20px">' + esc(t("noMatch")) + "</div>";
  for (const { key, list } of groups) {
    const heldN = list.filter((tk) => S.held[tk.id] && !S.done[tk.id]).length;
    const open = q || prefs.taskFilter !== "all" || prefs.open[key];
    const dot = prefs.taskGroup === "map" && key !== "*" && key !== "-" ? '<i class="mapdot" style="background:' + esc(mapColor(key)) + '"></i>' : "";
    html += '<details class="trader" data-trader="' + esc(key) + '"' + (open ? " open" : "") + '><summary>' + dot + '<span class="tn">' + esc(groupLabel(key)) + '</span><span class="tc">' + esc(t("traderCount", heldN, list.length)) + "</span></summary>";
    if (open) html += '<div class="rows">' + list.map(taskRow).join("") + "</div>";
    html += "</details>";
  }
  app.innerHTML = html;
}

function sortTasks(list) { return list.slice().sort((a, b) => (a.story && b.story ? a.story.order - b.story.order : 0) || (a.minLevel - b.minLevel) || L(a.name).localeCompare(L(b.name))); }

function taskRow(tk) {
  const st = taskStatus(data, S, tk.id);
  const lt = st.status === "locked" ? lockText(st.reasons) : "";
  const maps = [...new Set(raidObjectives(tk).flatMap((o) => o.maps.length ? o.maps : ["*"]))];
  const chosen = [].concat(S.storyRoute?.[tk.id] || []);
  const req = tk.objectives.filter((o) => !o.optional && (!tk.story || onRoute(o, chosen)));
  const total = req.length;
  let doneN = S.done[tk.id] ? total : req.filter((o) => have(o) >= need(o)).length;
  let shownTotal = total;
  // a single counter objective ("kill 15") shows units, not 0/1
  if (req.length === 1 && need(req[0]) > 1) { shownTotal = need(req[0]); doneN = S.done[tk.id] ? shownTotal : Math.min(have(req[0]), shownTotal); }
  const isDone = !!S.done[tk.id];
  const other = prefs.lang === "zh" ? tk.name.en : tk.name.zh;
  return '<div class="row' + (st.status === "locked" ? " locked" : "") + (isDone ? " isdone" : "") + '">' +
    '<label class="switch" title="' + esc(t("heldTitle")) + '"><input type="checkbox" data-held="' + esc(tk.id) + '"' + (S.held[tk.id] ? " checked" : "") + (isDone ? " disabled" : "") + ' aria-label="' + esc(t("heldToggle", L(tk.name))) + '"><span></span></label>' +
    '<div style="min-width:0"><div class="tname"><button type="button" class="detailbtn" data-detail="' + esc(tk.id) + '" aria-expanded="' + esc(detailOpen.has(tk.id)) + '" aria-label="' + esc(t("detailToggle", L(tk.name))) + '">' + esc(L(tk.name)) + "</button>" + (other && other !== L(tk.name) ? ' <span class="tasktag">' + esc(other) + "</span>" : "") + '</div><div class="sub">' +
    maps.map((m) => m === "*" ? '<span class="flag bring">' + esc(t("anyMap")) + "</span>" : '<span class="maptag" style="background:' + esc(mapColor(m)) + '">' + esc(mapName(m)) + "</span>").join("") +
    (tk.objectives.some((o) => o.oneRaid) ? '<span class="flag sameraid">' + esc(t("tagOneRaid")) + "</span>" : "") +
    (tk.objectives.some((o) => o.survive) ? '<span class="flag survive">' + esc(t("tagSurvive")) + "</span>" : "") +
    (condKinds(tk.objectives).length ? '<span class="flag cond">' + esc(t("condTag", condKinds(tk.objectives).map((k) => t("condShort_" + k)).join("・"))) + "</span>" : "") +
    (tk.traderRep && tk.traderRep.length ? '<span class="flag cond">' + esc(repText(tk)) + "</span>" : "") +
    (tk.story ? '<span class="flag story">' + esc(t("chapterN", tk.story.order)) + "</span>" : "") +
    (storyLinks[tk.id] ? '<span class="flag story">' + esc(t("storyLinked")) + "</span>" : "") +
    (tk.kappa ? '<span class="flag kappa">Kappa</span>' : "") +
    (unlockN(tk.id) ? '<span class="flag unlocks">' + esc(t("unlocksN", unlockN(tk.id))) + "</span>" : "") +
    (taskKeys(tk).length ? '<span class="flag bring">' + esc(t("keysN", taskKeys(tk).length)) + "</span>" : "") +
    (lt ? '<span class="flag lock">' + esc(lt) + "</span>" : "") +
    "</div></div>" +
    '<div class="actions"><div class="prog"><span>' + esc(shownTotal === total ? t("progress", doneN, shownTotal) : doneN + " / " + shownTotal) + '</span><span class="bar"><i style="width:' + esc(shownTotal ? Math.round(doneN / shownTotal * 100) : 0) + '%"></i></span></div>' +
    '<button type="button" class="donebtn" data-done="' + esc(tk.id) + '" aria-pressed="' + esc(isDone) + '">' + esc(isDone ? t("doneOn") : t("done")) + "</button></div>" +
    (detailOpen.has(tk.id) ? detailHTML(tk) : "") + "</div>";
}

// "unlocks N": all tasks reachable after this one (structural); cached per loaded dataset.
let unlockCache = null, unlockCacheFor = null;
function unlockN(id) { if (unlockCacheFor !== rel) { unlockCache = unlockTotals(rel); unlockCacheFor = rel; } return unlockCache.get(id)?.total || 0; }
// Keys a task's raid objectives need: [{maps, alternatives: [itemId...]}], one entry per distinct key choice.
function taskKeys(tk) {
  const seen = new Map();
  for (const o of raidObjectives(tk)) for (const alt of o.keys || []) {
    const k = alt.join("|"); if (!seen.has(k)) seen.set(k, { maps: new Set(), alternatives: alt });
    o.maps.forEach((m) => seen.get(k).maps.add(m));
  }
  return [...seen.values()];
}
function nameList(ids, sep, max = 8) {
  if (!ids.length) return esc(t("detailNone"));
  const shown = ids.slice(0, max).map((id) => esc(taskName(id))).join(sep);
  return shown + (ids.length > max ? " · " + esc(t("detailMore", ids.length - max)) : "");
}

function detailHTML(tk) {
  if (tk.story) return storyDetailHTML(tk);
  const locked = !!S.done[tk.id];
  const objs = '<div class="objchecks">' + tk.objectives.map((o) => {
    const v = locked ? need(o) : Math.min(have(o), need(o)), full = v >= need(o);
    const label = esc(L(o.text)) + (o.optional ? ' <span class="tasktag">' + esc(t("optional")) + "</span>" : "");
    if (need(o) > 1 && !o.oneRaid) {
      return '<div class="counter' + (full ? " isdone" : "") + '"><span class="txt">' + label + condBox(o, true) + "</span>" +
        '<span class="stepper"><button type="button" data-pstep="-1" data-pobj="' + esc(o.id) + '"' + (locked ? " disabled" : "") + ' aria-label="' + esc(t("minus")) + '">−</button><output>' + v + " / " + need(o) + "</output>" +
        '<button type="button" data-pstep="1" data-pobj="' + esc(o.id) + '"' + (locked ? " disabled" : "") + ' aria-label="' + esc(t("plus")) + '">+</button></span></div>';
    }
    return '<label class="check' + (full ? " isdone" : "") + '"><input type="checkbox" data-pobj="' + esc(o.id) + '"' + (full ? " checked" : "") + (locked ? " disabled" : "") + '><span class="txt">' + label + condBox(o, true) + "</span></label>";
  }).join("") + "</div>";
  const chain = prerequisiteChain(rel, S, tk.id).map((c) => c.task).filter((id) => id !== tk.id && idx.task[id]);
  const un = unlocksOf(rel, tk.id).filter((u) => idx.task[u.task]);
  const onAccept = un.filter((u) => (u.status || []).includes("active") && !(u.status || []).includes("complete")).map((u) => u.task);
  const onDone = un.map((u) => u.task).filter((id) => !onAccept.includes(id));
  const ex = exclusiveWith(rel, tk.id).filter((id) => idx.task[id]);
  const sep = prefs.lang === "zh" ? "、" : ", ";
  const rep = repText(tk);
  return '<div class="detail"><div>' + (rep ? '<p class="conds-rep">' + esc(rep) + "</p>" : "") + "<h3>" + esc(t("detailObjectives")) + "</h3>" + objs + "</div>" +
    "<div><h3>" + esc(t("detailPrereq")) + "</h3><p>" + nameList(chain, " → ", 12) + "</p>" +
    '<h3 style="margin-top:10px">' + esc(t("detailUnlocks")) + "</h3><p>" + nameList(onDone, sep) + "</p>" +
    (onAccept.length ? '<h3 style="margin-top:10px">' + esc(t("detailUnlocksActive")) + "</h3><p>" + nameList(onAccept, sep) + "</p>" : "") +
    (ex.length ? '<h3 style="margin-top:10px">' + esc(t("detailExclusive")) + "</h3><p>" + nameList(ex, sep) + "</p>" : "") +
    (taskKeys(tk).length ? '<h3 style="margin-top:10px">' + esc(t("detailKeys")) + '</h3><ul class="linklist">' + taskKeys(tk).map((k) =>
      "<li>" + esc(k.alternatives.map(itemName).join(t("or"))) + (k.maps.size ? ' <span class="meta">' + esc([...k.maps].map(mapName).join(sep)) + "</span>" : "") + "</li>").join("") + "</ul>" : "") +
    (storyLinks[tk.id] ? '<h3 style="margin-top:10px">' + esc(t("storyRelated")) + '</h3><ul class="linklist">' + storyLinks[tk.id].map((l) =>
      "<li>" + esc(taskName(l.chapter)) + " — " + esc(t("rel_" + l.relation)) + (L(l.detail) ? '<br><span class="meta">' + esc(L(l.detail)) + "</span>" : "") + "</li>").join("") + "</ul>" : "") +
    "</div></div>";
}

function storyDetailHTML(tk) {
  const c = tk.story, sep = prefs.lang === "zh" ? "、" : ", ";
  const locked = !!S.done[tk.id];
  const now = new Set(locked ? [] : currentSteps(tk, S).map((o) => o.id));
  const routes = routesOf(tk), chosen = [].concat((S.storyRoute || {})[tk.id] || []);
  const objRowS = (o) => {
    const full = locked || have(o) >= 1;
    const maps = o.maps.map((m) => '<span class="maptag" style="background:' + esc(mapColor(m)) + '">' + esc(mapName(m)) + "</span>").join("");
    return '<label class="check' + (full ? " isdone" : "") + (now.has(o.id) ? " current" : "") + '"><input type="checkbox" data-pobj="' + esc(o.id) + '"' + (full ? " checked" : "") + (locked ? " disabled" : "") + '><span class="txt">' +
      (now.has(o.id) ? '<span class="nowtag">' + esc(t("storyNow")) + "</span> " : "") + esc(L(o.text)) + (o.optional ? ' <span class="tasktag">' + esc(t("optional")) + "</span>" : "") + " " + maps + "</span></label>";
  };
  // steps in play order; a route heading appears where the route label changes
  let objs = "", head = "";
  tk.objectives.filter((o) => onRoute(o, chosen)).forEach((o) => {
    if (o.route && o.route !== head) objs += '<div class="routehead">' + esc(t("storyRoute", L(c.routeLabels[o.route]) || o.route)) + "</div>";
    head = o.route;
    objs += objRowS(o);
  });
  const routeSel = routes.length ? '<div class="routepick"><span class="meta">' + esc(t("storyRouteSel")) + "</span>" +
    routes.map((r) => '<label class="chip"><input type="checkbox" data-route="' + esc(tk.id) + '" value="' + esc(r) + '"' + (chosen.includes(r) ? " checked" : "") + "> " + esc(L(c.routeAtoms[r]) || r) + "</label>").join("") +
    '<span class="meta">' + esc(t("storyRouteHint")) + "</span></div>" : "";
  const links = c.links.filter((l) => idx.task[l.task]).map((l) =>
    "<li>" + esc(taskName(l.task)) + ' <span class="tasktag">' + esc(traderName(idx.task[l.task].trader)) + "</span> — " + esc(t("rel_" + l.relation)) + (L(l.detail) ? '<br><span class="meta">' + esc(L(l.detail)) + "</span>" : "") + "</li>").join("");
  const chapterByEn = Object.fromEntries(story.chapters.map((x) => [x.name.en, x]));
  const unlockName = (u) => u.kind === "feature" ? L(u.target) : u.kind === "chapter" && chapterByEn[u.target] ? L(chapterByEn[u.target].name)
    : u.kind === "trader_quest" && data.tasks.find((x) => x.key === u.target) ? L(data.tasks.find((x) => x.key === u.target).name) : u.target;
  return '<div class="detail"><div>' +
    '<p class="meta">' + esc(t("storyStart")) + " " + esc(L(c.start.detail)) + "</p>" + routeSel +
    "<h3>" + esc(t("detailObjectives")) + '</h3><div class="objchecks">' + objs + "</div></div><div>" +
    (c.unlocks.length ? "<h3>" + esc(t("storyUnlocks")) + "</h3><p>" + esc(c.unlocks.map((u) => t("unlock_" + u.kind) + " " + unlockName(u)).join(sep)) + "</p>" : "") +
    (links ? '<h3 style="margin-top:10px">' + esc(t("storyLinks")) + '</h3><ul class="linklist">' + links + "</ul>" : "") +
    (c.branches.length ? '<h3 style="margin-top:10px">' + esc(t("storyBranches")) + "</h3><ul class=\"linklist\">" + c.branches.map((b) => "<li><b>" + esc(L(b.name)) + "</b> " + esc(L(b.detail)) + "</li>").join("") + "</ul>" : "") +
    "</div></div>";
}

// ---------- hideout ----------
// Station levels live in S.hideout, collected construction items in S.got, the game edition in S.edition (all per
// mode, in backups). Needs come from hideout.mjs; this only renders. Two tabs (stations / items to keep) after
// TarkovTracker's hideout and needed-items pages (Jack 2026-10-04).
const fmtNum = (n) => n.toLocaleString(prefs.lang === "zh" ? "zh-TW" : "en-US");
const fmtTime = (s) => { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? t("hoursMin", h, m) : t("minutes", m); };
function stationName(id) { const s = (data.hideout || []).find((x) => x.id === id); return s ? L(s.name) : id; }
function skillName(key) { const s = t("skill_" + key); return s === "skill_" + key ? key.replace(/([a-z])([A-Z])/g, "$1 $2") : s; }
function needTags(part, kind) {
  return (part.fir ? '<span class="flag fir">' + esc(t(kind + "Fir", part.fir)) + "</span>" : "") +
    (part.any ? '<span class="flag bring">' + esc(t(kind + "Any", part.any)) + "</span>" : "");
}
const maxLevel = (st) => Math.max(...st.levels.map((l) => l.level));
const seg = (name, value, opts, cls = "") => '<div class="seg' + cls + '" role="group">' + opts.map(([v, label]) =>
  '<button type="button" data-hpref="' + name + '" data-hval="' + v + '" aria-pressed="' + (value === v) + '">' + esc(label) + "</button>").join("") + "</div>";
// One collected-count control: tap the count to toggle all / none, or step by one.
function gotControl(stationId, level, item, needN, fir, label) {
  const key = gotKey(stationId, level, item), got = Math.min(S.got[key] || 0, needN), full = got >= needN;
  return '<li class="ri' + (full ? " full" : "") + '"><span class="rname">' + esc(label || itemName(item)) + (fir ? ' <span class="flag fir">FIR</span>' : "") + "</span>" +
    '<span class="stepper got"><button type="button" data-got="' + esc(key) + '" data-gneed="' + needN + '" data-gstep="-1" aria-label="' + esc(t("minus")) + '"' + (got <= 0 ? " disabled" : "") + ">−</button>" +
    '<button type="button" class="gotcount" data-got="' + esc(key) + '" data-gneed="' + needN + '" data-gtoggle="1" aria-label="' + esc(t("gotToggle")) + '">' + (full ? "✓ " : "") + fmtNum(got) + " / " + fmtNum(needN) + "</button>" +
    '<button type="button" data-got="' + esc(key) + '" data-gneed="' + needN + '" data-gstep="1" aria-label="' + esc(t("plus")) + '"' + (full ? " disabled" : "") + ">+</button></span></li>";
}
function stationCard(st) {
  const lv = builtLevel(S, st), max = maxLevel(st), floor = floorLevel(S, st), next = nextLevel(st, S), bs = buildStatus(data, S, st);
  let body = "";
  if (next) {
    const reasons = bs.reasons.map((r) => "<li>" + esc(r.code === "station" ? t("reqStation", stationName(r.station), r.level)
      : r.code === "trader" ? t(r.have == null ? "reqTraderUnset" : "reqTrader", traderName(r.trader), r.level) : t("reqSkill", skillName(r.skill), r.level)) + "</li>").join("");
    const goods = next.items.filter((r) => !CURRENCY.includes(r.item)), money = next.items.filter((r) => CURRENCY.includes(r.item));
    const done = goods.filter((r) => (S.got[gotKey(st.id, next.level, r.item)] || 0) >= r.count).length;
    body = '<p class="status ' + bs.status + '">' + esc(t("next_" + bs.status, next.level)) + (next.seconds ? ' <span class="meta">· ' + esc(t("buildTime", fmtTime(next.seconds))) + "</span>" : "") + "</p>" +
      (reasons ? '<ul class="reqs">' + reasons + "</ul>" : "") +
      (goods.length ? '<p class="meta gotsum">' + esc(t("itemsReady", done, goods.length)) + '</p><ul class="reqitems">' + goods.map((r) => gotControl(st.id, next.level, r.item, r.count, r.fir)).join("") + "</ul>" : "") +
      (money.length ? '<p class="meta">' + esc(money.map((r) => itemName(r.item) + " " + fmtNum(r.count)).join(" · ")) + "</p>" : "") +
      '<div class="st-actions"><button type="button" class="btn ' + (bs.status === "ready" ? "ok" : "ghost") + '" data-hset="' + esc(st.id) + '" data-hlevel="' + next.level + '">' + esc(t("upgradeTo", next.level)) + "</button>" +
      (lv > floor ? '<button type="button" class="linkbtn" data-hset="' + esc(st.id) + '" data-hlevel="' + (lv - 1) + '">' + esc(t("downgradeTo", lv - 1)) + "</button>" : "") + "</div>";
  } else body = '<p class="status maxed">' + esc(t("next_maxed")) + '</p><div class="st-actions"><button type="button" class="linkbtn" data-hset="' + esc(st.id) + '" data-hlevel="' + (lv - 1) + '">' + esc(t("downgradeTo", lv - 1)) + "</button></div>";
  // the in-game station icon as a faint background mark (decorative, so empty alt)
  // drawn as a CSS mask so the silhouette takes the theme's ink colour in light and dark mode
  const mark = st.icon ? '<span class="st-mark" aria-hidden="true" style="--mark:url(' + esc(st.icon) + ')"></span>' : ""; // icon paths are img/hideout/<key>.webp: no spaces or quotes
  return '<article class="station ' + bs.status + '">' + mark + '<header><h3>' + esc(L(st.name)) + '</h3><span class="lvbadge">Lv ' + lv + "<small> / " + max + "</small></span></header>" + body + "</article>";
}
function renderStations(stations, counts) {
  const ed = S.edition || "", configured = !!ed || Object.keys(S.hideout).length > 0;
  // One-time settings: open on first use, a one-line summary afterwards.
  let html = '<details class="hsetup-box"' + ((ui.hsetupOpen ?? !configured) || ui.hquick ? " open" : "") + '><summary>' + esc(t("setupSummary", ed ? t("edition_" + ed) : t("editionNone"))) + '</summary><div class="hsetup"><label class="field">' + esc(t("editionLabel")) + '<select id="h-edition"><option value=""' + (ed ? "" : " selected") + ">" + esc(t("editionNone")) + "</option>" +
    Object.keys(EDITIONS).map((k) => '<option value="' + k + '"' + (ed === k ? " selected" : "") + ">" + esc(t("edition_" + k)) + "</option>").join("") + "</select></label>" +
    '<button type="button" class="btn ghost" id="h-quick" aria-expanded="' + !!ui.hquick + '">' + esc(t(ui.hquick ? "quickDone" : "quickSetup")) + "</button></div>";
  if (ui.hquick) {
    html += '<section class="panel quick"><p class="meta">' + esc(t("quickHelp")) + '</p><div class="quickgrid">' + stations.map((st) => {
      const lv = builtLevel(S, st), floor = floorLevel(S, st), opts = [];
      for (let i = floor; i <= maxLevel(st); i++) opts.push('<option value="' + i + '"' + (i === lv ? " selected" : "") + ">Lv " + i + "</option>");
      return '<label class="qrow"><span>' + esc(L(st.name)) + '</span><select data-hquick="' + esc(st.id) + '">' + opts.join("") + "</select></label>";
    }).join("") + "</div></section>";
  }
  html += "</details>";
  const f = prefs.hideoutFilter;
  html += '<div class="toolbar">' + seg("hideoutFilter", f, ["ready", "blocked", "maxed", "all"].map((k) => [k, t("hFilter_" + k, counts[k])])) + "</div>";
  const rank = { ready: 0, blocked: 1, maxed: 2 };
  const list = stations.map((st) => ({ st, status: buildStatus(data, S, st).status })).filter((x) => f === "all" || x.status === f)
    .sort((a, b) => rank[a.status] - rank[b.status]);
  html += list.length ? '<div class="stations">' + list.map((x) => stationCard(x.st)).join("") + "</div>" : '<div class="empty">' + esc(t("hEmpty_" + f)) + "</div>";
  return html;
}
function renderKeep(need) {
  const q = (prefs.hideoutQ || "").trim().toLowerCase();
  let rows = need.items;
  if (prefs.hideoutFir) rows = rows.filter((r) => r.hideout.fir + r.quest.fir > 0);
  if (q) rows = rows.filter((r) => { const it = data.items[r.item]; return it && (it.name.en + " " + it.name.zh + " " + it.short.en + " " + it.short.zh).toLowerCase().includes(q); });
  let html = '<div class="toolbar hideout-tools">' +
    seg("hideoutScope", prefs.hideoutScope, [["next", t("scopeNext")], ["all", t("scopeAll")]]) +
    seg("hideoutQuests", prefs.hideoutQuests, [["held", t("questsHeld")], ["open", t("questsOpen")]]) +
    '<label><input type="checkbox" id="h-fir"' + (prefs.hideoutFir ? " checked" : "") + "> " + esc(t("onlyFir")) + "</label>" +
    '<input type="search" id="h-q" placeholder="' + esc(t("searchItems")) + '" value="' + esc(prefs.hideoutQ) + '" aria-label="' + esc(t("searchItems")) + '"></div>';
  const cur = CURRENCY.filter((c) => need.currency[c]).map((c) => itemName(c) + " " + fmtNum(need.currency[c]));
  if (cur.length) html += '<p class="meta">' + esc(t("currencyNeed", cur.join(" · "))) + "</p>";
  if (!rows.length) return html + '<div class="empty">' + esc(t("keepNone")) + "</div>";
  for (const soon of [0, 1, 2]) {
    const group = rows.filter((r) => r.soon === soon);
    if (!group.length) continue;
    html += '<div class="section-label">' + esc(t("soon" + soon, group.length)) + '</div><div class="keeplist">' + group.map((r) => {
      const it = data.items[r.item];
      const src = r.sources.map((s) => s.kind === "hideout"
        ? gotControl(s.station, s.level, r.item, s.need, s.fir, t("srcHideout", stationName(s.station), s.level))
        : "<li>" + esc(taskName(s.task)) + " × " + s.count + (s.fir ? ' <span class="flag fir">FIR</span>' : "") +
          (s.alternatives ? ' <span class="meta">' + esc(t("srcAlt", s.alternatives.slice(1).map(itemName).join(t("or")))) + "</span>" : "") + "</li>").join("");
      return '<details class="keep" data-item="' + esc(r.item) + '"' + (ui.keepOpen?.has(r.item) ? " open" : "") + '><summary><span class="kname">' + esc(it ? L(it.name) : r.item) + '</span><span class="ktotal">' + fmtNum(r.total) + "</span>" +
        '<span class="ktags">' + needTags(r.hideout, "tagHideout") + needTags(r.quest, "tagQuest") + '</span></summary><ul class="reqitems">' + src + "</ul></details>";
    }).join("") + "</div>";
  }
  return html;
}
function renderHideout() {
  const stations = data.hideout || [];
  const counts = { ready: 0, blocked: 0, maxed: 0, all: stations.length };
  for (const st of stations) counts[buildStatus(data, S, st).status]++;
  const need = itemsNeeded(data, S, { hideout: prefs.hideoutScope, quests: prefs.hideoutQuests, order: "soon" });
  let html = "<h1>" + esc(t("hideoutTitle")) + '</h1><p class="lede">' + esc(t("hideoutLede")) + "</p>" +
    '<div class="toolbar">' + seg("hideoutTab", prefs.hideoutTab, [["stations", t("hTabStations", counts.ready)], ["keep", t("hTabKeep", need.items.length)]], " big") + "</div>";
  html += prefs.hideoutTab === "keep" ? renderKeep(need) : renderStations(stations, counts);
  app.innerHTML = html;
}
// Re-render in place: keep scroll position and focus (counters are tapped many times in a row).
function rerenderHideout() { const y = window.scrollY, f = captureFocus(); renderHideout(); window.scrollTo(0, y); restoreFocus(f); }
function setStationLevel(st, level) {
  const before = { hideout: { ...S.hideout }, got: { ...S.got } }, from = builtLevel(S, st);
  level = Math.max(floorLevel(S, st), Math.min(maxLevel(st), level));
  if (level > floorLevel(S, st)) S.hideout[st.id] = level; else delete S.hideout[st.id];
  // collected counts of levels now built are no longer needed
  for (const k of Object.keys(S.got)) { const [sid, lv] = k.split(":"); if (sid === st.id && Number(lv) <= level) delete S.got[k]; }
  saveAll(); rerenderHideout();
  if (level > from) toast(t("upgraded", L(st.name), level), [], { label: t("undo"), run: () => { S.hideout = before.hideout; S.got = before.got; saveAll(); rerenderHideout(); toast(t("undone")); } });
}

// ---------- about & backup ----------
const APP_VERSION = "0.19.2";
const BACKUP_KEYS = () => [PREF_KEY, LIB_KEY + "-migrated", ...MODES.flatMap((mode) => [stateKey(mode), libraryKey(mode)])];
function backupText() {
  const out = { app: "fieldnotes", v: 1, exported: new Date().toISOString(), data: {} };
  saveAll();
  for (const k of BACKUP_KEYS()) { const v = load(k, null); if (v !== null) out.data[k] = v; }
  return JSON.stringify(out);
}
function aboutHTML() {
  const p = (k, ...a) => "<p>" + esc(t(k, ...a)) + "</p>";
  return '<div class="about">' +
    '<section class="panel"><h2>' + esc(t("aboutTitle")) + "</h2>" + p("aboutUnofficial") + p("aboutTrademark") +
    p("aboutVersion", APP_VERSION, data.snapshot) + "</section>" +
    '<section class="panel"><h2>' + esc(t("backupTitle")) + "</h2>" + p("backupWhy") +
    '<div class="backup-actions"><button type="button" class="btn" id="bk-copy">' + esc(t("backupCopy")) + '</button><button type="button" class="btn ghost" id="bk-file">' + esc(t("backupFile")) + "</button></div>" +
    '<label for="bk-text" class="meta">' + esc(t("backupPasteLabel")) + '</label><textarea id="bk-text" rows="4" spellcheck="false" placeholder="{&quot;app&quot;:&quot;fieldnotes&quot;…}"></textarea>' +
    '<div class="backup-actions"><button type="button" class="btn ghost" id="bk-restore">' + esc(t("backupRestore")) + '</button><label class="btn ghost" for="bk-pick">' + esc(t("backupPick")) + '</label><input type="file" id="bk-pick" accept="application/json,.json" hidden></div></section>' +
    '<section class="panel"><h2>' + esc(t("sourcesTitle")) + "</h2>" + p("sourcesData", data.snapshot) + p("sourcesGuides") + p("sourcesFonts") + "</section>" +
    '<section class="panel"><h2>' + esc(t("privacyTitle")) + "</h2>" + p("privacyText") + "</section></div>";
}
function restoreBackup(text) {
  let b, writes;
  try {
    b = JSON.parse(text);
    if (!b || b.app !== "fieldnotes" || b.v !== 1) throw new TypeError("Invalid backup");
    object(b.data);
    writes = new Map();
    for (const k of [...BACKUP_KEYS(), LIB_KEY]) {
      if (!Object.hasOwn(b.data, k)) continue;
      const x = b.data[k];
      writes.set(k, k === PREF_KEY ? normalizePrefs(x) : k.startsWith("fieldnotes-v2-state-")
        ? { state: normalizeState(object(x).state), raid: normalizeRaid(x.raid) } : normalizeLibrary(x));
    }
  } catch { return toast(t("backupBad")); }
  if (!confirm(t("backupConfirm", typeof b.exported === "string" ? b.exported.slice(0, 10) : ""))) return;
  const originals = new Map(), written = [];
  try {
    for (const k of writes.keys()) originals.set(k, localStorage.getItem(k));
    for (const [k, v] of writes) { localStorage.setItem(k, JSON.stringify(v)); written.push(k); }
  } catch {
    // Validation and persistent writes must both succeed before replacing session state.
    for (const k of written.reverse()) {
      try { const old = originals.get(k); if (old === null) localStorage.removeItem(k); else localStorage.setItem(k, old); }
      catch { /* storage remains unavailable; the session copy is unchanged */ }
    }
    storageFailed = true; storageBanner(); return toast(t("backupFail"));
  }
  for (const [k, v] of writes) memory.set(k, structuredClone(v));
  location.reload();
}
document.addEventListener("click", async (e) => {
  const id = e.target.id;
  if (id === "bk-copy") {
    const s = backupText();
    try { await navigator.clipboard.writeText(s); toast(t("backupCopied")); }
    catch { const ta = document.getElementById("bk-text"); ta.value = s; ta.select(); toast(t("backupSelect")); }
  } else if (id === "bk-file") {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([backupText()], { type: "application/json" }));
    a.download = "fieldnotes-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a); a.click(); a.remove();
  } else if (id === "bk-restore") restoreBackup(document.getElementById("bk-text").value.trim());
});
document.addEventListener("change", async (e) => {
  if (e.target.id === "bk-pick" && e.target.files[0]) restoreBackup(await e.target.files[0].text());
});

// ---------- native shell (Capacitor) ----------
// Android back: close an open detail panel, else go back to "next", else leave the app.
const CapApp = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
if (CapApp) CapApp.addListener("backButton", () => {
  if (detailOpen.size) { detailOpen.clear(); render(); return; }
  if (prefs.view !== "next") { prefs.view = "next"; saveAll(); render(); return; }
  CapApp.exitApp();
});

// ---------- library ----------
async function renderLib() {
  const sequence = loadSequence, focus = captureFocus();
  if (!lib) {
    app.innerHTML = '<div class="loading">' + esc(t("loading")) + "</div>";
    try { const r = await fetch("data/library.json"); if (!r.ok) throw new Error("HTTP " + r.status); lib = validateLibraryIds(await r.json()); }
    catch (e) { if (sequence === loadSequence && prefs.view === "library" && !loadingMode) app.innerHTML = '<div class="empty" style="margin-top:24px">' + esc(t("libLoadFail", e.message)) + "</div>"; return; }
  }
  if (sequence !== loadSequence || loadingMode || prefs.view !== "library") return;
  app.innerHTML = renderLibrary(lib, data, libState, prefs.lang, prefs.libSection, ["collector", "achievements", "prestige", "about"], { about: aboutHTML() }, { query: ui.libQ, prestige: S.prestige });
  restoreFocus(focus);
}

(function installLibraryCss() { const st = document.createElement("style"); st.textContent = LIBRARY_CSS; document.head.appendChild(st); })();

// ---------- raid end ----------
function finishRaid(outcome) {
  const res = endRaid(data, S, { map: ui.raid.map, gains: ui.raid.gains }, outcome);
  S = res.state;
  const byTask = {};
  res.log.forEach((l) => { (byTask[l.task] = byTask[l.task] || { kept: 0, lost: [] }); if (l.kept) byTask[l.task].kept++; else byTask[l.task].lost.push(l.reason); });
  const REASON = { died: t("reasonDied"), oneRaidIncomplete: t("reasonOneRaid"), oneRaidGroupIncomplete: t("reasonOneRaidGroup") };
  const lines = Object.entries(byTask).map(([id, v]) => t("logKept", taskName(id), v.kept) + (v.lost.length ? t("logLost", v.lost.length, REASON[v.lost[0]] || v.lost[0]) : ""));
  ui.raid = null; prefs.view = "next";
  const head = outcome === "cancel" ? t("toastCancel") : outcome === "survived" ? t("toastSurvived") : t("toastDied");
  toast(head, outcome === "cancel" ? [] : lines.length ? lines : [t("toastNothing")]);
  render(); window.scrollTo(0, 0);
}

const toastEl = document.getElementById("toast"); let toastTimer;
function toast(msg, lines, action) {
  toastEl.innerHTML = esc(msg) + (lines && lines.length ? "<ul>" + lines.map((l) => "<li>" + esc(l) + "</li>").join("") + "</ul>" : "") +
    (action ? '<button type="button" class="btn ghost toast-action" id="toast-action">' + esc(action.label) + "</button>" : "");
  toastAction = action ? action.run : null;
  toastEl.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.hidden = true; toastAction = null; }, action ? 12000 : 7000);
}
let toastAction = null;

// ---------- implied prerequisites (Jack 2026-10-04) ----------
// Completing a story step, or marking a task done / accepted, also marks what it implies (cascade.mjs).
// Three or more implied items ask first (all / only this one / cancel); any cascade can be undone once.
const CASCADE_ASK = 3;
function cascadeDialog(title, names) {
  return new Promise((resolve) => {
    let dlg = document.getElementById("cascade-dlg");
    if (!dlg) { dlg = document.createElement("dialog"); dlg.id = "cascade-dlg"; dlg.className = "cascade"; document.body.appendChild(dlg); }
    const shown = names.slice(0, 12);
    dlg.innerHTML = "<h2>" + esc(title) + "</h2><p>" + esc(t("cascadeBody", names.length)) + "</p><ul>" + shown.map((n) => "<li>" + esc(n) + "</li>").join("") +
      (names.length > shown.length ? "<li>" + esc(t("cascadeMore", names.length - shown.length)) + "</li>" : "") + "</ul>" +
      '<div class="cascade-actions"><button type="button" class="btn" value="all">' + esc(t("cascadeAll", names.length)) + '</button>' +
      '<button type="button" class="btn ghost" value="one">' + esc(t("cascadeOne")) + '</button><button type="button" class="btn ghost" value="cancel">' + esc(t("cascadeCancel")) + "</button></div>";
    const done = (v) => { dlg.close(); resolve(v); };
    dlg.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => done(b.value)));
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); done("cancel"); }, { once: true });
    dlg.showModal();
    dlg.querySelector('button[value="all"]').focus();
  });
}
/**
 * Apply `main` (the clicked change) plus implied changes. extras: [{label, apply}].
 * Returns false when the user cancelled (the caller restores the control).
 */
async function withPrerequisites(title, main, extras, rerenderId) {
  const before = structuredClone(S);
  let applyExtras = extras.length > 0;
  if (extras.length >= CASCADE_ASK) {
    const choice = await cascadeDialog(title, extras.map((x) => x.label));
    if (choice === "cancel") { rerenderRows(rerenderId); return false; }
    applyExtras = choice === "all";
  }
  main();
  if (applyExtras) extras.forEach((x) => x.apply());
  saveAll();
  if (applyExtras) rerenderRows(); else rerenderRows(rerenderId);
  if (applyExtras) toast(t("cascadeApplied", extras.length), [], { label: t("undo"), run: () => { S = before; saveAll(); render(); toast(t("undone")); } });
  return true;
}

// ---------- events ----------
function captureFocus() {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  return { id: el.id, tag: el.tagName, attrs: [...el.attributes].filter((a) => a.name.startsWith("data-") || a.name === "value").map((a) => [a.name, a.value]) };
}
function restoreFocus(focus) {
  if (!focus) return;
  const el = focus.id ? document.getElementById(focus.id) : focus.attrs.length ? [...document.querySelectorAll(focus.tag)].find((node) => focus.attrs.every(([k, v]) => node.getAttribute(k) === v)) : null;
  if (el && !el.disabled) el.focus({ preventScroll: true });
}
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-view],[data-go],[data-step],[data-end],[data-done],[data-lang],[data-detail],[data-pstep],[data-lib-section],[data-tpref],[data-hpref],[data-got],[data-hset],#h-quick,#datachip,#backout,#toast-action");
  if (!el || !data || loadingMode) return;
  if (el.id === "datachip") { const n = document.getElementById("datanote"); n.hidden = !n.hidden; el.setAttribute("aria-expanded", String(!n.hidden)); return; }
  if (el.dataset.lang) { if (prefs.lang !== el.dataset.lang) { prefs.lang = el.dataset.lang; render(); } return; }
  if (el.id === "backout") { render(); return; }
  if (el.dataset.pstep) {
    const o = idx.obj[el.dataset.pobj];
    S.prog[o.id] = Math.max(0, Math.min(need(o), have(o) + Number(el.dataset.pstep)));
    if (!S.prog[o.id]) delete S.prog[o.id];
    saveAll(); rerenderRows(idx.objTask[o.id].id); return;
  }
  if (el.dataset.detail) { const id = el.dataset.detail; if (detailOpen.has(id)) detailOpen.delete(id); else detailOpen.add(id); rerenderRows(id); return; }
  if (el.dataset.libSection) { if (prefs.libSection !== el.dataset.libSection) ui.libQ = ""; prefs.libSection = el.dataset.libSection; saveAll(); renderLib(); return; }
  if (el.dataset.tpref) { prefs[el.dataset.tpref] = el.dataset.tval; if (el.dataset.tpref === "taskFilter") prefs.onlyHeld = el.dataset.tval === "held"; saveAll(); const y = window.scrollY, f = captureFocus(); render(); window.scrollTo(0, y); restoreFocus(f); return; }
  if (el.dataset.hpref) { const top = el.dataset.hpref === "hideoutTab"; prefs[el.dataset.hpref] = el.dataset.hval; saveAll(); if (top) { renderHideout(); window.scrollTo(0, 0); } else rerenderHideout(); return; }
  if (el.id === "h-quick") { ui.hquick = !ui.hquick; rerenderHideout(); return; }
  if (el.dataset.got) {
    const key = el.dataset.got, needN = Number(el.dataset.gneed), cur = Math.min(S.got[key] || 0, needN);
    const v = el.dataset.gtoggle ? (cur >= needN ? 0 : needN) : Math.max(0, Math.min(needN, cur + Number(el.dataset.gstep)));
    if (v) S.got[key] = v; else delete S.got[key];
    saveAll(); rerenderHideout(); return;
  }
  if (el.dataset.hset) { setStationLevel(data.hideout.find((s) => s.id === el.dataset.hset), Number(el.dataset.hlevel)); return; }
  if (el.dataset.view) { if (el.dataset.view === "raid" && !ui.raid) return; prefs.view = el.dataset.view; render(); window.scrollTo(0, 0); return; }
  if (el.dataset.go) {
    if (ui.raid && ui.raid.map !== el.dataset.go && Object.values(ui.raid.gains).some((n) => n !== 0) && !confirm(t("replaceRaid"))) return;
    if (!ui.raid || ui.raid.map !== el.dataset.go) ui.raid = { map: el.dataset.go, gains: {}, bring: {} };
    prefs.view = "raid"; render(); window.scrollTo(0, 0); return;
  }
  if (el.dataset.done) {
    const id = el.dataset.done;
    if (S.done[id]) { delete S.done[id]; saveAll(); rerenderRows(id); return; }
    const pre = taskPrerequisites(data, S, id);
    const extras = [...pre.done.map((p) => ({ label: t("cascadeDone", taskName(p)), apply: () => { S.done[p] = true; } })),
      ...pre.held.map((p) => ({ label: t("cascadeHeld", taskName(p)), apply: () => { S.held[p] = true; } }))];
    withPrerequisites(t("cascadeTitleDone", taskName(id)), () => { S.done[id] = true; }, extras, id);
    return;
  }
  if (el.id === "toast-action" && toastAction) { const run = toastAction; toastAction = null; toastEl.hidden = true; run(); return; }
  if (el.dataset.step) {
    const o = idx.obj[el.dataset.obj], cur = ui.raid.gains[o.id] || 0;
    ui.raid.gains[o.id] = Math.max(0, Math.min(o.oneRaid ? need(o) : need(o) - have(o), cur + Number(el.dataset.step))); render(); return;
  }
  if (el.dataset.end) {
    const kind = el.dataset.end;
    if (kind.startsWith("confirm-")) { finishRaid(kind.slice(8)); return; }
    if (kind === "cancel") { finishRaid("cancel"); return; }
    document.getElementById("endq").innerHTML = kind === "survived"
      ? esc(t("confirmSurvived")) + '<span class="confirm">' + esc(t("confirmSurvivedNote")) + "</span>"
      : esc(t("confirmDied")) + '<span class="confirm">' + esc(t("confirmDiedNote")) + "</span>";
    document.getElementById("endactions").innerHTML = '<button class="btn ' + (kind === "survived" ? "ok" : "danger") + '" type="button" data-end="confirm-' + esc(kind) + '">' + esc(t("confirm")) + '</button><button class="btn ghost" type="button" id="backout">' + esc(t("back")) + "</button>";
    document.querySelector("#endactions button").focus();
  }
});

// Toggling a task must not move the list (no full re-render, scroll stays put).
function rerenderRows(taskId) {
  if (prefs.view !== "tasks") return render();
  const focus = captureFocus();
  document.querySelectorAll("details.trader[open]").forEach((d) => {
    const rows = d.querySelector(".rows"); if (!rows) return;
    const ids = [...rows.querySelectorAll("[data-held]")].map((i) => i.dataset.held);
    if (taskId) {
      const row = [...rows.querySelectorAll("[data-held]")].find((el) => el.dataset.held === taskId)?.closest(".row");
      if (row) row.outerHTML = taskRow(idx.task[taskId]);
    } else rows.innerHTML = ids.map((id) => taskRow(idx.task[id])).join("");
    const heldN = ids.filter((id) => S.held[id] && !S.done[id]).length;
    d.querySelector(".tc").textContent = t("traderCount", heldN, ids.length);
  });
  const st = statusMap(), sum = document.getElementById("tsum"), tf = document.getElementById("tfilter");
  if (sum) sum.innerHTML = summaryHTML(st);
  if (tf) tf.innerHTML = filterHTML(st);
  document.getElementById("lvl").textContent = S.level ?? "?";
  restoreFocus(focus);
}

document.addEventListener("toggle", (e) => {
  const d = e.target;
  if (d.matches && d.matches("details.hsetup-box")) { ui.hsetupOpen = d.open; return; }
  if (d.matches && d.matches("details.profile-box")) { ui.profileOpen = d.open; return; }
  if (d.matches && d.matches("details.keep")) { ui.keepOpen = ui.keepOpen || new Set(); if (d.open) ui.keepOpen.add(d.dataset.item); else ui.keepOpen.delete(d.dataset.item); return; }
  if (!d.matches || !d.matches("details.trader")) return;
  if (loadingMode || !d.isConnected) return;
  const tid = d.dataset.trader; prefs.open[tid] = d.open; saveAll();
  if (d.open && !d.querySelector(".rows")) {
    const list = taskGroups(statusMap()).find((g) => g.key === tid)?.list || [];
    d.insertAdjacentHTML("beforeend", '<div class="rows">' + list.map(taskRow).join("") + "</div>");
  }
}, true);

// Game mode buttons (PvP / PvE / Seasonal). Handled on their own: switching must work while a mode is still loading.
function markMode() {
  document.querySelectorAll("#mode [data-mode]").forEach((b) => {
    b.textContent = t("mode_" + b.dataset.mode);
    b.setAttribute("aria-pressed", String(b.dataset.mode === prefs.mode));
  });
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("#mode [data-mode]");
  if (!b || (b.dataset.mode === prefs.mode && !loadingMode)) return;
  saveAll(); prefs.mode = b.dataset.mode; store(PREF_KEY, prefs); markMode(); loadMode(prefs.mode);
});

document.addEventListener("change", (e) => {
  const el = e.target;
  if (!data || loadingMode) return;
  if (el.dataset.pobj && !el.dataset.pstep) {
    const o = idx.obj[el.dataset.pobj], tk = idx.objTask[o.id];
    if (!el.checked || !tk.story) { if (el.checked) S.prog[o.id] = need(o); else delete S.prog[o.id]; saveAll(); rerenderRows(tk.id); return; }
    const extras = storyPrerequisites(tk, o, S).map((p) => ({ label: t("cascadeStep", L(p.text)), apply: () => { S.prog[p.id] = 1; } }));
    withPrerequisites(t("cascadeTitleStep", L(tk.name)), () => { S.prog[o.id] = need(o); }, extras, tk.id);
    return;
  }
  if (el.dataset.libKind) {
    const id = el.dataset.libId, kind = el.dataset.libKind;
    if (kind === "story" || kind === "ach") { const bag = libState[kind]; if (el.checked) bag[id] = true; else delete bag[id]; }
    else { const c = libState.collector[id] || (libState.collector[id] = {}); c[kind] = el.checked; }
    store(libraryKey(activeMode), libState);
    const y = window.scrollY; renderLib(); window.scrollTo(0, y); return;
  }
  if (el.dataset.obj && ui.raid) { ui.raid.gains[el.dataset.obj] = el.checked ? 1 : 0; render(); return; }
  if (el.dataset.bring !== undefined && ui.raid) { ui.raid.bring[el.dataset.bring] = el.checked; saveAll(); el.closest(".check").classList.toggle("isdone", el.checked); return; }
  if (el.id === "h-fir") { prefs.hideoutFir = el.checked; saveAll(); renderHideout(); return; }
  if (el.id === "h-edition") { S.edition = el.value || null; saveAll(); rerenderHideout(); return; }
  if (el.dataset.hquick) {
    const st = data.hideout.find((s) => s.id === el.dataset.hquick), v = Number(el.value);
    if (v > floorLevel(S, st)) S.hideout[st.id] = v; else delete S.hideout[st.id];
    for (const k of Object.keys(S.got)) { const [sid, lv] = k.split(":"); if (sid === st.id && Number(lv) <= v) delete S.got[k]; }
    saveAll(); rerenderHideout(); return;
  }
  if (el.dataset.held) {
    const id = el.dataset.held;
    if (!el.checked) { delete S.held[id]; saveAll(); rerenderRows(id); return; }
    const pre = taskPrerequisites(data, S, id);
    const extras = [...pre.done.map((p) => ({ label: t("cascadeDone", taskName(p)), apply: () => { S.done[p] = true; } })),
      ...pre.held.map((p) => ({ label: t("cascadeHeld", taskName(p)), apply: () => { S.held[p] = true; } }))];
    withPrerequisites(t("cascadeTitleHeld", taskName(id)), () => { S.held[id] = true; }, extras, id);
    return;
  }
  if (el.dataset.ll !== undefined) { const v = el.value ? Number(el.value) : null; if (v) S.ll[el.dataset.ll] = v; else delete S.ll[el.dataset.ll]; saveAll(); rerenderRows(); return; }
  if (el.id === "f-level") { const v = parseInt(el.value, 10); S.level = Number.isFinite(v) ? Math.max(1, Math.min(79, v)) : null; saveAll(); rerenderRows(); return; }
  if (el.dataset.route) {
    const m = (S.storyRoute = S.storyRoute || {}), cur = new Set([].concat(m[el.dataset.route] || []));
    if (el.checked) cur.add(el.value); else cur.delete(el.value);
    m[el.dataset.route] = [...cur]; saveAll(); rerenderRows(el.dataset.route); return;
  }
  if (el.id === "f-prestige") { S.prestige = el.value === "" ? null : Number(el.value); saveAll(); render(); return; }
  if (el.id === "f-faction") { S.faction = el.value || null; data = factionView(fullData, S); idx = makeIndex(data); rel = buildIndex(data); render(); return; }
  if (el.id === "f-only") { prefs.onlyHeld = el.checked; render(); return; }
});

let qTimer;
document.addEventListener("input", (e) => {
  if (e.target.id === "h-q") {
    prefs.hideoutQ = e.target.value; clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      const pos = e.target.selectionStart; saveAll(); renderHideout();
      const f = document.getElementById("h-q"); if (f) { f.focus(); try { f.setSelectionRange(pos, pos); } catch { /* ignore */ } }
    }, 200);
    return;
  }
  if (e.target.id === "lib-q") {
    ui.libQ = e.target.value; clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      const pos = e.target.selectionStart; renderLib();
      const f = document.getElementById("lib-q"); if (f) { f.focus(); try { f.setSelectionRange(pos, pos); } catch { /* ignore */ } }
    }, 200);
    return;
  }
  if (e.target.id !== "f-q") return;
  prefs.q = e.target.value; clearTimeout(qTimer);
  qTimer = setTimeout(() => {
    const pos = e.target.selectionStart; render();
    const f = document.getElementById("f-q"); if (f) { f.focus(); try { f.setSelectionRange(pos, pos); } catch { /* ignore */ } }
  }, 200);
});

migrateLibrary(prefs.mode);
loadMode(prefs.mode);
