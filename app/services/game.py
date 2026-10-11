"""Лидерборд ночного тест-драйва: один лучший заезд на игрока за неделю.

Пороги правдоподобия зеркалят таблицы ядра из app/static/game-core.js
(LEVEL_SECONDS, MAX_LEVEL). Тест tests/ui/game-balance.test.cjs следит,
чтобы константы не разъехались.
"""

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Car, GameScore, User, utcnow

LEVEL_SECONDS = 22
MAX_LEVEL = 30
LEVEL_SLACK = 2
SCORE_SLACK = 9000
KNOCK_SLACK = 12
RESULT_FIELDS = (
    "car_id",
    "car_name",
    "category",
    "score",
    "level",
    "knockdowns",
    "drones",
    "bribes",
    "profit_kopecks",
    "duration_seconds",
    "reason",
)


def week_of(value=None):
    year, week, _ = (value or utcnow()).isocalendar()
    return f"{year}-W{week:02d}"


def check(data):
    """Экран сам считает очки, поэтому на сервере проверяем только правдоподобие."""
    ceiling = min(MAX_LEVEL, 1 + data.duration_seconds // LEVEL_SECONDS + LEVEL_SLACK)
    if data.level > ceiling:
        raise HTTPException(422, "Уровень не совпадает с длительностью заезда")
    if data.score > data.duration_seconds * SCORE_SLACK:
        raise HTTPException(422, "Слишком много очков для такой поездки")
    if data.knockdowns > data.duration_seconds * KNOCK_SLACK:
        raise HTTPException(422, "Слишком много сбитых для такой поездки")


def stored(db: Session, user_id: int, week: str):
    return db.scalar(select(GameScore).where(GameScore.user_id == user_id, GameScore.week == week))


def submit(db: Session, user: User, data):
    """Оставляет лучший заезд недели; гонку двух вкладок переживает одна запись."""
    check(data)
    week = week_of()
    car_name = data.car_name.strip()[:125] or "Демо «Драйв Ночной»"
    category = data.category
    if data.car_id:
        car = db.get(Car, data.car_id)
        if not car:
            raise HTTPException(404, "Машина не найдена")
        car_name = f"{car.brand} {car.model}"[:125]
        category = car.category
    values = {
        "score": data.score,
        "car_id": data.car_id,
        "car_name": car_name,
        "category": category,
        "level": data.level,
        "knockdowns": data.knockdowns,
        "drones": data.drones,
        "bribes": data.bribes,
        "profit_kopecks": data.profit_kopecks,
        "duration_seconds": data.duration_seconds,
        "reason": data.reason,
        "updated_at": utcnow(),
    }
    for attempt in range(2):
        row = stored(db, user.id, week)
        if row and row.score >= data.score:
            db.rollback()
            return row, False
        if row:
            for field, value in values.items():
                setattr(row, field, value)
        else:
            db.add(GameScore(user_id=user.id, week=week, created_at=utcnow(), **values))
        try:
            db.commit()
        except IntegrityError as error:
            db.rollback()
            if attempt:
                raise HTTPException(
                    409, "Не удалось записать результат, попробуйте ещё раз"
                ) from error
            continue
        saved = stored(db, user.id, week)
        return saved, saved.score == data.score


def filters(week=None, category=None):
    conditions = []
    if week:
        conditions.append(GameScore.week == week)
    if category:
        conditions.append(GameScore.category == category)
    return conditions


def best_per_user(*conditions):
    """Нумерует повторы игрока так, чтобы первым остался его лучший заезд."""
    return (
        select(
            GameScore.id,
            func.row_number()
            .over(
                partition_by=GameScore.user_id,
                order_by=[GameScore.score.desc(), GameScore.updated_at.asc()],
            )
            .label("rn"),
        )
        .where(*conditions)
        .subquery()
    )


def board(db: Session, *, week=None, category=None, limit=20, offset=0, viewer_id=None):
    conditions = filters(week, category)
    ranked = best_per_user(*conditions)
    rows = db.execute(
        select(GameScore, User.name)
        .join(ranked, ranked.c.id == GameScore.id)
        .join(User, User.id == GameScore.user_id)
        .where(ranked.c.rn == 1)
        .order_by(GameScore.score.desc(), GameScore.updated_at.asc())
        .offset(offset)
        .limit(limit)
    ).all()
    players, runs = db.execute(
        select(func.count(func.distinct(GameScore.user_id)), func.count(GameScore.id)).where(
            *conditions
        )
    ).one()
    entries = []
    for index, (score, name) in enumerate(rows):
        entry = {field: getattr(score, field) for field in ("user_id", *RESULT_FIELDS)}
        entry["name"] = (name or "Игрок").strip()[:40]
        entry["rank"] = offset + index + 1
        entry["is_me"] = viewer_id is not None and score.user_id == viewer_id
        entries.append(entry)
    return entries, {"players": players, "runs": runs}


def personal(db: Session, user: User, *, week=None, category=None):
    conditions = filters(week, category)
    mine = db.scalar(
        select(func.max(GameScore.score)).where(GameScore.user_id == user.id, *conditions)
    )
    alltime = db.scalar(select(func.max(GameScore.score)).where(GameScore.user_id == user.id))
    plays = db.scalar(
        select(func.count(GameScore.id)).where(GameScore.user_id == user.id, *conditions)
    )
    rank = None
    if mine:
        better = db.scalar(
            select(func.count(func.distinct(GameScore.user_id))).where(
                *conditions, GameScore.score > mine
            )
        )
        rank = better + 1
    return {"rank": rank, "score": mine or 0, "best_ever": alltime or 0, "plays": plays or 0}
