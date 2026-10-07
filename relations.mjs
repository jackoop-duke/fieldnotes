/** Compare task IDs deterministically, independently of locale. */
function compareId(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Build reusable task and reverse-requirement Maps without modifying data. */
export function buildIndex(data) {
  const byId = new Map(data.tasks.map(task => [task.id, task]));
  const reverse = new Map(data.tasks.map(task => [task.id, new Set()]));
  for (const task of data.tasks) {
    for (const requirement of task.requires ?? []) {
      if (!reverse.has(requirement.task)) reverse.set(requirement.task, new Set());
      reverse.get(requirement.task).add(task.id);
    }
  }
  const unlocks = new Map([...reverse].map(([id, ids]) => [id, [...ids].sort(compareId)]));
  return { byId, unlocks };
}

/**
 * Return unique unfinished prerequisites as {task: ID, status: string[], depth}.
 * Preserve all status alternatives, unioning statuses for shared prerequisites.
 * Depth is the longest distance from the target (direct prerequisites: 1).
 * Done prerequisites prune their entire branch; held/active tasks remain included.
 * Sort deepest first, then by ID. For cycles, mark the revisited ancestor and
 * omit the back edge for depth/order calculations. A cyclic target can therefore
 * appear at depth 0 with cycle:true; cyclic edges cannot have topological order.
 * Missing referenced IDs are retained as leaves; an unknown target returns [].
 */
export function prerequisiteChain(index, state, taskId) {
  if (!index.byId.has(taskId)) return [];
  const entries = new Map();
  const colors = new Map();
  const edges = new Map();
  const postorder = [];
  /** Discover edges once, cutting DFS back edges to make depth computation safe. */
  function visit(id) {
    colors.set(id, 1);
    const children = new Set();
    edges.set(id, children);
    const requirements = [...(index.byId.get(id)?.requires ?? [])]
      .sort((a, b) => compareId(a.task, b.task));
    for (const requirement of requirements) {
      const child = requirement.task;
      if (state.done?.[child]) continue;
      if (!entries.has(child)) entries.set(child, { task: child, status: [], depth: 0 });
      const entry = entries.get(child);
      for (const status of requirement.status) {
        if (!entry.status.includes(status)) entry.status.push(status);
      }
      if (colors.get(child) === 1) {
        entry.cycle = true;
        continue;
      }
      children.add(child);
      if (!colors.has(child)) visit(child);
    }
    colors.set(id, 2);
    postorder.push(id);
  }
  visit(taskId);
  const depths = new Map([[taskId, 0]]);
  for (const id of postorder.reverse()) {
    for (const child of edges.get(id)) {
      depths.set(child, Math.max(depths.get(child) ?? 0, depths.get(id) + 1));
    }
  }
  for (const entry of entries.values()) entry.depth = depths.get(entry.task) ?? 0;
  return [...entries.values()].sort((a, b) => b.depth - a.depth || compareId(a.task, b.task));
}

/** Return direct dependents as {task: ID, status: string[]}, sorted by ID. */
export function unlocksOf(index, taskId) {
  return (index.unlocks.get(taskId) ?? []).map(id => ({
    task: id,
    status: [...new Set((index.byId.get(id)?.requires ?? [])
      .filter(requirement => requirement.task === taskId)
      .flatMap(requirement => requirement.status))],
  }));
}

/** Return sorted unique task IDs with completion-triggered failIf in either direction. */
export function exclusiveWith(index, taskId) {
  const result = new Set();
  for (const condition of index.byId.get(taskId)?.failIf ?? []) {
    if (condition.status.includes('complete')) result.add(condition.task);
  }
  for (const task of index.byId.values()) {
    if ((task.failIf ?? []).some(condition =>
      condition.task === taskId && condition.status.includes('complete'))) result.add(task.id);
  }
  result.delete(taskId);
  return [...result].sort(compareId);
}

/**
 * Rank known held, unfinished tasks by unique unfinished reachable dependents.
 * Return {task: ID, direct: count, total: count}, ordered by total descending,
 * then ID. Total includes direct dependents, excludes the starting task, and
 * traverses done intermediates without counting them. These are structural
 * relations across all requirement statuses, not a prediction of availability.
 */
export function keystones(index, state, limit = 5) {
  const result = [];
  for (const id of index.byId.keys()) {
    if (!state.held?.[id] || state.done?.[id]) continue;
    const directIds = new Set(index.unlocks.get(id) ?? []);
    directIds.delete(id);
    const direct = [...directIds].filter(child => !state.done?.[child]).length;
    const visited = new Set([id]);
    const pending = [...directIds];
    let total = 0;
    while (pending.length) {
      const child = pending.pop();
      if (visited.has(child)) continue;
      visited.add(child);
      if (!state.done?.[child]) total++;
      pending.push(...(index.unlocks.get(child) ?? []));
    }
    result.push({ task: id, direct, total });
  }
  return result.sort((a, b) => b.total - a.total || compareId(a.task, b.task))
    .slice(0, Math.max(0, limit));
}

/**
 * For every task: {direct, total} dependents, structurally (all requirement statuses). total counts unique tasks
 * reachable through unlocks, excluding the task itself. Used for "unlocks N" on task rows (after TarkovTracker).
 */
export function unlockTotals(index) {
  const out = new Map();
  for (const id of index.byId.keys()) {
    const seen = new Set(), stack = [...(index.unlocks.get(id) ?? [])];
    while (stack.length) {
      const next = stack.pop();
      if (next === id || seen.has(next)) continue;
      seen.add(next);
      stack.push(...(index.unlocks.get(next) ?? []));
    }
    out.set(id, { direct: (index.unlocks.get(id) ?? []).length, total: seen.size });
  }
  return out;
}
