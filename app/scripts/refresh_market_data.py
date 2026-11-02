import argparse
import json

from app.core.database import SessionLocal
from app.services.market_cache_service import refresh_quote_cache
from app.services.nasdaq_universe_service import sync_nasdaq_universe


def main() -> None:
    parser = argparse.ArgumentParser(description="Refresh the public market-data cache.")
    parser.add_argument("--sync-universe", action="store_true", help="Sync Nasdaq Trader symbols first.")
    parser.add_argument("--tier", choices=["hot", "daily"], default="hot")
    parser.add_argument("--source", choices=["eod", "alpha_vantage"], default="eod")
    parser.add_argument("--limit", type=int, default=50)
    args = parser.parse_args()

    if args.limit < 1 or args.limit > 1000:
        parser.error("--limit must be between 1 and 1000")

    db = SessionLocal()
    try:
        result = {}
        if args.sync_universe:
            result["universe"] = sync_nasdaq_universe(db)
        result["quotes"] = refresh_quote_cache(db, args.tier, args.limit, source=args.source)
        print(json.dumps(result, indent=2))
        if result["quotes"]["errors"]:
            raise SystemExit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
