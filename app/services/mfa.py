import base64
import hashlib
import hmac
import secrets
import struct
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

from fastapi import HTTPException
from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.mfa import MfaFactor
from app.models.user import User


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _now_ts() -> float:
    return time.time()


def _keystream(nonce: bytes, size: int) -> bytes:
    produced = b""
    counter = 0
    while len(produced) < size:
        produced += hmac.new(
            settings.jwt_secret.encode(),
            b"mfa-v1" + nonce + counter.to_bytes(4, "big"),
            hashlib.sha256,
        ).digest()
        counter += 1
    return produced[:size]


def encrypt_secret(secret: str) -> str:
    raw = secret.encode()
    nonce = secrets.token_bytes(16)
    stream = _keystream(nonce, len(raw))
    cipher = bytes(left ^ right for left, right in zip(raw, stream))
    return base64.b64encode(nonce + cipher).decode()


def decrypt_secret(ciphertext: str) -> str:
    blob = base64.b64decode(ciphertext.encode())
    nonce, cipher = blob[:16], blob[16:]
    stream = _keystream(nonce, len(cipher))
    return bytes(left ^ right for left, right in zip(cipher, stream)).decode()


def new_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def totp_code(secret: str, at: float | None = None) -> str:
    padded = secret + "=" * ((8 - len(secret) % 8) % 8)
    key = base64.b32decode(padded, casefold=True)
    counter = int((at if at is not None else _now_ts()) // 30)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    number = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return f"{number % 1_000_000:06d}"


def matching_step(secret: str, code: str, last_counter: int | None) -> int | None:
    if len(code) != 6 or not code.isdigit():
        return None
    current = int(_now_ts() // 30)
    for step in range(current - 1, current + 2):
        if last_counter is not None and step <= last_counter:
            continue
        if hmac.compare_digest(totp_code(secret, step * 30), code):
            return step
    return None


def provisioning_uri(email: str, secret: str) -> str:
    label = quote(f"Sentinel Markets:{email}")
    return f"otpauth://totp/{label}?secret={secret}&issuer=Sentinel%20Markets&algorithm=SHA1&digits=6&period=30"


def confirmed_factor(db: Session, user_id: int) -> MfaFactor | None:
    return db.execute(select(MfaFactor).where(
        MfaFactor.user_id == user_id, MfaFactor.confirmed_at.is_not(None))).scalar_one_or_none()


def begin_enrollment(db: Session, user: User) -> dict:
    row = db.execute(
        select(MfaFactor).where(MfaFactor.user_id == user.id).with_for_update().execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if row is not None and row.confirmed_at is not None:
        raise HTTPException(status_code=409, detail="An authenticator is already enrolled")
    secret = new_secret()
    ciphertext = encrypt_secret(secret)
    if row is None:
        db.add(MfaFactor(user_id=user.id, method="totp", secret_ciphertext=ciphertext))
    else:
        row.secret_ciphertext = ciphertext
        row.last_counter = None
    db.commit()
    return {"secret": secret, "otpauth_uri": provisioning_uri(user.email, secret)}


def confirm_enrollment(db: Session, user: User, code: str) -> None:
    row = db.execute(
        select(MfaFactor).where(MfaFactor.user_id == user.id).with_for_update().execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="No authenticator setup is waiting")
    if row.confirmed_at is not None:
        raise HTTPException(status_code=409, detail="An authenticator is already enrolled")
    step = matching_step(decrypt_secret(row.secret_ciphertext), code, row.last_counter)
    if step is None:
        raise HTTPException(status_code=401, detail="Authenticator code is incorrect")
    won = db.execute(
        update(MfaFactor)
        .where(MfaFactor.id == row.id, MfaFactor.confirmed_at.is_(None))
        .where(or_(MfaFactor.last_counter.is_(None), MfaFactor.last_counter < step))
        .values(confirmed_at=_now(), last_counter=step)
        .returning(MfaFactor.id)
        .execution_options(synchronize_session="fetch")
    ).scalar_one_or_none()
    if won is None:
        raise HTTPException(status_code=409, detail="An authenticator is already enrolled")
    db.commit()


def consume_totp(db: Session, user_id: int, code: str | None) -> int | None:
    factor = db.execute(
        select(MfaFactor)
        .where(MfaFactor.user_id == user_id, MfaFactor.confirmed_at.is_not(None))
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if factor is None or not code or not str(code).strip():
        return None
    step = matching_step(decrypt_secret(factor.secret_ciphertext), str(code).strip(), factor.last_counter)
    if step is None:
        return None
    won = db.execute(
        update(MfaFactor)
        .where(MfaFactor.id == factor.id)
        .where(or_(MfaFactor.last_counter.is_(None), MfaFactor.last_counter < step))
        .values(last_counter=step)
        .returning(MfaFactor.id)
        .execution_options(synchronize_session="fetch")
    ).scalar_one_or_none()
    if won is None:
        return None
    factor.last_counter = step
    return step


def consume_login_challenge(db: Session, challenge_id: int, code: str | None) -> User:
    from app.models.mfa import LoginChallenge

    now = _now()
    preview = db.get(LoginChallenge, challenge_id)
    if preview is None or preview.consumed_at is not None or preview.expires_at <= now:
        raise HTTPException(status_code=401, detail="Authenticator challenge is invalid or expired")
    user = db.get(User, preview.user_id)
    if user is None or consume_totp(db, user.id, code) is None:
        raise HTTPException(status_code=401, detail="Authenticator code is incorrect")
    locked = db.execute(
        select(LoginChallenge).where(LoginChallenge.id == challenge_id).with_for_update().execution_options(populate_existing=True)
    ).scalar_one()
    if locked.consumed_at is not None or locked.expires_at <= now:
        raise HTTPException(status_code=401, detail="Authenticator challenge is invalid or expired")
    won = db.execute(
        update(LoginChallenge)
        .where(LoginChallenge.id == locked.id, LoginChallenge.consumed_at.is_(None))
        .values(consumed_at=now)
        .returning(LoginChallenge.id)
        .execution_options(synchronize_session="fetch")
    ).scalar_one_or_none()
    if won is None:
        raise HTTPException(status_code=401, detail="Authenticator challenge is invalid or expired")
    locked.consumed_at = now
    return user


def check_mfa_enrollment(db: Session) -> dict:
    users = db.execute(select(User.id)).scalars().all()
    confirmed = set(db.execute(select(MfaFactor.user_id).where(MfaFactor.confirmed_at.is_not(None))).scalars())
    missing = [user_id for user_id in users if user_id not in confirmed]
    return {"checked": len(users), "violation_count": len(missing), "missing_user_ids": missing[:20]}


def challenge_expiry() -> datetime:
    return _now() + timedelta(minutes=5)
