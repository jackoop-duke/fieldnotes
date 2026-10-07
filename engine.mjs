// Pure planning over fieldnotes-planner/1. Results refer to tasks/items by ID.
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const progress = (state, o) => state.prog[o.id] ?? 0;
const raidObjective = o => o.where === 'raid' && !o.optional;
const onMap = (o, map) => !o.maps.length || o.maps.includes(map);
const remaining = (task, state) => task.objectives.filter(o =>
  raidObjective(o) && progress(state, o) < o.count);

function statusOf(task, state) {
  if (state.done[task.id]) return { status: 'done', reasons: [] };
  const reasons = [];
  if (state.level != null && state.level < task.minLevel)
    reasons.push({ code: 'minLevel', required: task.minLevel, actual: state.level });
  for (const r of task.traderLL) {
    const actual = state.ll[r.trader];
    if (actual != null && actual < r.level)
      reasons.push({ code: 'traderLL', trader: r.trader, required: r.level, actual });
  }
  const locked = reasons.length > 0;
  for (const r of task.requires)
    if (!state.done[r.task]) reasons.push({ code: 'requires', task: r.task });
  return { status: locked ? 'locked' : state.held[task.id] ? 'held' : 'available', reasons };
}

/**
 * Get status with advisory prerequisites; unknown level/LL never locks.
 * @param {object} data Contract v1 dataset.
 * @param {object} state Player level, ll, held, done and prog.
 * @param {string} taskId Existing task ID.
 * @returns {{status:'done'|'locked'|'held'|'available', reasons:object[]}}
 * @throws {RangeError} For an unknown task ID.
 */
export function taskStatus(data, state, taskId) {
  const task = data.tasks.find(t => t.id === taskId);
  if (!task) throw new RangeError('Unknown task: ' + taskId);
  return statusOf(task, state);
}

function routeStops(rows, stops) {
  const pending = [...rows.keys()].map(id => stops.get(id)).sort((a, b) =>
    a.x - b.x || a.z - b.z || compare(a.id, b.id));
  const route = [];
  let current = pending.shift();
  while (current) {
    route.push({ stop: current.id, objectives: [...rows.get(current.id)] });
    let next = 0, best = Infinity;
    for (let i = 0; i < pending.length; i++) {
      const c = pending[i];
      const distance = (c.x - current.x) ** 2 + (c.z - current.z) ** 2;
      if (distance < best || (distance === best && compare(c.id, pending[next].id) < 0)) {
        best = distance;
        next = i;
      }
    }
    current = pending.splice(next, 1)[0];
  }
  return route;
}

/**
 * Plan every map group, sorted by score then key, including zero-onMap plans.
 * Bring counts are remaining units per item; key alternatives retain nesting.
 * Along-only tasks do not finish. Survive includes only survive objectives.
 * Route distance ties use stop IDs.
 * @param {object} data Contract v1 dataset.
 * @param {object} state Player level, ll, held, done and prog.
 * @returns {Array<{map:string,score:number,onMap:number,along:number,
 * finishes:number,tasks:object[],skipped:object[],bring:object[],keys:object[],
 * survive:string[],oneRaid:string[],route:object[]}>} Plans using IDs.
 */
export function planMaps(data, state) {
  const candidates = data.tasks.filter(t => state.held[t.id] && !state.done[t.id])
    .map(task => ({ task, status: statusOf(task, state), rem: remaining(task, state) }));
  const stops = new Map(data.stops.map(s => [s.id, s]));
  return [...new Set(data.maps.map(m => m.group))].map(map => {
    const plan = { map, score: 0, onMap: 0, along: 0, finishes: 0, tasks: [],
      skipped: [], bring: [], keys: [], survive: [], oneRaid: [], route: [] };
    const supplies = new Map(), rows = new Map();
    for (const { task, status, rem } of candidates) {
      const here = rem.filter(o => onMap(o, map));
      if (status.status === 'locked') {
        if (here.length) plan.skipped.push({ task: task.id, code: 'locked', detail: status.reasons });
        continue;
      }
      const group = rem.filter(o => o.oneRaid);
      if (group.length >= 2 && !group.every(o => onMap(o, map))) {
        plan.skipped.push({ task: task.id, code: 'oneRaidSplit',
          detail: { onMap: group.filter(o => onMap(o, map)).length, total: group.length } });
        continue;
      }
      if (!here.length) continue;
      const specific = here.filter(o => o.maps.length > 0).length;
      const finishes = specific > 0 && here.length === rem.length;
      plan.onMap += specific;
      plan.along += here.length - specific;
      plan.finishes += Number(finishes);
      plan.tasks.push({ task: task.id, objectives: here.map(o => o.id),
        finishes, alongOnly: specific === 0 });
      if (here.some(o => o.survive)) plan.survive.push(task.id);
      for (const o of here) {
        if (o.oneRaid) plan.oneRaid.push(o.id);
        if (o.keys.length) plan.keys.push({ objective: o.id,
          alternatives: o.keys.map(a => [...a]) });
        if (o.type === 'plantItem' || o.type === 'mark')
          for (const item of new Set(o.items))
            supplies.set(item, (supplies.get(item) ?? 0) + o.count - progress(state, o));
        if (o.stop && stops.get(o.stop)?.map === map) {
          if (!rows.has(o.stop)) rows.set(o.stop, []);
          rows.get(o.stop).push(o.id);
        }
      }
    }
    plan.score = plan.onMap + 0.3 * plan.along;
    plan.bring = [...supplies].sort(([a], [b]) => compare(a, b))
      .map(([item, count]) => ({ item, count }));
    plan.route = routeStops(rows, stops);
    return plan;
  }).sort((a, b) => b.score - a.score || compare(a.map, b.map));
}

