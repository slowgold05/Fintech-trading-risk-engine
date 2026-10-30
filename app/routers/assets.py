from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.asset import Asset
from app.schemas.asset import AssetOut

router = APIRouter(dependencies=[Depends(get_current_user)])


@router.get("/", response_model=list[AssetOut])
def list_assets(db: Session = Depends(get_db)):
    return db.execute(select(Asset)).scalars().all()
