import { SimulationRoute } from "./SimulationRoute";
import { backtest } from "./backtest";

export function BacktestScreen() {
  return <SimulationRoute strategies={[backtest]} />;
}
