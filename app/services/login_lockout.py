from datetime import datetime, timedelta

from fastapi import HTTPException, Request, status


WINDOW = timedelta(minutes=15)
MAX_FAILURES = 10
_failures: dict[tuple[str, str], list[datetime]] = {}


def _client_ip(request: Request) -> str:
    if request.client is None:
        return "unknown"
    return request.client.host


def _key(email: str, request: Request) -> tuple[str, str]:
    return (email.strip().lower(), _client_ip(request))


def enforce_login_lockout(email: str, request: Request) -> None:
    now = datetime.utcnow()
    key = _key(email, request)
    recent = [item for item in _failures.get(key, []) if now - item < WINDOW]
    _failures[key] = recent

    if len(recent) >= MAX_FAILURES:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed login attempts. Try again later.",
            headers={"Retry-After": str(int(WINDOW.total_seconds()))},
        )


def record_login_failure(email: str, request: Request) -> None:
    key = _key(email, request)
    now = datetime.utcnow()
    _failures[key] = [item for item in _failures.get(key, []) if now - item < WINDOW] + [now]


def clear_login_failures(email: str, request: Request) -> None:
    _failures.pop(_key(email, request), None)
