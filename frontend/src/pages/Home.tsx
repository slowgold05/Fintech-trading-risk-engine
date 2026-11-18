import { lazy, Suspense } from "react";
import { Link } from "react-router-dom";
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
    <div className="night-market-tools">
      <div className="flex flex-wrap items-center gap-x-3">
        <span>Paper trading</span>
        <Link className="underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          to="/market/data-coverage">Data coverage</Link>
      </div>
      <ChromeTools market />
    </div>
    <MarketSelection.Provider value={selection}>
      <Suspense fallback={<State kind="loading" title="Loading market instruments…" />}>
        {prefs.look === "terrain" ? <Terrain /> : <Dial />}
      </Suspense>
    </MarketSelection.Provider>
  </div>;
}
