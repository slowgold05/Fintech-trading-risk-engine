# Simulated liquidity

The system counterparty lets a single trader practice buying and selling stocks. The order ticket shows the number of shares, execution price, counterparty type, and reason any shares would remain. Quotes, balances, controls, and opposing orders can change between preview and confirmation. The ticket sends the previewed quote timestamp with the confirmation, and the API revalidates the order.

## Prices and size

1. The incoming order first uses eligible customer orders in price-time priority at each resting order's price. Orders from the incoming account are excluded. If a customer match fails its controls, the submission rolls back.
2. The simulator uses the remaining quantity and the usable raw close from the quote cache. Market orders can trade at that close. For a limit order, only the close is checked. It must be at or below the buy limit, or at or above the sell limit.
3. The simulator fills up to `SIMULATED_LIQUIDITY_MAX_SHARES` per customer order per observed close. The default is 100 shares and supports fractional order quantities. The cap is independent of reported volume and applies separately to each order's simulated shares. A fill whose value rounds to zero cents waits or cancels under the usual order-type rules.
4. Unfilled market quantity cancels immediately. Limit quantity stays open and retains its cash or share reservation until filled or canceled. Each newer confirmed close for the symbol triggers another check of open limits, in price-time order within each side. A resting order can receive another tranche only at a later session's confirmed close. If the price band, trading halt, or another control blocks an order, it stays open with the reason. Opposing customer orders can match between refreshes under the normal controls.

Massive and Yahoo refresh use prior completed sessions when simulation is enabled. Yahoo bars already in the cache from the session in which they were fetched cannot establish a close. The Alpha Vantage fallback uses the default end-of-day quote. Trading still requires the existing quote freshness and price-band checks. Refresh frequency and provider coverage determine how soon open limits are rechecked. [Alpha Vantage quote documentation](https://www.alphavantage.co/documentation/#latestprice)

## Accounting and provenance

The first simulated fill creates the reserved `sentinel:simulated-liquidity` system account. This internal account is ineligible for registration or sign-in. The system reuses received cash and shares and issues only the shortfall for its own leg. Every issuance has balanced cash or position and offset postings in the system's hash chain. Issued shares get a lot at the reference price. Both sides then use the normal settlement function for cash, FIFO lots, and ledger postings. The two simulated trade rows share the customer's order ID and execution time. Only customer orders appear in the book and reserve customer resources.

Preview fill entries use `counterparty: "user"` or `counterparty: "simulated"`. Simulated trades and order-detail fill rows carry `simulated_quote_date`, the session date of the close used. An order's top-level `simulated_quote_date` is its most recent simulated fill date. Each fill keeps its own date. `remainder_reason` describes the remainder at the last evaluation. The user sees “Simulated liquidity at the latest end-of-day close, <date>.” The date describes the reference at the time of the fill.

Customer-side risk checks and trade assessments still run. Market-behavior surveillance keeps genuine customer orders, cancels, and customer-to-customer prints and excludes synthetic prints from both legs. AML cash-event intake excludes the system account. Issuance is recorded separately from customer deposits and withdrawals. Ledger reconciliation includes the system account.

## Operations and limits

- Set `SIMULATED_LIQUIDITY_ENABLED=false` to use customer-to-customer matching only and disable quote sweeps. Existing fills and their provenance remain readable.
- Run Alembic and apply the restricted application-role grants before starting the API. Roll back execution behavior with the setting so existing provenance remains intact.
- The simulator models paper accounting at a published daily reference. Real market depth, bid/ask spreads, queue position, slippage, intraday limit crossings, and broker execution are outside its model. The separate direct-trade API is outside this path.
