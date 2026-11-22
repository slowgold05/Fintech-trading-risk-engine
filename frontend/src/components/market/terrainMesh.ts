import type { Surface } from "./terrainData";

// Unit coordinates keep the plot, axes and pointer tests on the same camera.
export const projection = {
  left: 0.082,
  timeX: 0.63,
  depthX: 0.205,
  base: 0.8,
  timeY: 0.075,
  depthY: -0.35,
  heightY: -0.475,
};
export function project(t: number, d: number, h = 0) {
  const p = projection;
  return { x: p.left + p.timeX * t + p.depthX * d, y: p.base + p.timeY * t + p.depthY * d + p.heightY * h };
}

type Node = {
  t: number;
  d: number;
  h: number;
  start: number;
  x: number;
  y: number;
  depth: number;
  row: number;
  col: number;
};
type Face = [Node, Node, Node];
const bucketCount = 72;
function bucket(x: number) {
  return Math.max(0, Math.min(bucketCount - 1, Math.floor(x * bucketCount)));
}

export function makeMesh(surface: Surface) {
  const dates = surface.dates.map(Date.parse);
  const time = dates.map((d) => (d - dates[0]) / (dates.at(-1)! - dates[0] || 1));
  const rows = surface.ridges.map((ridge, row) => {
    const d = row / Math.max(1, surface.ridges.length - 1);
    return surface.dates.map((date, col) => {
      const value = ridge.points.get(date);
      if (!value) return null;
      const t = time[col],
        h = value.amplitude / (surface.ceiling || 1);
      return { t, d, h, start: h, ...project(t, d, h), depth: d * 0.57 - t * 0.19 - h * 0.31, row, col };
    });
  });
  const peaks = rows.map((row) =>
    row.reduce<Node | null>((best, n) => (n && (!best || n.h > best.h) ? n : best), null),
  );
  // Pointer lookup is independent of drawing. Build its index on the first inspection.
  function indexFaces() {
    const nodes = Array.from({ length: bucketCount }, () => [] as Node[]);
    for (const row of rows) for (const p of row) if (p) nodes[bucket(p.x)].push(p);
    const buckets = Array.from({ length: bucketCount }, () => [] as Face[]);
    function face(a: Node, b: Node, c: Node) {
      const triangle: Face = [a, b, c];
      for (let k = bucket(Math.min(a.x, b.x, c.x)); k <= bucket(Math.max(a.x, b.x, c.x)); k++)
        buckets[k].push(triangle);
    }
    for (let r = 1; r < rows.length; r++)
      for (let c = 1; c < time.length; c++) {
        const a = rows[r - 1][c - 1],
          b = rows[r - 1][c],
          e = rows[r][c],
          f = rows[r][c - 1];
        if (a && b && e && f) {
          face(a, b, e);
          face(a, e, f);
        }
      }
    return { buckets, nodes };
  }
  let index: ReturnType<typeof indexFaces> | undefined;

  // The nearest projected ridge can be behind the mountain. Intersect visible
  // triangles and use the same depth ordering as the GPU before snapping.
  function pick(x: number, y: number, width: number, height: number) {
    const { buckets, nodes } = (index ??= indexFaces());
    let closest: Node | null = null,
      front = Infinity;
    const distance = (p: Node) => ((p.x - x) * width) ** 2 + ((p.y - y) * height) ** 2;
    for (const [a, b, c] of buckets[bucket(x)]) {
      const det = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
      if (Math.abs(det) < 1e-9) continue;
      const u = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / det;
      const v = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / det;
      const w = 1 - u - v;
      if (u < 0 || v < 0 || w < 0) continue;
      const depth = u * a.depth + v * b.depth + w * c.depth;
      if (depth >= front) continue;
      front = depth;
      closest = [a, b, c].reduce((n, p) => (distance(n) < distance(p) ? n : p));
    }
    if (closest) return closest;
    let radius = 18 ** 2;
    const reach = 18 / Math.max(1, width);
    for (let bin = bucket(x - reach); bin <= bucket(x + reach); bin++) {
      for (const p of nodes[bin]) {
        const squared = distance(p);
        if (squared < radius) {
          closest = p;
          radius = squared;
        }
      }
    }
    return closest;
  }
  return { time, rows, peaks, pick, surface };
}
export type Mesh = ReturnType<typeof makeMesh>;
