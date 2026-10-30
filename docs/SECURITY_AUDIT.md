# Security Audit

Date: 2026-06-17

## Scope

Reviewed the FastAPI backend, SQLAlchemy models, Alembic setup, authentication flow, pricing integration, and current trading/risk endpoints.

## Fixed In This Pass

- Risk endpoints now use the authenticated user instead of an undefined variable or `user_id = 1`.
- Assets endpoint now requires authentication.
- JWT algorithm and expiry now come from settings instead of hardcoded constants.
- Alembic online migrations now configure a connection and run migrations.
- Price-service errors no longer expose API-key-like values or upstream API payloads.
- External pricing failures are converted to HTTP 502 responses for trade and portfolio routes.
- Trade input now constrains `side` and `asset_type`, normalizes symbols, and rejects blank symbols.
- Frontend CORS support is configurable through `CORS_ORIGINS`.
- Added `.env.example` so setup does not depend on copying the real `.env`.
- Added `email-validator` to `requirements.txt` for Pydantic `EmailStr`.

## Remaining High-Priority Risks

1. No automated tests cover authentication, trade accounting, FIFO lot consumption, or risk authorization.
2. Trading operations are not protected against race conditions. Concurrent sells could oversell holdings unless database row locking or transactional constraints are added.
3. Money and quantity calculations mix `float` and `Numeric`. Use `Decimal` consistently before handling real funds.
4. JWTs have no refresh-token flow, revocation list, device/session tracking, or token rotation.
5. There is no rate limiting on login, registration, price lookups, or trade creation.
6. There is no idempotency key for trade creation. Retries can duplicate trades.
7. The live price provider is a single dependency and there is no stale-price policy, quote timestamp, or market-hours validation.
8. The app has no structured audit log for security-sensitive events.
9. The database credentials and API secrets are local environment concerns only; production should use a secret manager.

## AI Trader Requirements Before Automation

Do not let an AI agent place unrestricted trades directly against `POST /trades/`.

Minimum controls:

- Paper-trading mode first, with a separate simulated ledger.
- Explicit per-user opt-in for automation.
- Max notional per trade.
- Max daily loss.
- Max daily trade count.
- Allowed asset universe.
- Cooldown between trades.
- Kill switch.
- Human approval mode for live trading.
- Full decision log storing prompt/context, model output, risk checks, quote used, and final action.
- Server-side policy enforcement independent of the AI prompt.

Recommended architecture:

- `strategy_runs` table for AI decisions.
- `trade_intents` table for proposed trades.
- `risk_limits` table per user.
- AI produces a trade intent, not a trade.
- Backend validates the intent against deterministic risk limits.
- Frontend shows intent for approval unless the user enabled a tightly capped automation mode.

## Frontend Notes

The frontend can now use CORS by setting:

```env
CORS_ORIGINS=["http://localhost:3000","http://127.0.0.1:3000"]
```

Use JWT bearer auth from `/auth/login`, then call protected endpoints with:

```text
Authorization: Bearer <token>
```
