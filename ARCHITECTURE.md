# System Architecture

## Overview
The Fintech Trading & Risk Engine is a modular backend application designed to support authenticated trading, FIFO-based accounting, portfolio valuation, and rule-driven risk assessment. Responsibilities are separated by layer to improve maintainability, testability, security, and auditability.

---

## High-Level Architecture

Client (Swagger UI / Frontend)
|
v
FastAPI Routers (Auth, Trades, Portfolio, Risk)
|
v
Service Layer (Pricing Service, Risk Engine)
|
v
ORM Layer (SQLAlchemy Models)
|
v
MySQL Database


---

## Layer Responsibilities

### API Layer (Routers)
The API layer defines HTTP endpoints and is responsible for:
- Validating request payloads using Pydantic schemas
- Enforcing authentication on protected routes using dependency injection
- Coordinating database access via session dependencies
- Delegating business logic to service components where appropriate

Key routers:
- `/auth` – registration, login, identity retrieval (`/me`)
- `/trades` – trade creation (BUY/SELL) and execution workflow
- `/portfolio` – holdings aggregation and P&L reporting
- `/risk` – risk assessments and linked alerts

---

### Service Layer
The service layer isolates business logic that should not be embedded directly in routers.

**Pricing Service**
- Abstracts the retrieval of live prices for supported asset types
- Implements caching (TTL-based) to reduce external API calls
- Provides a stable interface to support future replacements (real-time feeds, paid providers, WebSockets)

**Risk Engine**
- Evaluates each trade at execution time
- Produces a risk score and an ordered set of explainable alerts
- Encapsulates risk rules to keep routing code thin and auditable

---

### Data Layer (ORM + Database)
The data layer consists of SQLAlchemy models and the underlying MySQL schema. The ORM enforces consistency and prevents injection-based attacks through parameterized queries.

Primary entities:
- **User** – authenticated identity
- **Asset** – tradable instrument (e.g., stock, crypto)
- **Trade** – immutable record of a BUY/SELL execution
- **Holding** – aggregated position per user and asset (quantity, average cost)
- **Lot** – FIFO accounting records created on BUY and consumed on SELL
- **RiskAssessment** – risk scoring results linked to a trade
- **RiskAlert** – explainable alerts linked to an assessment

Schema changes are applied using **Alembic** migrations to preserve traceability and support repeatable deployments.

---

## Trading Execution Flow

### 1. Authentication
1. User registers via `/auth/register`
2. User logs in via `/auth/login` to obtain a JWT
3. JWT is supplied as a Bearer token to access protected endpoints

### 2. BUY Trade
1. Client submits `POST /trades/` with `side = "buy"`
2. Pricing service returns a live price
3. A **Trade** record is created
4. A **Holding** is created or updated (weighted average cost model)
5. A **Lot** is created for FIFO accounting (quantity remaining, cost per unit)
6. Risk engine evaluates notional and produces a **RiskAssessment** and **RiskAlerts**
7. Transaction commits

### 3. SELL Trade (FIFO)
1. Client submits `POST /trades/` with `side = "sell"`
2. System validates the user has sufficient holdings
3. Pricing service returns a live price
4. A **Trade** record is created
5. FIFO lots are fetched oldest-first and consumed until the sell quantity is satisfied
6. **Realized P&L** is computed deterministically from lot cost basis vs sell price
7. **Holdings** are updated (quantity reduced; average cost recomputed from remaining lots)
8. Risk assessment and alerts are created and linked to the trade
9. Transaction commits

---

## Portfolio Computation Model

### Unrealized P&L
Unrealized P&L is computed from current holdings:
- `position_value = quantity × live_price`
- `cost_basis = quantity × avg_cost`
- `unrealized_pnl = position_value − cost_basis`

### Realized P&L
Realized P&L is computed at trade-time for SELLs using FIFO lot consumption:
- lots preserve time-ordered cost basis
- realized results are reproducible and auditable

### Portfolio Summary
The portfolio endpoint returns:
- positions (per asset) with live valuation and unrealized P&L
- summary including:
  - total portfolio value
  - total cost basis
  - total unrealized P&L
  - total realized P&L (aggregated from SELL trades)
  - total P&L (realized + unrealized)

---

## Design Principles

- **Separation of Concerns:** routers coordinate; services encapsulate rules; models represent state
- **Deterministic Accounting:** FIFO realized P&L is reproducible from persisted lots
- **Security by Default:** protected routes require JWT; password hashing is mandatory
- **Auditability:** trades and lots provide an execution trail suitable for validation
- **Extensibility:** pricing and risk logic are abstracted to support future enhancements

---

## Extension Points

- Replace or augment price sources (real-time quotes, paid APIs, WebSockets)
- Add portfolio history snapshots for time-series charts
- Expand risk rules (concentration, volatility, behavior-based alerts)
- Introduce RBAC and administrative endpoints
- Add frontend client (React / Next.js) consuming the same authenticated API
