"""Create live operating samples for halt, price-band, idempotency, and access review.

The script talks only to the HTTP API. It always tries to leave trading open.
Passwords stay in the environment and are not printed.
"""

import json
import os
import secrets
import urllib.error
import urllib.parse
import urllib.request
from decimal import Decimal, ROUND_HALF_UP


def api_base() -> str:
    return os.environ.get("API_BASE_URL", "https://fintechapp-preview.gps5zt7wg4yqg.us-east-2.cs.amazonlightsail.com/api").rstrip("/")


def request(method: str, path: str, token: str | None = None, body: dict | None = None,
            form: dict | None = None, headers: dict | None = None) -> tuple[int, dict | list | str]:
    data = None
    request_headers = dict(headers or {})
    if token:
        request_headers["Authorization"] = f"Bearer {token}"
    if form is not None:
        data = urllib.parse.urlencode(form).encode()
        request_headers["Content-Type"] = "application/x-www-form-urlencoded"
    elif body is not None:
        data = json.dumps(body).encode()
        request_headers["Content-Type"] = "application/json"
    req = urllib.request.Request(api_base() + path, data=data, headers=request_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            raw = response.read().decode()
            return response.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode()
        try:
            parsed = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            parsed = raw
        return exc.code, parsed


def login(email: str, password: str) -> str:
    status, payload = request("POST", "/auth/login", form={"username": email, "password": password})
    if status != 200 or not isinstance(payload, dict) or "access_token" not in payload:
        raise SystemExit(f"Login failed for {email} with status {status}")
    return payload["access_token"]


def env_account(prefix: str) -> tuple[str, str]:
    aliases = {"COMPLIANCE": ("COMPLIANCE_OFFICER_EMAIL", "COMPLIANCE_OFFICER_PASSWORD")}
    email = os.environ.get(f"{prefix}_EMAIL", "").strip()
    password = os.environ.get(f"{prefix}_PASSWORD", "")
    if (not email or not password) and prefix in aliases:
        email_key, password_key = aliases[prefix]
        email = os.environ.get(email_key, "").strip()
        password = os.environ.get(password_key, "")
    if not email or not password:
        raise SystemExit(f"{prefix}_EMAIL and {prefix}_PASSWORD are required")
    return email, password


def _sample_file() -> str:
    return os.path.join(os.getcwd(), ".env.phase2-sample")


def _load_sample_trader() -> tuple[str, str] | None:
    path = _sample_file()
    if not os.path.exists(path):
        return None
    values = {}
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            if "=" not in line or line.strip().startswith("#"):
                continue
            key, value = line.strip().split("=", 1)
            values[key] = value
    email = values.get("TRADER_EMAIL", "").strip()
    password = values.get("TRADER_PASSWORD", "")
    if email and password:
        return email, password
    return None


def _save_sample_trader(email: str, password: str) -> None:
    with open(_sample_file(), "w", encoding="utf-8") as handle:
        handle.write(f"TRADER_EMAIL={email}\nTRADER_PASSWORD={password}\n")


def _login_status(email: str, password: str) -> int:
    status, payload = request("POST", "/auth/login", form={"username": email, "password": password})
    if status == 200 and isinstance(payload, dict) and payload.get("access_token"):
        return 200
    return status


def ensure_trader() -> tuple[str, str, int | None]:
    email = os.environ.get("TRADER_EMAIL", "").strip()
    password = os.environ.get("TRADER_PASSWORD", "")
    if email and password:
        return email, password, None
    saved = _load_sample_trader()
    if saved is not None:
        return saved[0], saved[1], None
    last_status = None
    for _ in range(2):
        email = f"phase2-ops-{secrets.token_hex(3)}@example.com"
        password = secrets.token_urlsafe(18)
        status, payload = request("POST", "/auth/register", body={"email": email, "password": password})
        last_status = status
        if status == 400:
            continue
        if status == 200 or _login_status(email, password) == 200:
            _save_sample_trader(email, password)
            note = "Registered" if status == 200 else f"Register returned {status}, but login succeeded for"
            print(f"{note} trader {email}. Password saved in ignored .env.phase2-sample")
            return email, password, status
        detail = payload if isinstance(payload, dict) else "unavailable"
        raise SystemExit(f"Trader registration failed with status {status}: {detail}")
    raise SystemExit(f"Trader registration failed with status {last_status}: unavailable")


def leave_trading_open(admin_token: str) -> None:
    status, state = request("GET", "/compliance/trading-halt", token=admin_token)
    if status == 200 and isinstance(state, dict) and state.get("operator_halted"):
        resume, _ = request("PUT", "/compliance/trading-halt", token=admin_token,
                            body={"halted": False, "reason": "Resume after operating sample"})
        if resume != 200:
            raise SystemExit(f"Could not resume trading after sample setup: {resume}")


def sample_trading_halt(admin_token: str) -> dict:
    status, state = request("GET", "/compliance/trading-halt", token=admin_token)
    if status != 200 or not isinstance(state, dict):
        raise SystemExit(f"Could not read trading halt: {status}")
    if state.get("operator_halted"):
        request("PUT", "/compliance/trading-halt", token=admin_token,
                body={"halted": False, "reason": "SM-PT-01 sample reset before halt"})
    halted, halt_body = request("PUT", "/compliance/trading-halt", token=admin_token,
                                body={"halted": True, "reason": "SM-PT-01 operating sample"})
    resumed, resume_body = request("PUT", "/compliance/trading-halt", token=admin_token,
                                   body={"halted": False, "reason": "SM-PT-01 operating sample resume"})
    if halted != 200 or resumed != 200:
        raise SystemExit(f"Trading halt sample failed: halt {halted}, resume {resumed}")
    return {"halt": halt_body.get("halted") if isinstance(halt_body, dict) else None,
            "resume": resume_body.get("halted") if isinstance(resume_body, dict) else None}


def candidate_quotes() -> list[tuple[str, Decimal]]:
    status, payload = request("GET", "/market/heatmap?limit=1000")
    if status != 200 or not isinstance(payload, dict):
        return []
    candidates = []
    for item in payload.get("items", []):
        if item.get("data_status") == "stale":
            continue
        price = Decimal(str(item.get("price") or "0"))
        if Decimal("10") <= price <= Decimal("500"):
            candidates.append((item["symbol"], price))
    return candidates


def open_orders(trader_token: str) -> list[dict]:
    status, payload = request("GET", "/orders/?limit=100", token=trader_token)
    if status != 200 or not isinstance(payload, dict):
        raise SystemExit(f"Could not list orders: {status}")
    return payload.get("orders", [])


def sample_open_order(trader_token: str) -> dict:
    existing_ids = {order["id"] for order in open_orders(trader_token)}
    for symbol, price in candidate_quotes()[:8]:
        limit = (price * Decimal("0.90")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        key = "phase2-" + secrets.token_hex(8)
        body = {"symbol": symbol, "side": "buy", "order_type": "limit", "quantity": "1", "limit_price": str(limit)}
        headers = {"Idempotency-Key": key}
        first_status, first = request("POST", "/orders/", token=trader_token, body=body, headers=headers)
        if first_status == 200 and isinstance(first, dict) and first.get("status") == "open":
            second_status, second = request("POST", "/orders/", token=trader_token, body=body, headers=headers)
            if second_status != 200 or not isinstance(second, dict) or second.get("id") != first.get("id"):
                raise SystemExit(f"Idempotent retry did not replay order {first.get('id')}")
            return {"symbol": symbol, "order_id": first["id"], "limit_price": str(limit), "replayed": True, "replay_status": 200}
        created = [
            order for order in open_orders(trader_token)
            if order["id"] not in existing_ids and order.get("symbol") == symbol and order.get("status") == "open"
        ]
        if not created:
            continue
        if len(created) != 1:
            raise SystemExit(f"Expected one new open order for {symbol}")
        order_id = created[0]["id"]
        second_status, _second = request("POST", "/orders/", token=trader_token, body=body, headers=headers)
        again = [
            order for order in open_orders(trader_token)
            if order["id"] not in existing_ids and order.get("symbol") == symbol
        ]
        if len(again) != 1 or again[0]["id"] != order_id or again[0].get("status") != "open":
            raise SystemExit(f"Idempotent retry did not keep a single open order {order_id}")
        return {"symbol": symbol, "order_id": order_id, "limit_price": str(limit),
                "replayed": True, "replay_status": second_status}
    raise SystemExit("No open in-band order could be placed. Refresh quotes and confirm trading is open.")


def sample_access_review(admin_token: str, compliance_token: str) -> dict:
    submitted = 0
    for token in (compliance_token, admin_token):
        status, payload = request("GET", "/compliance/access-review", token=token)
        if status != 200 or not isinstance(payload, dict):
            raise SystemExit(f"Could not list the access review: {status}")
        me_status, me = request("GET", "/auth/me", token=token)
        if me_status != 200 or not isinstance(me, dict):
            raise SystemExit("Could not identify the reviewer")
        for account in payload["accounts"]:
            if account["status"] != "unreviewed" or account["user_id"] == me["id"]:
                continue
            review_status, _ = request("POST", "/compliance/access-review", token=token, body={
                "user_id": account["user_id"], "decision": "retain",
                "reason": "Q4 2026 phase-2 review. Demo account retained. No role change."})
            if review_status not in {200, 409}:
                raise SystemExit(f"Access review failed for user {account['user_id']} with status {review_status}")
            submitted += review_status == 200
    status, payload = request("GET", "/compliance/access-review", token=compliance_token)
    remaining = [account["user_id"] for account in payload.get("accounts", []) if account["status"] == "unreviewed"] if isinstance(payload, dict) else []
    return {"submitted": submitted, "unreviewed_user_ids": remaining}


def main() -> None:
    admin_email, admin_password = env_account("ADMIN")
    compliance_email, compliance_password = env_account("COMPLIANCE")
    errors = []
    register_status = None
    trader_token = None
    try:
        trader_email, trader_password, register_status = ensure_trader()
    except SystemExit as exc:
        errors.append(str(exc))
        trader_email = trader_password = None
    admin_token = login(admin_email, admin_password)
    compliance_token = login(compliance_email, compliance_password)
    if trader_email and trader_password:
        try:
            trader_token = login(trader_email, trader_password)
        except SystemExit as exc:
            errors.append(str(exc))
    halt = None
    order = None
    try:
        halt = sample_trading_halt(admin_token)
    except SystemExit as exc:
        errors.append(str(exc))
    finally:
        leave_trading_open(admin_token)
    if trader_token:
        try:
            order = sample_open_order(trader_token)
        except SystemExit as exc:
            errors.append(str(exc))
    else:
        order = None
    try:
        review = sample_access_review(admin_token, compliance_token)
    except SystemExit as exc:
        review = None
        errors.append(str(exc))
    print(json.dumps({
        "halt": halt,
        "order": order,
        "access_review": review,
        "register_status": register_status,
        "errors": errors,
    }, sort_keys=True))
    if errors or (review and review["unreviewed_user_ids"]):
        raise SystemExit("Operating sample did not finish cleanly")


if __name__ == "__main__":
    main()
