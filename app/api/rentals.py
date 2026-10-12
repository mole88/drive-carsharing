from html import escape
from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import current_user
from app.models import AuditEvent, Rental, User
from app.schemas import FinishInput, GameFinishInput, RentalOut, ReserveInput
from app.services import rentals
from app.services.rentals import expire_rentals, rental_view

router = APIRouter(prefix="/api/rentals", tags=["Аренда"])


@router.get("", response_model=list[RentalOut], tags=["Аренда"])
def my_rentals(
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    rentals.expire_rentals(db)
    rows = db.scalars(
        select(Rental)
        .where(Rental.user_id == user.id)
        .order_by(Rental.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    return [rentals.rental_view(db, rental) for rental in rows]


@router.post("", response_model=RentalOut, status_code=201, tags=["Аренда"])
def reserve(data: ReserveInput, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return rentals.rental_view(
        db, rentals.reserve(db, user.id, data.car_id, data.expected_rate_kopecks)
    )


@router.post("/{rental_id}/start", response_model=RentalOut, tags=["Аренда"])
def start(rental_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return rentals.rental_view(db, rentals.transition(db, user.id, rental_id, "start"))


@router.post("/{rental_id}/heartbeat", response_model=RentalOut)
def heartbeat(rental_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return rentals.rental_view(db, rentals.heartbeat(db, user.id, rental_id))


@router.post("/{rental_id}/cancel", response_model=RentalOut, tags=["Аренда"])
def cancel(rental_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return rentals.rental_view(db, rentals.transition(db, user.id, rental_id, "cancel"))


@router.post("/{rental_id}/finish", response_model=RentalOut, tags=["Аренда"])
def finish(
    rental_id: int,
    data: FinishInput,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    return rentals.rental_view(db, rentals.transition(db, user.id, rental_id, "finish", data))


@router.post("/{rental_id}/return", response_model=RentalOut, tags=["Аренда"])
def return_rental(
    rental_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    """Вернуть машину, не входя в игру — выход для зависшей поездки.

    Пока поездка свежая, сдача машины идёт через /drive и считается по
    наигранному времени. После порога поездка считается брошенной, и у
    владельца должен остаться способ вывести себя из неё без администратора:
    на проде админских аккаунтов нет, а закрытая поездка держит машину.
    """
    try:
        rental = rentals.close_stale(db, rental_id, owner_id=user.id)
        db.add(
            AuditEvent(
                actor_id=user.id,
                action="rental.self_returned",
                target=f"rental:{rental_id}",
            )
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return rental_view(db, rental)


@router.get("/summary")
def summary(user: User = Depends(current_user), db: Session = Depends(get_db)):
    count, total = db.execute(
        select(func.count(Rental.id), func.coalesce(func.sum(Rental.total_kopecks), 0)).where(
            Rental.user_id == user.id, Rental.status == "completed"
        )
    ).one()
    return {"completed_count": count, "total_kopecks": total}


@router.get("/current", response_model=RentalOut | None)
def current(user: User = Depends(current_user), db: Session = Depends(get_db)):
    expire_rentals(db)
    rental = db.scalar(
        select(Rental).where(Rental.user_id == user.id, Rental.status.in_(["reserved", "active"]))
    )
    return rental_view(db, rental) if rental else None


@router.get("/{rental_id}/receipt", response_class=HTMLResponse)
def receipt(rental_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    rental = db.get(Rental, rental_id)
    if not rental or rental.user_id != user.id:
        raise HTTPException(404, "Поездка не найдена")
    if rental.status != "completed":
        raise HTTPException(409, "Итоги доступны после завершения поездки")
    trip = rental_view(db, rental)
    minutes = max(1, ceil(rental.total_kopecks / rental.rate_kopecks))
    if rental.game_result and "charged_minutes" in rental.game_result:
        minutes = rental.game_result["charged_minutes"]

    def date(value):
        return value.strftime("%d.%m.%Y %H:%M:%S") + " UTC"

    rows = [
        ("Автомобиль", trip["car_name"]),
        ("Госномер", trip["plate"]),
        ("Начало поездки", date(rental.started_at)),
        ("Завершение", date(rental.finished_at)),
        ("Адрес начала", rental.pickup_address or "Не сохранён для этой поездки"),
        ("Адрес завершения", rental.finish_address or "Не сохранён для этой поездки"),
        ("Оплачиваемое время", f"{minutes} мин"),
        ("Тариф", f"{rental.rate_kopecks / 100:.2f} ₽/мин"),
    ]
    if rental.game_result:
        result = rental.game_result
        rows.extend(
            [
                ("Очки", str(result["score"])),
                ("Уровень", str(result["level"])),
                ("За рулём", f"{result['duration_seconds']} с"),
                (
                    "Итог игры",
                    {"wrecked": "Авария", "broke": "Долг", "quit": "Возврат машины"}[
                        result["reason"]
                    ],
                ),
            ]
        )
        if "trip_duration_seconds" in result:
            rows.extend(
                [
                    ("Время поездки", f"{result['trip_duration_seconds'] / 60:.1f} мин"),
                    ("Пробег", f"{result['distance_meters'] / 1000:.1f} км"),
                    (
                        "Масштаб времени",
                        "1,5 секунды игры = 1 минута поездки; пауза не оплачивается",
                    ),
                ]
            )
    body = "".join(f"<dt>{escape(label)}</dt><dd>{escape(value)}</dd>" for label, value in rows)
    return HTMLResponse(
        f'<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Итоги поездки №{rental.id} — Драйв</title><link rel="stylesheet" href="/static/receipt.css"></head><body><main><a href="/trips">← Мои поездки</a><p class="brand">драйв ↗</p><h1>Итоги поездки №{rental.id}</h1><dl>{body}</dl><div class="total">Стоимость <strong>{rental.total_kopecks / 100:.2f} ₽</strong></div><p>Каждая начатая минута округляется вверх. Минимум — одна минута.</p><p>Расчёт стоимости поездки. Не является кассовым чеком или подтверждением оплаты.</p><button id="print">Распечатать / сохранить PDF</button></main><script src="/static/receipt.js"></script></body></html>'
    )


@router.get("/{rental_id}", response_model=RentalOut)
def get_rental(rental_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    expire_rentals(db)
    rental = db.get(Rental, rental_id)
    if not rental or rental.user_id != user.id:
        raise HTTPException(404, "Поездка не найдена")
    return rental_view(db, rental)


@router.post("/{rental_id}/game/finish", response_model=RentalOut)
def finish_game(
    rental_id: int,
    data: GameFinishInput,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    return rental_view(db, rentals.finish_game(db, user.id, rental_id, data))
