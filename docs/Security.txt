# Security Architecture and Controls

## Security Philosophy

This project is built with a **security-first mindset**, reflecting common controls used in financial and trading systems. The design prioritizes confidentiality, integrity, auditability, and least privilege.

---

## Authentication and Authorization

### OAuth2 Password Flow

* Users authenticate via `/auth/login`
* Access tokens are issued as **JWT Bearer tokens**
* Tokens must be supplied in the `Authorization` header

### Token Security

* JWTs are signed using a secret key (HS256)
* Token validation is enforced on all protected endpoints
* `/auth/me` provides identity verification

---

## Password Handling

* Passwords are **never stored or logged in plaintext**
* Passwords are hashed using **bcrypt** via `passlib`
* Length validation prevents bcrypt overflow
* Verification is performed using constant-time comparison

---

## API Protection

* All trading, portfolio, and risk endpoints require authentication
* Swagger UI supports authenticated testing via the Authorize mechanism
* Unauthorized access returns HTTP 401

---

## Database Security

* SQLAlchemy ORM prevents SQL injection attacks
* No raw SQL is used with user-supplied input
* Database schema changes are versioned with Alembic

---

## Auditability and Integrity

* Trades are immutable once created
* FIFO lots preserve execution order and cost basis
* Realized P&L is derived deterministically from lot consumption
* Risk alerts are linked to individual trades

---

## Future Security Enhancements

* Role-based access control (RBAC)
* Token expiration and refresh flow
* Rate limiting and abuse detection
* Centralized logging and monitoring
