import { SimulationRoute } from "./SimulationRoute";
import { backtest } from "./backtest";
import { recurring } from "./recurring";

export function SimulationModes() {
  return <SimulationRoute strategies={[backtest, recurring]} />;
}
