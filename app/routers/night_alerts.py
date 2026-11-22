from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_trader
from app.models.user import User
from app.routers.night_notebook import NotebookRoute
from app.schemas.night_alerts import AlertCollection, AlertCreate, AlertOut
from app.schemas.night_notebook import NotebookID, NotebookInput
from app.services import night_alerts


router = APIRouter(prefix="/night/alerts", route_class=NotebookRoute)


@router.get("", response_model=AlertCollection)
def list_alerts(db: Session = Depends(get_db), user: User = Depends(get_current_trader)):
    return night_alerts.list_alerts(db, user.id)


@router.post("", response_model=AlertOut, status_code=201)
def create_alert(payload: AlertCreate, db: Session = Depends(get_db), user: User = Depends(get_current_trader)):
    return night_alerts.create_alert(db, user.id, payload)


@router.post("/evaluate", response_model=AlertCollection)
def evaluate_alerts(
    payload: NotebookInput | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_trader),
):
    return night_alerts.evaluate_alerts(db, user.id)


@router.delete("/{alert_id}", status_code=204)
def delete_alert(alert_id: NotebookID, db: Session = Depends(get_db), user: User = Depends(get_current_trader)):
    night_alerts.delete_alert(db, user.id, alert_id)
    return Response(status_code=204)
