import { lazy, Suspense } from "react";
import { useLook } from "../night/looks/preferences";
import { MarketSelection, useMarketState } from "../night/looks/marketSelection";
import { ChromeTools } from "../night/shell/ChromeTools";
import { State } from "../night/kit";

const Terrain = lazy(() => import("./TerrainMarket").then(m => ({ default: m.TerrainMarket })));
const Dial = lazy(() => import("./DialMarket").then(m => ({ default: m.DialMarket })));

export function Home() {
  const { prefs } = useLook();
  const selection = useMarketState();
  return <div data-testid="night-market" className="night-market">
    <div className="night-market-tools"><span>Paper trading</span><ChromeTools market /></div>
    <MarketSelection.Provider value={selection}>
      <Suspense fallback={<State kind="loading" title="Loading market instruments…" />}>
        {prefs.look === "terrain" ? <Terrain /> : <Dial />}
      </Suspense>
    </MarketSelection.Provider>
  </div>;
}
