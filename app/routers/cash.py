from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, Header, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.rate_limit import limiter
from app.core.security import get_current_trader, get_current_user
from app.models.aml import CashMovement
from app.models.user import User
from app.services.aml_cases import run_live_aml
from app.services.cash_movements import authorize_withdrawal, post_movement
from app.services.detection_cursor import AML, mark_detection_pending
from app.services.idempotency import execute_once, stored_response
from app.services.order_step_up import require_notional_step_up
from app.services.sanctions import record_screen


router = APIRouter(dependencies=[Depends(get_current_user)])


class CashMovementCreate(BaseModel):
    kind: Literal["deposit", "withdrawal"]
    amount: Decimal = Field(gt=0, le=Decimal("1000000000"))


@router.get("/movements")
def list_movements(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.execute(select(CashMovement).where(CashMovement.user_id == current_user.id).order_by(CashMovement.id.desc())).scalars()
    return {"movements": [{"id": row.id, "kind": row.kind, "amount": row.amount, "created_at": row.created_at} for row in rows]}


@router.post("/movements")
@limiter.limit("30/minute")
def create_movement(request: Request, response: Response, payload: CashMovementCreate,
                    idempotency_key: str = Header(min_length=8, max_length=128, pattern=r"^[A-Za-z0-9_-]+$"),
                    step_up_code: str | None = Header(default=None, alias="X-Step-Up-Code"),
                    db: Session = Depends(get_db), current_user: User = Depends(get_current_trader)):
    replay = stored_response(db, current_user.id, idempotency_key, "cash_movement", payload)
    if replay is not None:
        _run_aml_after_movement(db)
        return replay
    screened = authorize_withdrawal(db, current_user) if payload.kind == "withdrawal" else None

    def execute() -> dict:
        require_notional_step_up(db, current_user, payload.amount, step_up_code)
        screening_id = record_screen(db, current_user, "payout", screened).id if screened is not None else None
        movement = post_movement(db, current_user, payload.kind, payload.amount, screening_id)
        return {"id": movement.id, "kind": movement.kind, "amount": movement.amount}

    result = execute_once(db, current_user.id, idempotency_key, "cash_movement", payload, execute)
    _run_aml_after_movement(db)
    return result


def _run_aml_after_movement(db: Session) -> None:
    try:
        run_live_aml(db)
    except Exception:
        db.rollback()
        mark_detection_pending(
            db, AML,
            datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=settings.scheduled_job_interval_hours),
        )
        db.commit()
