// Pure hideout planning over fieldnotes-planner/1; state remains UI-owned.
export const CURRENCY = Object.freeze([
  '5449016a4bdc2d6f028b456f', // Roubles
  '5696686a4bdc2da3298b456a', // Dollars
  '569668774bdc2da2298b4568'  // Euros
]);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

// Every account starts with the Stash built; the game edition sets its starting level (stash size in
// cells per level from tarkov.dev bonuses: 300/400/500/680; edition sizes 10x30, 10x40, 10x50, 10x68, 10x72).
export const STASH = '5d484fc0654e76006657e0ab';
export const EDITIONS = Object.freeze({ standard: 1, 'left-behind': 2, 'prepare-for-escape': 3, 'edge-of-darkness': 4, unheard: 4 });

// Stations other than the Stash that an edition starts with (Jack 2026-10-07: The Unheard starts with the Cultist Circle built).
export const CULTIST_CIRCLE = '667298e75ea6b4493c08f266';
export const EDITION_STATIONS = Object.freeze({ unheard: Object.freeze({ [CULTIST_CIRCLE]: 1 }) });

/** Lowest level a station can have: the Stash per game edition (1 when unknown), edition gifts, others 0. */
export function floorLevel(state, station) {
  const id = typeof station === 'string' ? station : station.id;
  return id === STASH ? EDITIONS[state.edition] ?? 1 : EDITION_STATIONS[state.edition]?.[id] ?? 0;
}

/** Station object or station ID; absent saved levels mean the floor level. */
export function builtLevel(state, station) {
  return Math.max(state.hideout?.[typeof station === 'string' ? station : station.id] ?? 0, floorLevel(state, station));
}

/** Key of a collected-count entry (state.got) for one item of one station level. */
export const gotKey = (station, level, item) => station + ':' + level + ':' + item;

/** Return the next level record (or null); never mutate the station. */
export function nextLevel(station, state) {
  const built = builtLevel(state, station);
  return station.levels.reduce((next, level) =>
    level.level > built && (!next || level.level < next.level) ? level : next, null);
}

/** Station object or ID. Skills are advisory; readiness excludes inventory. */
export function buildStatus(data, state, station) {
  const target = typeof station === 'string' ? (data.hideout ?? []).find(s => s.id === station) : station;
  if (!target) throw new RangeError('Unknown station: ' + station);
  const next = nextLevel(target, state);
  if (!next) return { status: 'maxed', reasons: [] };
  const reasons = [];
  for (const r of next.stations) {
    const have = builtLevel(state, r.station);
    if (have < r.level) reasons.push({ code: 'station', ...r, have });
  }
  for (const r of next.traders) {
    const have = state.ll?.[r.trader] ?? null;
    if (have === null ? r.level > 1 : have < r.level)
      reasons.push({ code: 'trader', ...r, have });
  }
  const blocked = reasons.length > 0;
  for (const r of next.skills) reasons.push({ code: 'skill', ...r });
  return { status: blocked ? 'blocked' : 'ready', reasons };
}

/**
 * Remaining construction and quest supplies; alternatives count under the first ID. Hideout items the player
 * already collected (state.got) are subtracted; hideout sources carry `need` and `got`.
 * order 'soon' puts what is usable now first: ready next levels and active quests (0), blocked next levels (1),
 * later levels and quests not yet accepted (2); then larger totals.
 */
export function itemsNeeded(data, state, { hideout, quests, order }) {
  const rows = new Map(), currency = {};
  const add = (item, count, fir, source) => {
    if (!item || count <= 0) return;
    if (CURRENCY.includes(item)) { currency[item] = (currency[item] ?? 0) + count; return; }
    if (!rows.has(item)) rows.set(item, { item, hideout: { fir: 0, any: 0 },
      quest: { fir: 0, any: 0 }, total: 0, sources: [] });
    const row = rows.get(item);
    row[source.kind][fir ? 'fir' : 'any'] += count;
    row.total += count;
    row.sources.push({ ...source, count, fir });
  };
  const soon = new Map();
  for (const station of data.hideout ?? []) {
    const next = nextLevel(station, state);
    const levels = hideout === 'all' ? station.levels.filter(l => l.level > builtLevel(state, station)) : [next].filter(Boolean);
    const nextRank = next && buildStatus(data, state, station).status === 'ready' ? 0 : 1;
    for (const level of levels) for (const r of level.items) {
      const got = Math.min(state.got?.[gotKey(station.id, level.level, r.item)] || 0, r.count);
      const before = rows.get(r.item)?.sources.length ?? 0;
      add(r.item, r.count - got, r.fir === true, { kind: 'hideout', station: station.id, level: level.level, need: r.count, got });
      if ((rows.get(r.item)?.sources.length ?? 0) > before)
        soon.set(r.item, Math.min(soon.get(r.item) ?? 9, level === next ? nextRank : 2));
    }
  }
  for (const task of data.tasks) {
    if (state.done?.[task.id] || (quests === 'held' && !state.held?.[task.id])) continue;
    // findItem is counted only when no giveItem of the same task hands over those items (e.g. keys to obtain);
    // otherwise the findItem/giveItem pair would count the same items twice.
    const handed = new Set(task.objectives.filter(o => o.type === 'giveItem').flatMap(o => o.items));
    for (const o of task.objectives) {
      const keep = o.type === 'findItem' && o.items.length && !o.items.some(i => handed.has(i));
      if (!['giveItem', 'plantItem'].includes(o.type) && !keep) continue;
      const source = { kind: 'quest', task: task.id, objective: o.id };
      if (o.items.length > 1) source.alternatives = [...o.items];
      add(o.items[0], o.count - (state.prog?.[o.id] || 0), o.fir === true, source);
      if (rows.has(o.items[0])) soon.set(o.items[0], Math.min(soon.get(o.items[0]) ?? 9, state.held?.[task.id] ? 0 : 2));
    }
  }
  for (const row of rows.values()) row.soon = soon.get(row.item) ?? 2;
  const byTotal = (a, b) => b.total - a.total || compare(a.item, b.item);
  return { items: [...rows.values()].sort(order === 'soon' ? (a, b) => a.soon - b.soon || byTotal(a, b) : byTotal), currency };
}
