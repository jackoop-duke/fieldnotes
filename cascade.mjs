// Marking something done or accepted implies its prerequisites (Jack 2026-10-04): pure helpers that list
// what else must be marked. The UI asks before applying large cascades and offers undo.
import { onRoute } from "./story.mjs";

const isDone = (state, o) => (state.prog[o.id] || 0) >= (o.count || 1);

/**
 * Earlier required story steps implied by completing `objective` in chapter task `task`.
 * A route-specific step implies earlier steps that are common or share one of its routes. A common step
 * implies earlier route-specific steps only on the player's chosen routes (none chosen: common steps only).
 * @returns {object[]} objectives, in play order
 */
export function storyPrerequisites(task, objective, state) {
  const chosen = [].concat((state.storyRoute || {})[task.id] || []);
  const routes = objective.routes || [];
  return task.objectives.filter((o) => o.seq < objective.seq && !o.optional && !isDone(state, o) && (
    !o.routes.length ||
    (routes.length ? o.routes.some((r) => routes.includes(r)) : chosen.length > 0 && onRoute(o, chosen))
  ));
}

/**
 * Prerequisite tasks implied by completing or accepting task `taskId` (both need the same prerequisites).
 * A prerequisite required as "complete" (or "complete or failed") becomes done; one required only as
 * "active" (accepted) becomes held, and its own prerequisites are still required. A prerequisite that has
 * already failed (a fail condition met by a done task, e.g. the other branch of an exclusive pair) is not
 * marked and is not traversed. That includes tasks this cascade marks done (and the task itself): e.g.
 * Protect the Sky accepts Battery Change (Stick in the Wheel copy) as failed, which it is once the
 * Stabilize Business copy is done. Done prerequisites end their branch. Unknown ids are ignored.
 * @returns {{done: string[], held: string[]}} task ids, deepest first
 */
export function taskPrerequisites(data, state, taskId) {
  const byId = new Map(data.tasks.map((t) => [t.id, t]));
  let need, depth, willDone = new Set([taskId]);
  const isDoneTask = (id) => state.done[id] || willDone.has(id);
  const failed = (t) => (t.failIf || []).some((f) => isDoneTask(f.task) && (f.status || []).includes("complete"));
  const visit = (id, d, seen) => {
    const t = byId.get(id);
    if (!t) return;
    for (const r of t.requires || []) {
      const p = byId.get(r.task);
      if (!p || state.done[p.id] || failed(p)) continue;
      const kind = (r.status || []).some((s) => s === "complete" || s === "failed") ? "done" : "held";
      if (kind === "done" || !need.has(p.id)) need.set(p.id, kind);
      depth.set(p.id, Math.max(depth.get(p.id) || 0, d));
      if (!seen.has(p.id)) { seen.add(p.id); visit(p.id, d + 1, seen); }
    }
  };
  // Repeat until the implied done set is stable: each pass can reveal branches that fail.
  for (let pass = 0; pass < 10; pass++) {
    need = new Map(); depth = new Map();
    visit(taskId, 1, new Set());
    const next = new Set([taskId, ...[...need].filter(([, k]) => k === "done").map(([id]) => id)]);
    if (next.size === willDone.size && [...next].every((id) => willDone.has(id))) break;
    willDone = next;
  }
  const order = [...need.keys()].sort((a, b) => depth.get(b) - depth.get(a) || (a < b ? -1 : 1));
  return { done: order.filter((id) => need.get(id) === "done"),
    held: order.filter((id) => need.get(id) === "held" && !state.held[id]) };
}
