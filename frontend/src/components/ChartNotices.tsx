import bricolageLicense from "../marketLooks/terrain/fonts/bricolage-grotesque-LICENSE.txt?url";
import plexLicense from "../marketLooks/terrain/fonts/ibm-plex-mono-LICENSE.txt?url";

export function ChartNotices({ includeTypefaces = false }: { includeTypefaces?: boolean } = {}) {
  return (
    <div className="chart-notices space-y-2 border-t border-slate-800 pt-4">
      <p className="text-xs leading-5 text-slate-400">
        TradingView Lightweight Charts™, Copyright ({"\u0441"}) 2025 TradingView, Inc.{" "}
        <a
          className="text-emerald-300 underline decoration-emerald-400/40 underline-offset-2 hover:text-emerald-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/50"
          href="https://www.tradingview.com/"
          rel="noreferrer"
          target="_blank"
        >
          https://www.tradingview.com/
        </a>
      </p>
      <p className="text-xs leading-5 text-slate-400">
        <a
          className="text-emerald-300 underline decoration-emerald-400/40 underline-offset-2 hover:text-emerald-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/50"
          href="/licenses/lightweight-charts-LICENSE.txt"
        >
          lightweight-charts license
        </a>
        {" · "}
        <a
          className="text-emerald-300 underline decoration-emerald-400/40 underline-offset-2 hover:text-emerald-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/50"
          href="/licenses/lightweight-charts-NOTICE.txt"
        >
          lightweight-charts notice
        </a>
        {" · "}
        <a
          className="text-emerald-300 underline decoration-emerald-400/40 underline-offset-2 hover:text-emerald-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/50"
          href="/licenses/fancy-canvas-LICENSE.txt"
        >
          fancy-canvas license
        </a>
      </p>
      {includeTypefaces && <p>Typefaces · <a href={bricolageLicense}>Bricolage Grotesque license</a> · <a href={plexLicense}>IBM Plex Mono license</a></p>}
    </div>
  );
}
