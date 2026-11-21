import { project as projectUnit } from "./terrainMesh";
import type { Surface } from "./terrainData";

export type Pixel = { x: number; y: number };
export type SurfaceDrawing = {
  image: HTMLCanvasElement;
};

function stroke(ctx: CanvasRenderingContext2D, points: (Pixel | null)[], color: string, width: number) {
  ctx.beginPath();
  let pen = false;
  for (const p of points) {
    if (!p) {
      pen = false;
      continue;
    }
    if (pen) ctx.lineTo(p.x, p.y);
    else ctx.moveTo(p.x, p.y);
    pen = true;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

export function drawSurface(
  surface: Surface,
  w: number,
  h: number,
  dpr: number,
  selected: number,
): SurfaceDrawing | null {
  const image = document.createElement("canvas");
  image.width = Math.round(w * dpr);
  image.height = Math.round(h * dpr);
  const ctx = image.getContext("2d");
  if (!ctx || !surface.ridges.length) return null;
  ctx.scale(dpr, dpr);
  const { dates, ridges, ceiling } = surface;
  const project = (t: number, d: number, z = 0) => {
    const p = projectUnit(t, d, z);
    return { x: p.x * w, y: p.y * h };
  };
  const floor = [project(0, 0), project(1, 0), project(1, 1), project(0, 1), project(0, 0)];
  const floorFill = ctx.createLinearGradient(0, h * 0.35, 0, h);
  floorFill.addColorStop(0, "#17191c");
  floorFill.addColorStop(1, "#292a2c");
  ctx.beginPath();
  floor.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.fillStyle = floorFill;
  ctx.fill();
  for (let i = 0; i <= 42; i++) stroke(ctx, [project(i / 42, 0), project(i / 42, 1)], "#494b503a", 0.75);
  for (let i = 0; i <= 20; i++) stroke(ctx, [project(0, i / 20), project(1, i / 20)], "#777a7d45", 0.6);
  for (let i = 0; i < 4; i++)
    stroke(
      ctx,
      floor.map((p) => ({ x: p.x, y: p.y + i * 2 })),
      i === 0 ? "#959798" : "#4b4c50",
      0.65,
    );
  const times = dates.map((d) => Date.parse(d));
  const fraction = times.map((t) => (t - times[0]) / (times.at(-1)! - times[0] || 1));
  const depthFor = (i: number) => i / Math.max(1, ridges.length - 1);
  const points = ridges.map((r, i) =>
    dates.map((d, k) => {
      const v = r.points.get(d);
      return v ? project(fraction[k], depthFor(i), v.amplitude / (ceiling || 1)) : null;
    }),
  );
  // Paint each strip back to front. The silvery facets encode the inclination
  // of the surface; the bright boundary wires belong to observed funds.
  function face(vertices: Pixel[], fill: string) {
    ctx!.beginPath();
    vertices.forEach((p, i) => (i ? ctx!.lineTo(p.x, p.y) : ctx!.moveTo(p.x, p.y)));
    ctx!.closePath();
    ctx!.fillStyle = fill;
    ctx!.fill();
  }
  for (let row = ridges.length - 1; row > 0; row--) {
    const back = points[row],
      front = points[row - 1];
    for (let k = 1; k < dates.length; k++) {
      const a = back[k - 1],
        b = back[k],
        c = front[k],
        d = front[k - 1];
      if (!a || !b || !c || !d) continue;
      const slope = (a.y - b.y + d.y - c.y) / Math.max(1, (b.x - a.x) * 2);
      const across = (d.y - a.y) / ((h * 0.445) / Math.max(1, ridges.length - 1));
      const shade = Math.round(Math.max(24, Math.min(133, 48 + slope * 15 + across * 8)));
      face([a, b, c, d], `rgb(${shade},${shade + 1},${shade + 3})`);
      if (k % Math.max(1, Math.round(dates.length / 25)) === 0) stroke(ctx, [b, c], "#cfcbc67d", 0.72);
    }
    for (let j = 1; j < (dates.length < 80 ? 3 : 1); j++) {
      const mix = j / 3;
      const between = front.map((a, k) => {
        const b = back[k];
        return a && b ? { x: a.x + (b.x - a.x) * mix, y: a.y + (b.y - a.y) * mix } : null;
      });
      stroke(ctx, between, j % 2 ? "#c4c7c39a" : "#b3b4b37a", 0.65);
    }
    stroke(ctx, back, row === selected ? "#f5ba7d" : "#b0b2b1", row === selected ? 2 : 0.85);
  }
  const front = points[0];
  for (let k = 1; k < dates.length; k++) {
    const a = front[k - 1],
      b = front[k];
    if (!a || !b) continue;
    const bottomA = project(fraction[k - 1], 0),
      bottomB = project(fraction[k], 0);
    face([a, b, bottomB, bottomA], "#252729");
    if (k % 2 === 0) stroke(ctx, [b, bottomB], "#777b7e80", 0.65);
  }
  stroke(ctx, front, selected === 0 ? "#f5ba7d" : "#c2c4c3", selected === 0 ? 2 : 0.9);
  return { image };
}
