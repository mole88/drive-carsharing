"""Лидерборд ночного тест-драйва: один лучший заезд на игрока за неделю.

Пороги правдоподобия зеркалят таблицы ядра из app/static/game-core.js
(LEVEL_SECONDS, MAX_LEVEL). Тест tests/ui/game-balance.test.cjs следит,
чтобы константы не разъехались.
"""

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.models import GameScore, Rental, User, utcnow

LEVEL_SECONDS = 22
MAX_LEVEL = 30
LEVEL_SLACK = 2
SCORE_SLACK = 9000
KNOCK_SLACK = 12
RESULT_FIELDS = (
    "rental_id",
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
    if data.score > max(1, data.duration_seconds) * SCORE_SLACK:
        raise HTTPException(422, "Слишком много очков для такой поездки")
    if data.knockdowns > data.duration_seconds * KNOCK_SLACK:
        raise HTTPException(422, "Слишком много сбитых для такой поездки")


def stored(db: Session, user_id: int, week: str):
    return db.scalar(select(GameScore).where(GameScore.user_id == user_id, GameScore.week == week))


def record(db: Session, rental: Rental):
    """Atomic best-of-week update inside the rental completion transaction."""
    result = rental.game_result
    values = {field: result[field] for field in RESULT_FIELDS}
    values.update(user_id=rental.user_id, week=result["week"], updated_at=utcnow())
    insert = {"sqlite": sqlite_insert, "postgresql": pg_insert}[db.get_bind().dialect.name]
    statement = insert(GameScore).values(created_at=utcnow(), **values)
    statement = statement.on_conflict_do_update(
        index_elements=[GameScore.user_id, GameScore.week],
        set_={key: value for key, value in values.items() if key not in {"user_id", "week"}},
        where=GameScore.score < result["score"],
    ).returning(GameScore.id)
    improved = db.execute(statement).scalar() is not None
    row = db.scalar(
        select(GameScore)
        .where(GameScore.user_id == rental.user_id, GameScore.week == result["week"])
        .execution_options(populate_existing=True)
    )
    return row, improved


def submit(db: Session, user: User, data):
    """Only completed, owned rental outcomes can enter the leaderboard."""
    if not data.rental_id:
        raise HTTPException(422, "Результат должен быть связан с поездкой")
    rental = db.get(Rental, data.rental_id)
    if not rental or rental.user_id != user.id:
        raise HTTPException(404, "Поездка не найдена")
    if rental.status != "completed" or not rental.game_result:
        raise HTTPException(409, "Поездка ещё не завершена в игре")
    if rental.game_result["duration_seconds"] < 10 or rental.game_result["score"] <= 0:
        raise HTTPException(422, "Для рейтинга нужен заезд от 10 секунд с очками")
    row, improved = record(db, rental)
    db.commit()
    return row, improved


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


def plays(db, *, week=None, category=None, user_id=None):
    conditions = [
        Rental.status == "completed",
        Rental.game_result["score"].as_integer().is_not(None),
    ]
    if week:
        conditions.append(Rental.game_result["week"].as_string() == week)
    if category:
        conditions.append(Rental.game_result["category"].as_string() == category)
    if user_id is not None:
        conditions.append(Rental.user_id == user_id)
    count = db.scalar(select(func.count(Rental.id)).where(*conditions)) or 0
    legacy = filters(week, category) + [GameScore.rental_id.is_(None)]
    if user_id is not None:
        legacy.append(GameScore.user_id == user_id)
    return count + (db.scalar(select(func.count(GameScore.id)).where(*legacy)) or 0)


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
    players = db.scalar(select(func.count(func.distinct(GameScore.user_id))).where(*conditions))
    entries = []
    for index, (score, name) in enumerate(rows):
        entry = {field: getattr(score, field) for field in ("user_id", *RESULT_FIELDS)}
        entry["name"] = (name or "Игрок").strip()[:40]
        entry["rank"] = offset + index + 1
        entry["is_me"] = viewer_id is not None and score.user_id == viewer_id
        entries.append(entry)
    return entries, {"players": players, "runs": plays(db, week=week, category=category)}


def personal(db: Session, user: User, *, week=None, category=None):
    conditions = filters(week, category)
    mine = db.scalar(
        select(func.max(GameScore.score)).where(GameScore.user_id == user.id, *conditions)
    )
    alltime = db.scalar(select(func.max(GameScore.score)).where(GameScore.user_id == user.id))
    count = plays(db, week=week, category=category, user_id=user.id)
    rank = None
    if mine:
        better = db.scalar(
            select(func.count(func.distinct(GameScore.user_id))).where(
                *conditions, GameScore.score > mine
            )
        )
        rank = better + 1
    return {"rank": rank, "score": mine or 0, "best_ever": alltime or 0, "plays": count}
