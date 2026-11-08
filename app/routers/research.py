from fastapi import APIRouter, Depends, HTTPException, Query
import requests
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.services.sec_service import get_sec_company_filings

router = APIRouter(dependencies=[Depends(get_current_user)])


@router.get("/filings/{symbol}")
def research_filings(
    symbol: str,
    forms: str | None = Query(default=None),
    limit: int = Query(default=10, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Previews a company's recent SEC EDGAR filings. Does not write to the caller's own book."""
    form_list = [item.strip() for item in forms.split(",")] if forms else None
    try:
        return get_sec_company_filings(symbol, db, forms=form_list, limit=limit)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except requests.RequestException:
        raise HTTPException(status_code=503, detail="SEC EDGAR is temporarily unavailable.")
