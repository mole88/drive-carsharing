from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import current_user, optional_user, throttle
from app.models import User
from app.schemas import BoardOut, LeaderRow, ScoreInput, ScoreOut
from app.services import game
from app.services.game import week_of

router = APIRouter(prefix="/api/game", tags=["Тест-драйв"])


@router.post("/scores", response_model=ScoreOut, status_code=201)
def submit_score(
    data: ScoreInput,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    throttle(db, f"game-score:{user.id}", limit=40)
    row, improved = game.submit(db, user, data)
    return ScoreOut(
        accepted=True,
        improved=improved,
        score=row.score,
        level=row.level,
        week=row.week,
        personal=game.personal(db, user, week=week_of()),
    )


@router.get("/leaderboard", response_model=BoardOut)
def leaderboard(
    period: str = Query("week", pattern="^(week|all)$"),
    category: str | None = Query(None, pattern="^(economy|comfort|business)$"),
    limit: int = Query(10, ge=1, le=25),
    offset: int = Query(0, ge=0, le=500),
    user: User | None = Depends(optional_user),
    db: Session = Depends(get_db),
):
    """Таблица открыта и гостям: соревнование видно сразу, запись — только для входа."""
    week = None if period == "all" else week_of()
    rows, totals = game.board(
        db,
        week=week,
        category=category,
        limit=limit,
        offset=offset,
        viewer_id=user.id if user else None,
    )
    return BoardOut(
        period=period,
        week=week,
        category=category,
        rows=[LeaderRow(**row) for row in rows],
        totals=totals,
        me=game.personal(db, user, week=week, category=category) if user else None,
    )
