from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.core.database import get_db
from app.models.asset import Asset
from app.schemas.asset import AssetOut

router = APIRouter()


@router.get("/", response_model=list[AssetOut])
def list_assets(db: Session = Depends(get_db)):
    return db.execute(select(Asset)).scalars().all()
