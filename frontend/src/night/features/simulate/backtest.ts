import type { Strategy } from "./simulation";

export const backtest: Strategy = {
  id: "backtest", label: "Buy and hold",
  description: "Invest once at the first stored close and hold through the last priced session.",
};
