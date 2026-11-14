from datetime import datetime, timedelta
import hashlib
import secrets
from typing import Optional

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
import jwt
from jwt.exceptions import InvalidTokenError
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.core.config import settings
from app.core.database import get_db
from app.models.user import User

# bcrypt only reads the first 72 bytes of a password. bcrypt < 5 dropped the rest
# silently and bcrypt >= 5 raises instead, so truncate here: hashes stored by
# earlier releases keep verifying and an over-long login cannot raise.
BCRYPT_MAX_PASSWORD_BYTES = 72

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def _password_bytes(password: str) -> bytes:
    return password.encode("utf-8")[:BCRYPT_MAX_PASSWORD_BYTES]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_password_bytes(password), bcrypt.gensalt()).decode("ascii")


DUMMY_PASSWORD_HASH = hash_password("missing-user-password-check")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(_password_bytes(password), password_hash.encode("utf-8"))


def verify_password_or_dummy(password: str, password_hash: str | None) -> bool:
    return verify_password(password, password_hash or DUMMY_PASSWORD_HASH)


def create_access_token(user_id: int, minutes: int | None = None) -> str:
    token_minutes = minutes if minutes is not None else settings.access_token_exp_minutes
    expire = datetime.utcnow() + timedelta(minutes=token_minutes)
    payload = {"sub": str(user_id), "exp": expire}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def decode_access_token(token: str) -> Optional[int]:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm],
                             options={"require": ["exp", "sub"]})
        sub = payload.get("sub")
        if sub is None:
            return None
        return int(sub)
    except (InvalidTokenError, ValueError):
        return None


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    user_id = decode_access_token(token)
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = db.execute(select(User).where(User.id == user_id)).scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def get_current_trader(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "trader":
        raise HTTPException(status_code=403, detail="Trader role required")
    return current_user


def get_current_compliance_user(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role not in {"compliance_officer", "admin", "auditor"}:
        raise HTTPException(status_code=403, detail="Compliance access required")
    return current_user
