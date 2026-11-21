"""Backfill or top up two years of keyless Yahoo Finance daily history."""

import argparse
import json

from app.core.database import SessionLocal
from app.services.yahoo_history import refresh_yahoo_history


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--symbols", nargs="+", help="Limit the run to these symbols.")
    parser.add_argument("--force", action="store_true", help="Re-fetch even if the latest session is stored.")
    parser.add_argument("--refresh-quotes", action="store_true", help="Also populate Yahoo end-of-day quotes.")
    args = parser.parse_args()

    def on_symbol(symbol, error, processed, total):
        print(f"{processed}/{total} {symbol} {error or 'stored'}", flush=True)

    with SessionLocal() as db:
        report = refresh_yahoo_history(
            db,
            symbols=list(dict.fromkeys(symbol.upper() for symbol in args.symbols)) if args.symbols else None,
            force=args.force,
            refresh_quotes=args.refresh_quotes,
            on_symbol=on_symbol,
        )
    print(json.dumps(report, indent=2), flush=True)
    if not report["symbols"] or report["errors"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
