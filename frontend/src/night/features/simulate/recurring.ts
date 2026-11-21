import type { Strategy } from "./simulation";

export const recurring: Strategy = {
  id: "recurring", label: "Recurring contributions",
  description: "Invest at the first stored close, then add a fixed amount each later month with a usable close.",
};
