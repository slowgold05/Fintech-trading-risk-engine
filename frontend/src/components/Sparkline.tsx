export type SparklineProps = {
  values: readonly number[];
  /** Prefix for the accessible name. Direction is appended so color is not the only signal. */
  label: string;
  className?: string;
};

const WIDTH = 120;
const HEIGHT = 36;
const PAD = 3;

function linePoints(values: readonly number[]): string {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;

  return values
    .map((value, index) => {
      const x = PAD + (index / (values.length - 1)) * (WIDTH - PAD * 2);
      // A flat series stays centered so equal closes still draw a line.
      const y = span === 0
        ? HEIGHT / 2
        : PAD + (1 - (value - min) / span) * (HEIGHT - PAD * 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

export function Sparkline({ values, label, className }: SparklineProps) {
  const points = values.filter((value) => Number.isFinite(value));
  if (points.length < 2) {
    return null;
  }

  const first = points[0];
  const last = points[points.length - 1];
  const direction = last > first ? "up" : last < first ? "down" : "flat";
  const tone = last >= first ? "stroke-emerald-400" : "stroke-rose-400";

  return (
    <svg
      aria-label={`${label}, ${direction}`}
      className={["block", className ?? "h-8 w-full"].join(" ")}
      preserveAspectRatio="none"
      role="img"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
    >
      <polyline
        className={tone}
        fill="none"
        points={linePoints(points)}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
