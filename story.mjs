// Storyline chapters as planner tasks. Data: data/story.json (pipeline/story_build.py).
// Chapters run in their own game system (no trader, progress reported by visiting traders), but their raid
// steps share maps with trader quests, so the planner treats each chapter as a task of the pseudo-trader
// "story". Story steps are sequential: only the current step(s) are offered for planning.

export const STORY_TRADER = { id: "story", key: "story", name: { en: "Storyline", zh: "主線" } };

// "Survive and extract ... or visit ... 3 times" can be completed without surviving, so it is not a survive step.
const SURVIVE = /survive and extract/i, OR_VISIT = /\bor visit\b/i;

/** Planner tasks for every chapter, in chapter order. */
export function storyTasks(story) {
  return story.chapters.map((c) => ({
    id: c.id, key: "story-" + c.order, name: c.name, trader: STORY_TRADER.id, story: c,
    minLevel: 0, traderLL: [], traderRep: [], requires: [], failIf: [], kappa: false, lightkeeper: false,
    restartable: false, wiki: null, faction: null, prestige: null, legacy: false, variant: null,
    objectives: c.objectives.map((o) => ({
      id: o.id, type: "story", where: o.maps.length ? "raid" : "trader", text: o.text, optional: o.optional,
      count: 1, maps: o.maps, zones: [], stop: null, items: [], fir: false, questItem: null, keys: [],
      oneRaid: false, survive: SURVIVE.test(o.text.en) && !OR_VISIT.test(o.text.en), flags: [], conditions: [], seq: o.seq,
      route: o.route || "", routes: o.routes || []
    }))
  }));
}

/** Route choices (branches) of a chapter, in first-seen order. A step may belong to several choices. */
export function routesOf(task) {
  return [...new Set(task.objectives.flatMap((o) => o.routes))];
}

/** True when a step is on the player's chosen routes (no choice yet = everything is shown). */
export function onRoute(o, chosen) {
  return !o.routes.length || !chosen.length || o.routes.some((r) => chosen.includes(r));
}

/**
 * The objectives a player can work on now: unfinished ones whose seq is not after the first unfinished
 * required step. Objectives of a route other than the chosen one are left out.
 */
export function currentSteps(task, state) {
  const chosen = [].concat((state.storyRoute || {})[task.id] || []);
  const done = (o) => (state.prog[o.id] || 0) >= 1;
  const live = task.objectives.filter((o) => onRoute(o, chosen));
  const next = live.find((o) => !o.optional && !done(o));
  if (!next) return live.filter((o) => !done(o) && o.optional);
  // Following raid steps on the same map can be done in the same raid, so they join the current step.
  let last = next.seq;
  if (next.maps.length) for (const o of live.filter((x) => x.seq > next.seq)) {
    if (!o.maps.length || !o.maps.some((m) => next.maps.includes(m))) break;
    last = o.seq;
  }
  return live.filter((o) => !done(o) && o.seq <= last);
}

/** Copy of planner data whose story tasks only carry their current steps. */
export function planView(data, state) {
  return { ...data, tasks: data.tasks.map((tk) => tk.story ? { ...tk, objectives: currentSteps(tk, state) } : tk) };
}

/** Move library-era storyline checkmarks (legacy ids) into state.prog once. Returns the number moved. */
export function migrateLibraryStory(story, libStory, state) {
  if (state.storyMigrated) return 0;
  let n = 0;
  const used = new Set();
  for (const c of story.chapters) {
    const slug = c.name.en.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const groups = new Map();
    for (const o of [...c.objectives].sort((a, b) => a.seq - b.seq)) {
      const text = o.text.en.trim().toLowerCase();
      if (!groups.has(text)) groups.set(text, []);
      groups.get(text).push(o);
    }
    for (const objectives of groups.values()) {
      // Old JSON repeats all same-text ids on every occurrence, even across chapters.
      // Union first, then pair by legacy ordinal and objective seq; never filter by checkmarks first.
      const ids = [...new Set(objectives.flatMap((o) => o.legacyIds || []))].filter((id) => {
        const match = /^objective:([^:]+):formal:(\d+)$/.exec(id);
        return match && match[1] === slug;
      }).sort((a, b) => Number(a.split(":").at(-1)) - Number(b.split(":").at(-1)));
      ids.forEach((id, k) => {
        const o = objectives[k];
        if (!o || used.has(id)) return;
        used.add(id);
        if (libStory[id] && !state.prog[o.id]) { state.prog[o.id] = 1; n++; }
      });
    }
  }
  state.storyMigrated = true;
  return n;
}
