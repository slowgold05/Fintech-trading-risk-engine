import { useSearchParams } from "react-router-dom";
import { Watchlists } from "../../../components/Watchlists";
import { Page } from "../../kit";

export function WatchlistsScreen() {
  const [params] = useSearchParams();
  const requested = params.get("symbol")?.toUpperCase() ?? "";
  const symbol = /^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(requested) ? requested : "";
  return <Page title="Watchlists" description="Private lists saved to your account." testId="night-watchlists" className="watch-page">
    <Page.Full><Watchlists key={symbol} initialSymbol={symbol} standalone /></Page.Full>
  </Page>;
}
