import { SimulationRoute } from "./SimulationRoute";
import { recurring } from "./recurring";

export function RecurringScreen() {
  return <SimulationRoute strategies={[recurring]} />;
}
