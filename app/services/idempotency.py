from hashlib import sha256
import json
from typing import Callable

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.order_request import OrderRequest


def execute_once(db: Session, user_id: int, key: str, operation: str,
                 payload: BaseModel, execute: Callable[[], dict]) -> dict:
    fingerprint = sha256(json.dumps({"operation": operation, "payload": payload.model_dump(mode="json")},
                                    sort_keys=True).encode()).hexdigest()

    def replay() -> dict | None:
        prior = db.execute(select(OrderRequest).where(OrderRequest.user_id == user_id,
                                                       OrderRequest.idempotency_key == key)).scalar_one_or_none()
        if prior is None:
            return None
        if prior.request_hash != fingerprint:
            raise HTTPException(status_code=409, detail="Idempotency key was used for a different request")
        return prior.response

    try:
        previous = replay()
        if previous is not None:
            return previous
        record = OrderRequest(user_id=user_id, idempotency_key=key, request_hash=fingerprint)
        db.add(record)
        db.flush()
        response = jsonable_encoder(execute())
        record.response = response
        db.commit()
        return response
    except IntegrityError:
        db.rollback()
        previous = replay()
        if previous is not None:
            return previous
        raise
    except Exception:
        db.rollback()
        raise
