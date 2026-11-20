import type {
  Logical,
  IChartApi,
  IPrimitivePaneRenderer,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesType,
} from "lightweight-charts";
import type { NormalizedSeries } from "../indexComparisonData";
import { formatSignedPercent } from "../../utils/format";

type Row = {
  symbol: string;
  color: string;
  volume: { time: string; value: number }[];
  series: NormalizedSeries | null;
};

// Draw in the library's own pane coordinates so labels follow resize, zoom and price scaling.
export function pulseMarks(
  chart: IChartApi,
  rows: Row[],
  handles: Map<string, ISeriesApi<SeriesType>>,
  selected: () => string | undefined,
  volume: ISeriesApi<"Histogram"> | null,
): ISeriesPrimitive {
  const texture = document.createElement("canvas");
  texture.width = 4;
  texture.height = 3;
  const ink = texture.getContext("2d");
  if (ink) {
    ink.fillStyle = "#75797d";
    ink.fillRect(0, 1, 2, 1);
  }
  let pattern: CanvasPattern | null = null;
  const renderer: IPrimitivePaneRenderer = {
    draw(target) {
      target.useMediaCoordinateSpace(({ context: ctx, mediaSize: { width, height } }) => {
        const scale = chart.timeScale();
        const volumes = rows.find((row) => row.symbol === selected())?.volume;
        if (volume && volumes?.length) {
          pattern ??= ctx.createPattern(texture, "repeat");
          const barWidth = Math.max(
            1,
            Math.abs(
              (scale.logicalToCoordinate(1 as Logical) ?? 0) - (scale.logicalToCoordinate(0 as Logical) ?? 0),
            ) - 1,
          );
          const floor = volume.priceToCoordinate(0) ?? height;
          ctx.fillStyle = pattern ?? "#55595d";
          for (const bar of volumes) {
            const x = scale.timeToCoordinate(bar.time);
            const y = volume.priceToCoordinate(bar.value);
            if (x != null && y != null && x >= 0 && x <= width)
              ctx.fillRect(x - barWidth / 2, y, barWidth, Math.max(0, floor - y));
          }
        }
        const compact = width < 410;
        const labelX = width - (compact ? 30 : 81);
        const ends = rows
          .flatMap((row) => {
            const end = row.series;
            if (!end) return [];
            const x = chart.timeScale().timeToCoordinate(end.asOf);
            const y = handles.get(row.symbol)?.priceToCoordinate(end.changePercent);
            if (x == null || y == null || x < 0 || x > width || y < 0 || y > height) return [];
            return [{ x: Number(x), y: Number(y), baseline: Number(y), row, value: end.changePercent }];
          })
          .sort((a, b) => a.y - b.y);
        const spacing = 15;
        let previous = -spacing + 9;
        for (const end of ends) {
          end.baseline = Math.max(end.y, previous + spacing);
          previous = end.baseline;
        }
        let next = height + spacing - 8;
        for (let i = ends.length - 1; i >= 0; i--) {
          ends[i].baseline = Math.min(ends[i].baseline, next - spacing);
          next = ends[i].baseline;
        }
        ctx.font = '10px "IBM Plex Mono", monospace';
        ctx.textBaseline = "middle";
        for (const end of ends) {
          const { x, y, baseline, row } = end;
          const ink = selected() === row.symbol ? "#f5c391" : row.color;
          const label = compact ? row.symbol : row.symbol + " " + formatSignedPercent(end.value);
          const start = Math.max(2, Math.min(labelX, width - ctx.measureText(label).width - 2));
          ctx.strokeStyle = ink;
          ctx.fillStyle = ink;
          ctx.globalAlpha = 0.65;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(start - 14, y);
          ctx.lineTo(start - 7, baseline);
          ctx.lineTo(start - 3, baseline);
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.beginPath();
          ctx.arc(x, y, 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillText(label, start, baseline);
        }
      });
    },
  };
  const views = [{ zOrder: () => "top" as const, renderer: () => renderer }];
  return { paneViews: () => views };
}
