# Fintech Trading & Risk Engine

## Overview

This repository contains a secure, backend-focused fintech trading system implemented using **FastAPI**, **SQLAlchemy**, **Alembic**, and **MySQL**. The application supports authenticated trading, FIFO-based accounting, portfolio valuation, and a rule-driven risk engine.

The project is designed to emphasise **security, correctness, and auditability**, aligning with real-world financial system expectations.

---

## Core Capabilities

* Secure user authentication using OAuth2 Password Flow (JWT)
* Buy and sell trades via a unified trading endpoint
* FIFO lot accounting for accurate realised P&L
* Portfolio aggregation with unrealised and realised P&L
* Live price abstraction with caching
* Rule-based risk assessment and alerting
* Auto-generated API documentation (Swagger / OpenAPI)

---

## Technology Stack

* **API Framework:** FastAPI
* **ORM:** SQLAlchemy
* **Migrations:** Alembic
* **Database:** MySQL
* **Authentication:** JWT (OAuth2 Password Bearer)
* **Password Hashing:** bcrypt (via passlib)

---

## Project Structure

```
fintechapp/
├── app/
│   ├── core/          # configuration, database, security
│   ├── models/        # ORM models
│   ├── schemas/       # request/response schemas
│   ├── routers/       # API routes
│   ├── services/      # pricing and risk logic
│   └── main.py        # application entrypoint
├── alembic/           # database migrations
├── alembic.ini
└── README.md
```

---

## Running the Application

```bash
python -m uvicorn app.main:app --reload
```

Ensure that:

* MySQL is running
* Environment variables are configured (DB URL, JWT secret)
* Alembic migrations have been applied

---

## API Documentation

Once running, the API documentation is available at:

* **Swagger UI:** [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

---

## Version History (Summary)

* **v1.0.0** – Secure authentication and base infrastructure
* **v1.1.0** – Trading and holdings support
* **v1.2.0** – Live pricing service
* **v1.3.0** – Risk engine and alerts
* **v1.4.0** – FIFO lots and realized P&L
* **v1.5.0** – Portfolio-level realized + unrealized P&L

Detailed security and architecture information is available in the accompanying documentation files.
