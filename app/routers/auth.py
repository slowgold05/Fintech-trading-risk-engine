import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, Field
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
from app.models.mfa import LoginChallenge
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.services.ledger_service import ensure_opening
from app.services.sanctions import normalize_name, record_screen, screen_name
from app.schemas.user import UserCreate, UserOut
from app.services.login_lockout import (
    clear_login_failures,
    enforce_login_lockout,
    record_login_failure,
)
from app.services.login_risk import assess_login, record_login_event
from app.services.mfa import begin_enrollment, challenge_expiry, confirm_enrollment, confirmed_factor, consume_login_challenge

router = APIRouter()
REFRESH_COOKIE_NAME = "refresh_token"


class MfaCode(BaseModel):
    code: str = Field(min_length=6, max_length=6, pattern=r"^[0-9]{6}$")


class LegalName(BaseModel):
    full_name: str = Field(min_length=3, max_length=255)


class MfaEnroll(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=8, max_length=72)


class MfaEnrollConfirm(MfaEnroll):
    code: str = Field(min_length=6, max_length=6, pattern=r"^[0-9]{6}$")


class MfaLogin(BaseModel):
    challenge_id: int = Field(gt=0)
    code: str = Field(min_length=6, max_length=6, pattern=r"^[0-9]{6}$")


def _authenticated_user(db: Session, email: str, password: str) -> User:
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    password_ok = verify_password_or_dummy(password, user.password_hash if user is not None else None)
    if user is None or not password_ok:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password")
    return user


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
def register(request: Request, response: Response, payload: UserCreate, db: Session = Depends(get_db)):
    exists = db.execute(
        select(User).where(User.email == payload.email)
    ).scalar_one_or_none()

    if exists:
        raise HTTPException(status_code=400, detail="Email already registered")

    cleaned_name = normalize_name(payload.full_name)
    screen_result = screen_name(payload.full_name) if cleaned_name else None
    if screen_result is not None and screen_result["decision"] != "clear":
        detail = "Sanctions screening is unavailable" if screen_result["decision"] == "provider_error" else "This name is blocked by sanctions screening"
        raise HTTPException(status_code=403, detail=detail)

    user = User(
        email=payload.email,
        password_hash=hash_password(payload.password),
        full_name=payload.full_name.strip() if cleaned_name and payload.full_name else None,
    )
    db.add(user)
    db.flush()
    ensure_opening(db, user)
    if screen_result is not None:
        record_screen(db, user, "onboarding", screen_result)
    db.commit()
    db.refresh(user)
    return user


@router.put("/name")
@limiter.limit("5/minute")
def set_legal_name(request: Request, response: Response, payload: LegalName, db: Session = Depends(get_db),
                   current_user: User = Depends(get_current_user)):
    result = screen_name(payload.full_name)
    if result["decision"] != "clear":
        record_screen(db, current_user, "onboarding", result)
        db.commit()
        detail = "Sanctions screening is unavailable" if result["decision"] == "provider_error" else "This name is blocked by sanctions screening"
        raise HTTPException(status_code=403, detail=detail)
    current_user.full_name = payload.full_name.strip()
    record_screen(db, current_user, "onboarding", result)
    db.commit()
    return {"full_name": current_user.full_name}


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
        record_login_event(db, form.username, request, "failure", 0, [], user.id if user else None)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    clear_login_failures(form.username, request)
    assessment = assess_login(db, user, request)
    factor = confirmed_factor(db, user.id)
    if factor is None and (settings.mfa_required or assessment["step_up"]):
        record_login_event(db, user.email, request, "denied", assessment["score"], assessment["reasons"], user.id,
                           ip=assessment["ip"], agent=assessment["user_agent_hash"])
        db.commit()
        detail = "MFA enrollment is required" if settings.mfa_required else "This login needs an authenticator before a session can be issued"
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)
    if factor is not None:
        challenge = LoginChallenge(user_id=user.id, expires_at=challenge_expiry(), risk_score=assessment["score"],
                                   reasons=json.dumps(assessment["reasons"]))
        db.add(challenge)
        record_login_event(db, user.email, request, "step_up", assessment["score"], assessment["reasons"], user.id,
                           ip=assessment["ip"], agent=assessment["user_agent_hash"])
        db.commit()
        db.refresh(challenge)
        return {"mfa_required": True, "challenge_id": challenge.id, "reasons": assessment["reasons"]}

    _issue_refresh_token(db, user, request, response)
    record_login_event(db, user.email, request, "success", assessment["score"], assessment["reasons"], user.id,
                       ip=assessment["ip"], agent=assessment["user_agent_hash"])
    db.commit()

    token = create_access_token(user_id=user.id)
    return {
        "access_token": token,
        "token_type": "bearer",
        "mfa_required": False,
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


@router.post("/login/mfa")
@limiter.limit("5/minute")
def complete_mfa_login(request: Request, response: Response, payload: MfaLogin, db: Session = Depends(get_db)):
    user = consume_login_challenge(db, payload.challenge_id, payload.code)
    challenge = db.get(LoginChallenge, payload.challenge_id)
    _issue_refresh_token(db, user, request, response)
    record_login_event(db, user.email, request, "success", challenge.risk_score, json.loads(challenge.reasons),
                       user.id, step_up_satisfied=True)
    db.commit()
    return {"access_token": create_access_token(user_id=user.id), "token_type": "bearer", "mfa_required": False}


@router.post("/mfa/setup")
@limiter.limit("5/minute")
def setup_mfa(request: Request, response: Response, db: Session = Depends(get_db),
              current_user: User = Depends(get_current_user)):
    return begin_enrollment(db, current_user)


@router.post("/mfa/confirm")
@limiter.limit("5/minute")
def confirm_mfa(request: Request, response: Response, payload: MfaCode, db: Session = Depends(get_db),
                current_user: User = Depends(get_current_user)):
    confirm_enrollment(db, current_user, payload.code)
    return {"enabled": True}


@router.post("/mfa/enroll")
@limiter.limit("5/minute")
def enroll_mfa(request: Request, response: Response, payload: MfaEnroll, db: Session = Depends(get_db)):
    return begin_enrollment(db, _authenticated_user(db, payload.email, payload.password))


@router.post("/mfa/enroll/confirm")
@limiter.limit("5/minute")
def confirm_mfa_enrollment(request: Request, response: Response, payload: MfaEnrollConfirm, db: Session = Depends(get_db)):
    user = _authenticated_user(db, payload.email, payload.password)
    confirm_enrollment(db, user, payload.code)
    return {"enabled": True}


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    """
    Returns the currently authenticated user.
    """
    return current_user
