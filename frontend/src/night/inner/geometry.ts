export type Sample = { label: string; values: readonly (number | null)[] };
export type XY = [number, number];

export const fixed = (n: number) => Number(n.toFixed(2));
export const valid = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
export function polar(angle: number, radius: number): XY {
  return [fixed(160 + Math.sin(angle) * radius), fixed(160 - Math.cos(angle) * radius)];
}
export const sweep = Math.PI * 1.77;
export const angleAt = (fraction: number) => (fraction - 0.5) * sweep;
export const fractionAt = (index: number, count: number) => (count <= 1 ? 0.5 : index / (count - 1));

export function traces(samples: readonly Sample[], series: number, project: (i: number, v: number) => XY) {
  const runs: XY[][] = [];
  let run: XY[] = [];
  for (const [i, sample] of samples.entries()) {
    const v = sample.values[series];
    if (valid(v)) {
      if (run.length === 0) runs.push(run);
      run.push(project(i, v));
    } else {
      run = [];
    }
  }
  return runs;
}

export function pathOf(run: readonly XY[]) {
  return run.length ? "M" + run.map((p) => p.join(",")).join("L") : "";
}

export function sector(start: number, end: number, inner: number, outer: number) {
  const large = end - start > Math.PI ? 1 : 0;
  return `M${polar(start, outer)}A${outer},${outer} 0 ${large} 1 ${polar(end, outer)}L${polar(end, inner)}A${inner},${inner} 0 ${large} 0 ${polar(start, inner)}Z`;
}
