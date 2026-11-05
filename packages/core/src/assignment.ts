/**
 * Minimum-cost assignment (Hungarian / Kuhn–Munkres, O(n^3)) on a rectangular cost matrix.
 * Returns, for each row, the assigned column index or -1. Pairs whose cost is at or above
 * `rejectAt` are reported as unassigned rather than forced together.
 */
export function solveAssignment(cost: readonly (readonly number[])[], rejectAt = Number.POSITIVE_INFINITY): number[] {
  const rows = cost.length;
  const cols = rows === 0 ? 0 : (cost[0]?.length ?? 0);
  if (rows === 0 || cols === 0) return Array.from({ length: rows }, () => -1);

  const n = Math.max(rows, cols);
  const pad = Math.max(1, ...cost.flat().filter(Number.isFinite)) * 10 + 1;
  const at = (i: number, j: number): number => {
    const value = i < rows && j < cols ? (cost[i]?.[j] ?? pad) : pad;
    return Number.isFinite(value) ? value : pad;
  };

  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0);
  const way = new Array<number>(n + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY);
    const used = new Array<boolean>(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0]!;
      let delta = Number.POSITIVE_INFINITY;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = at(i0 - 1, j - 1) - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]!] = u[p[j]!]! + delta;
          v[j] = v[j]! - delta;
        } else {
          minv[j] = minv[j]! - delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0 !== 0);
  }

  const result = Array.from({ length: rows }, () => -1);
  for (let j = 1; j <= n; j++) {
    const i = p[j]! - 1;
    const col = j - 1;
    if (i < rows && col < cols) {
      const c = cost[i]?.[col];
      if (c !== undefined && Number.isFinite(c) && c < rejectAt) result[i] = col;
    }
  }
  return result;
}