/**
 * List unfinished required trader objectives when all required raid objectives
 * are complete. Passive/optional objectives do not gate hand-ins; locks do not
 * exclude held tasks.
 * @param {object} data Contract v1 dataset.
 * @param {object} state Player level, ll, held, done and prog.
 * @returns {Array<{task:string,objective:string}>} Task/objective IDs.
 */
export function handIns(data, state) {
  return data.tasks.filter(t => state.held[t.id] && !state.done[t.id] &&
    remaining(t, state).length === 0).flatMap(t => t.objectives
    .filter(o => o.where === 'trader' && !o.optional && progress(state, o) < o.count)
    .map(o => ({ task: t.id, objective: o.id })));
}

/** Central gain policy: change keep predicates here for rule revisions. */
export const RULES = {
  cancel: { keep: () => false },
  // reports/rules-research.md Q1: kills, visits, plants survive death; FIR/quest items and
  // "survive" objectives do not; a one-raid counter already met before death is kept (Tough Guy).
  died: { keep: (o, total, groupIncomplete) => !o.survive && (!o.oneRaid || (!groupIncomplete && total >= o.count)),
    reason: 'died' },
  survived: {
    keep: (o, total, groupIncomplete) => !o.oneRaid || (!groupIncomplete && total >= o.count),
    reason: (o, total, groupIncomplete) =>
      groupIncomplete ? 'oneRaidGroupIncomplete' : 'oneRaidIncomplete'
  }
};

/**
 * Resolve positive finite gains on required raid objectives of held, unlocked,
 * non-done tasks on raid.map. Ignore unknown/ineligible objectives and zero gains.
 * Failed gains preserve saved progress. Groups include required oneRaid objectives
 * with no gain as well as already-completed members.
 * @param {object} data Contract v1 dataset.
 * @param {object} state Player state (never mutated).
 * @param {{map:string,gains:Object<string,number>}} raid Raid increments.
 * @param {'survived'|'died'|'cancel'} outcome Raid outcome.
 * @returns {{state:object,log:Array<{task:string,objective:string,kept:number,reason:string}>}}
 * Independent state dictionaries; kept is the applied increment, not final total.
 * Reason is kept, died, oneRaidIncomplete or oneRaidGroupIncomplete.
 * Cancel returns an equal independent state and empty log.
 * @throws {RangeError} For an unsupported outcome.
 */
export function endRaid(data, state, raid, outcome) {
  if (!Object.hasOwn(RULES, outcome)) throw new RangeError('Unknown outcome: ' + outcome);
  const next = { ...state, ll: { ...state.ll }, held: { ...state.held },
    done: { ...state.done }, prog: { ...state.prog } };
  const log = [];
  if (outcome === 'cancel') return { state: next, log };
  const map = data.maps.find(m => m.key === raid.map)?.group ?? raid.map;
  const gainFor = o => {
    const gain = raid.gains[o.id];
    return onMap(o, map) && Number.isFinite(gain) && gain > 0 ? gain : 0;
  };
  for (const task of data.tasks) {
    if (statusOf(task, state).status !== 'held') continue;
    const objectives = task.objectives.filter(raidObjective);
    const group = objectives.filter(o => o.oneRaid);
    const groupIncomplete = group.length >= 2 &&
      group.some(o => progress(state, o) < o.count && gainFor(o) < o.count);
    for (const o of objectives) {
      const previous = progress(state, o), gain = gainFor(o);
      if (!gain || previous >= o.count) continue;
      // reports/rules-research.md:20: an unmet one-raid threshold cannot carry across raids.
      const total = Math.min(o.count, o.oneRaid ? gain : previous + gain), policy = RULES[outcome];
      const keep = policy.keep(o, total, groupIncomplete);
      if (keep) next.prog[o.id] = total;
      const reason = keep ? 'kept' : typeof policy.reason === 'function'
        ? policy.reason(o, total, groupIncomplete) : policy.reason;
      log.push({ task: task.id, objective: o.id, kept: keep ? total - previous : 0, reason });
    }
  }
  return { state: next, log };
}
