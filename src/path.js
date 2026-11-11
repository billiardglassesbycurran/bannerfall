// A* pathfinding on the 128x128 walkability grid (8 directions, no corner cutting), with path smoothing.
import { N, cellWalk } from './world.js';

const g = new Float32Array(N * N), came = new Int32Array(N * N), seen = new Uint32Array(N * N), shut = new Uint32Array(N * N);
let stamp = 0;
const heap = new Int32Array(N * N * 2), hf = new Float32Array(N * N * 2); let hn = 0;
function push(i, f) { let k = hn++; while (k > 0) { const p = (k - 1) >> 1; if (hf[p] <= f) break; heap[k] = heap[p]; hf[k] = hf[p]; k = p; } heap[k] = i; hf[k] = f; }
function pop() {
  const top = heap[0], li = heap[--hn], lf = hf[hn]; let k = 0;
  while (true) { let c = 2 * k + 1; if (c >= hn) break; if (c + 1 < hn && hf[c + 1] < hf[c]) c++; if (hf[c] >= lf) break; heap[k] = heap[c]; hf[k] = hf[c]; k = c; }
  heap[k] = li; hf[k] = lf; return top;
}
const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];

/** Straight-line walkable check (used to smooth paths). */
export function lineWalk(ax, az, bx, bz) {
  const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / .3);
  for (let i = 1; i <= n; i++) { const t = i / n; if (!cellWalk((ax + (bx - ax) * t) | 0, (az + (bz - az) * t) | 0)) return false; }
  return true;
}

/**
 * Path from (sx,sz) to within `reach` metres of (tx,tz). Returns [{x,z},...] (may be partial if unreachable).
 */
export function findPath(sx, sz, tx, tz, reach = 0, maxNodes = 7000) {
  if (lineWalk(sx, sz, tx, tz) && reach === 0) return [{ x: tx, z: tz }];
  stamp++; hn = 0;
  const s = (sz | 0) * N + (sx | 0), tcx = tx | 0, tcz = tz | 0, r2 = Math.max(reach, .75) ** 2;
  const goalOK = (cx, cz) => reach > 0 ? (cx + .5 - tx) ** 2 + (cz + .5 - tz) ** 2 <= r2 : (cx === tcx && cz === tcz);
  g[s] = 0; came[s] = -1; seen[s] = stamp; push(s, 0);
  let best = s, bestH = 1e9, found = -1, nodes = 0;
  while (hn > 0 && nodes++ < maxNodes) {
    const i = pop(); if (shut[i] === stamp) continue; shut[i] = stamp;
    const cx = i % N, cz = (i / N) | 0;
    if (goalOK(cx, cz)) { found = i; break; }
    const h = Math.hypot(cx - tcx, cz - tcz); if (h < bestH) { bestH = h; best = i; }
    for (const [dx, dz, c] of DIRS) {
      const nx = cx + dx, nz = cz + dz; if (!cellWalk(nx, nz)) continue;
      if (dx && dz && (!cellWalk(cx + dx, cz) || !cellWalk(cx, cz + dz))) continue;
      const j = nz * N + nx, ng = g[i] + c;
      if (seen[j] === stamp && ng >= g[j]) continue;
      seen[j] = stamp; g[j] = ng; came[j] = i; push(j, ng + Math.hypot(nx - tcx, nz - tcz) * 1.05);
    }
  }
  let end = found >= 0 ? found : best;
  const cells = []; for (let k = end; k !== -1 && k !== s; k = came[k]) cells.push(k);
  cells.reverse();
  const pts = cells.map(k => ({ x: k % N + .5, z: ((k / N) | 0) + .5 }));
  if (found >= 0 && reach === 0 && cellWalk(tcx, tcz)) { if (pts.length) pts[pts.length - 1] = { x: tx, z: tz }; else pts.push({ x: tx, z: tz }); }
  // smooth: skip waypoints we can see past
  const out = []; let ax = sx, az = sz, k = 0;
  while (k < pts.length) {
    let far = k; for (let m = Math.min(pts.length - 1, k + 12); m > k; m--) if (lineWalk(ax, az, pts[m].x, pts[m].z)) { far = m; break; }
    out.push(pts[far]); ax = pts[far].x; az = pts[far].z; k = far + 1;
  }
  return out;
}

/** Nearest walkable cell centre to (x,z), searching outward. */
export function nearestWalkable(x, z, maxR = 8) {
  if (cellWalk(x | 0, z | 0)) return { x, z };
  for (let r = 1; r <= maxR; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
    const cx = (x | 0) + dx, cz = (z | 0) + dz; if (cellWalk(cx, cz)) return { x: cx + .5, z: cz + .5 };
  }
  return null;
}
