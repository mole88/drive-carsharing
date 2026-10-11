from datetime import timedelta
from math import ceil

from fastapi import HTTPException
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError

from app.models import Car, Rental, utcnow
from app.services import game

RESERVATION_MINUTES = 20


def expire_reservations(db):
    """Conditional updates arbitrate expiration against concurrent starts/cancellations."""
    cutoff = utcnow() - timedelta(minutes=RESERVATION_MINUTES)
    try:
        expired = (
            db.execute(
                update(Rental)
                .where(Rental.status == "reserved", Rental.created_at <= cutoff)
                .values(status="cancelled", finished_at=utcnow())
                .returning(Rental.car_id)
            )
            .scalars()
            .all()
        )
        if expired:
            db.execute(
                update(Car)
                .where(Car.id.in_(expired), Car.status == "reserved")
                .values(status="available")
            )
        db.commit()
    except Exception:
        db.rollback()
        raise


def rental_view(db, rental):
    car = db.get(Car, rental.car_id)
    result = {column.name: getattr(rental, column.name) for column in Rental.__table__.columns}
    result.update(
        car_name=rental.car_name_snapshot or f"{car.brand} {car.model}",
        plate=rental.plate_snapshot or car.plate,
        address=rental.finish_address or rental.pickup_address or car.address,
    )
    result["expires_at"] = rental.created_at + timedelta(minutes=RESERVATION_MINUTES)
    result["server_now"] = utcnow()
    result["estimated_kopecks"] = (
        max(1, ceil((utcnow() - rental.started_at).total_seconds() / 60)) * rental.rate_kopecks
        if rental.status == "active"
        else rental.total_kopecks
    )
    return result


def reserve(db, user_id, car_id, expected_rate=None):
    expire_reservations(db)
    try:
        query = update(Car).where(Car.id == car_id, Car.status == "available", Car.fuel >= 10)
        if expected_rate is not None:
            query = query.where(Car.rate_kopecks == expected_rate)
        result = db.execute(query.values(status="reserved"))
        if result.rowcount != 1:
            raise HTTPException(409, "Автомобиль недоступен или тариф изменился. Обновите каталог")
        car = db.get(Car, car_id)
        rental = Rental(
            user_id=user_id,
            car_id=car_id,
            rate_kopecks=car.rate_kopecks,
            car_name_snapshot=f"{car.brand} {car.model}",
            plate_snapshot=car.plate,
            pickup_address=car.address,
        )
        db.add(rental)
        db.commit()
        return rental
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "У вас уже есть незавершённая аренда") from None
    except Exception:
        db.rollback()
        raise


def transition(db, user_id, rental_id, action, finish=None):
    expire_reservations(db)
    expected, target, car_status = {
        "start": ("reserved", "active", "rented"),
        "cancel": ("reserved", "cancelled", "available"),
        "finish": ("active", "completed", "available"),
    }[action]
    try:
        rental = db.get(Rental, rental_id)
        if not rental or rental.user_id != user_id:
            raise HTTPException(404, "Аренда не найдена")
        now = utcnow()
        values = {"status": target}
        if action == "start":
            values["started_at"] = now
        elif action == "finish":
            if rental.started_at is None:
                raise HTTPException(409, "Поездка ещё не началась")
            values.update(
                finished_at=now,
                finish_address=finish.address,
                total_kopecks=max(1, ceil((now - rental.started_at).total_seconds() / 60))
                * rental.rate_kopecks,
            )
        result = db.execute(
            update(Rental).where(Rental.id == rental_id, Rental.status == expected).values(**values)
        )
        if result.rowcount != 1:
            raise HTTPException(409, "Это действие недоступно в текущем состоянии аренды")
        car_values = {"status": car_status}
        if finish:
            car_values.update(address=finish.address, fuel=finish.fuel)
        db.execute(update(Car).where(Car.id == rental.car_id).values(**car_values))
        db.commit()
        db.refresh(rental)
        return rental
    except Exception:
        db.rollback()
        raise


def finish_game(db, user_id, rental_id, data):
    """Complete the rental and its immutable game outcome in one transaction."""
    try:
        rental = db.get(Rental, rental_id)
        if not rental or rental.user_id != user_id:
            raise HTTPException(404, "Поездка не найдена")
        if rental.status == "completed" and rental.game_result:
            return rental  # Retry after a lost response must not bill twice.
        if rental.status != "active" or rental.started_at is None:
            raise HTTPException(409, "Сначала начните поездку")
        now = utcnow()
        elapsed = max(0, (now - rental.started_at).total_seconds())
        if data.duration_seconds > elapsed + 5:
            raise HTTPException(422, "Длительность превышает время поездки")
        game.check(data)
        car = db.get(Car, rental.car_id)
        result = {field: getattr(data, field) for field in game.RESULT_FIELDS}
        result.update(
            rental_id=rental.id,
            car_id=car.id,
            car_name=rental.car_name_snapshot or f"{car.brand} {car.model}",
            category=car.category,
            week=game.week_of(now),
            best_combo=data.best_combo,
        )
        changed = db.execute(
            update(Rental)
            .where(Rental.id == rental.id, Rental.status == "active")
            .values(
                status="completed",
                finished_at=now,
                finish_address=rental.pickup_address or car.address,
                total_kopecks=max(1, ceil(elapsed / 60)) * rental.rate_kopecks,
                game_result=result,
            )
        )
        if changed.rowcount != 1:
            db.rollback()
            db.refresh(rental)
            if rental.status == "completed" and rental.game_result:
                return rental
            raise HTTPException(409, "Поездка уже завершена")
        db.execute(update(Car).where(Car.id == car.id).values(status="available"))
        db.refresh(rental)
        if data.duration_seconds >= 10 and data.score > 0:
            game.record(db, rental)
        db.commit()
        db.refresh(rental)
        return rental
    except Exception:
        db.rollback()
        raise
