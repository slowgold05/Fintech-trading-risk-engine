import { lazy, Suspense } from "react";
import { LookProvider } from "../marketLooks/LookProvider";
import { MarketSelection, useMarketState } from "../marketLooks/marketSelection";
import { useLook } from "../marketLooks/preferences";
import "../marketHeader.css";

const Terrain = lazy(() => import("./TerrainMarket").then(module => ({ default: module.TerrainMarket })));
const Dial = lazy(() => import("./DialMarket").then(module => ({ default: module.DialMarket })));

function MarketLooks() {
  const { look, setLook } = useLook();
  const selection = useMarketState();
  const next = look === "terrain" ? "dial" : "terrain";
  const label = next === "dial" ? "Dial" : "Terrain";

  return (
    <div className="market-looks">
      <header className="market-look-header">
        <span>Paper trading</span>
        <button type="button" className="nk-button" aria-label={`Switch to ${label}`}
          onClick={() => setLook(next)}>{label}</button>
      </header>
      <MarketSelection.Provider value={selection}>
        <Suspense fallback={<p className="nk-state" role="status">Loading market instruments…</p>}>
          {look === "terrain" ? <Terrain /> : <Dial />}
        </Suspense>
      </MarketSelection.Provider>
    </div>
  );
}

export function Market() {
  return <LookProvider><MarketLooks /></LookProvider>;
}
