import { lazy, Suspense, type ComponentProps } from "react";
import type { TerrainComparisonPlot } from "./TerrainComparisonPlot";
import type { DialPulseChart } from "./DialPulseChart";

const TerrainPlot = lazy(() => import("./TerrainComparisonPlot").then(m => ({default:m.TerrainComparisonPlot})));
const DialPlot = lazy(() => import("./DialPulseChart").then(m => ({default:m.DialPulseChart})));

type Props = ({ variant?: "terrain" } & ComponentProps<typeof TerrainComparisonPlot>)
  | ({ variant: "dial" } & ComponentProps<typeof DialPulseChart>);

export function IndexComparisonChart(props: Props) {
  return <Suspense fallback={<p aria-live="polite">Loading index comparison…</p>}>
    {props.variant === "dial" ? <DialPlot {...props} /> : <TerrainPlot {...props} />}
  </Suspense>;
}
