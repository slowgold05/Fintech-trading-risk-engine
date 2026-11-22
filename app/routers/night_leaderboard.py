from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_trader
from app.models.user import User
from app.routers.night_notebook import NotebookRoute
from app.schemas.night_leaderboard import LeaderboardMe, LeaderboardOut, LeaderboardPreference
from app.services import night_leaderboard


router = APIRouter(prefix="/night/leaderboard", route_class=NotebookRoute)


@router.get("", response_model=LeaderboardOut)
def get_leaderboard(db: Session = Depends(get_db), user: User = Depends(get_current_trader)):
    return night_leaderboard.read_leaderboard(db, user)


@router.put("/me", response_model=LeaderboardMe)
def put_preference(
    payload: LeaderboardPreference, db: Session = Depends(get_db), user: User = Depends(get_current_trader),
):
    return night_leaderboard.set_preference(db, user.id, payload)
