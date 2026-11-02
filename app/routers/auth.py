from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.core.config import settings
from app.core.database import get_db
from app.core.rate_limit import limiter
from app.core.security import (
    hash_password,
    verify_password_or_dummy,
    create_access_token,
    create_refresh_token,
    hash_refresh_token,
    get_current_user,
)
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.services.ledger_service import ensure_opening
from app.schemas.user import UserCreate, UserOut
from app.services.login_lockout import (
    clear_login_failures,
    enforce_login_lockout,
    record_login_failure,
)

router = APIRouter()
REFRESH_COOKIE_NAME = "refresh_token"


def _request_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=token,
        max_age=settings.refresh_token_exp_days * 24 * 60 * 60,
        httponly=True,
        secure=settings.refresh_cookie_secure,
        samesite="lax",
        path="/",
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(key=REFRESH_COOKIE_NAME, path="/", samesite="lax")


def _issue_refresh_token(db: Session, user: User, request: Request, response: Response) -> None:
    token = create_refresh_token()
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=hash_refresh_token(token),
            expires_at=datetime.utcnow() + timedelta(days=settings.refresh_token_exp_days),
            user_agent=request.headers.get("user-agent"),
            ip=_request_ip(request),
        )
    )
    _set_refresh_cookie(response, token)


@router.post("/register", response_model=UserOut)
@limiter.limit("5/minute")
def register(request: Request, payload: UserCreate, db: Session = Depends(get_db)):
    exists = db.execute(
        select(User).where(User.email == payload.email)
    ).scalar_one_or_none()

    if exists:
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=payload.email,
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    db.flush()
    ensure_opening(db, user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/login")
@limiter.limit("5/minute")
def login(
    request: Request,
    response: Response,
    form: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    enforce_login_lockout(form.username, request)

    # OAuth2PasswordRequestForm uses fields: username, password
    user = db.execute(
        select(User).where(User.email == form.username)
    ).scalar_one_or_none()

    password_ok = verify_password_or_dummy(
        form.password,
        user.password_hash if user is not None else None,
    )
    if user is None or not password_ok:
        record_login_failure(form.username, request)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    clear_login_failures(form.username, request)
    _issue_refresh_token(db, user, request, response)
    db.commit()

    token = create_access_token(user_id=user.id)
    return {
        "access_token": token,
        "token_type": "bearer",
    }


@router.post("/refresh")
def refresh(request: Request, response: Response, db: Session = Depends(get_db)):
    refresh_token = request.cookies.get(REFRESH_COOKIE_NAME)
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing refresh token")

    row = db.execute(
        select(RefreshToken).where(
            RefreshToken.token_hash == hash_refresh_token(refresh_token),
            RefreshToken.revoked_at.is_(None),
            RefreshToken.expires_at > datetime.utcnow(),
        )
    ).scalar_one_or_none()

    if row is None:
        _clear_refresh_cookie(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    user = db.execute(select(User).where(User.id == row.user_id)).scalar_one_or_none()
    if user is None:
        row.revoked_at = datetime.utcnow()
        db.commit()
        _clear_refresh_cookie(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    row.revoked_at = datetime.utcnow()
    _issue_refresh_token(db, user, request, response)
    db.commit()

    return {
        "access_token": create_access_token(user_id=user.id),
        "token_type": "bearer",
    }


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    refresh_token = request.cookies.get(REFRESH_COOKIE_NAME)
    if refresh_token:
        row = db.execute(
            select(RefreshToken).where(
                RefreshToken.token_hash == hash_refresh_token(refresh_token),
                RefreshToken.revoked_at.is_(None),
            )
        ).scalar_one_or_none()
        if row is not None:
            row.revoked_at = datetime.utcnow()
            db.commit()

    _clear_refresh_cookie(response)
    return {"ok": True}


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    """
    Returns the currently authenticated user.
    """
    return current_user
