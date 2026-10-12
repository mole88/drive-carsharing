from datetime import timedelta
from math import ceil

from fastapi import HTTPException
from sqlalchemy import func, update
from sqlalchemy.exc import IntegrityError

from app.models import AuditEvent, Car, Rental, utcnow
from app.services import game, trip

RESERVATION_MINUTES = 20
STALE_TRIP_MINUTES = 90


def expire_rentals(db, exclude_active_id=None):
    """Conditional updates arbitrate expiration against concurrent starts/cancellations."""
    now = utcnow()
    cutoff = now - timedelta(minutes=RESERVATION_MINUTES)
    try:
        expired = (
            db.execute(
                update(Rental)
                .where(Rental.status == "reserved", Rental.created_at <= cutoff)
                .values(status="cancelled", finished_at=now)
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
        query = update(Rental).where(
            Rental.status == "active",
            func.coalesce(Rental.last_activity_at, Rental.started_at, Rental.created_at)
            <= now - timedelta(minutes=STALE_TRIP_MINUTES),
        )
        if exclude_active_id is not None:
            query = query.where(Rental.id != exclude_active_id)
        abandoned = db.execute(
            query.values(
                status="completed",
                finished_at=now,
                finish_address=Rental.pickup_address,
                total_kopecks=Rental.rate_kopecks,
            ).returning(Rental.id, Rental.user_id, Rental.car_id)
        ).all()
        for rental_id, user_id, car_id in abandoned:
            db.execute(
                update(Car)
                .where(Car.id == car_id, Car.status == "rented")
                .values(status="available")
            )
            db.add(
                AuditEvent(actor_id=user_id, action="rental.expired", target=f"rental:{rental_id}")
            )
        db.commit()
    except Exception:
        db.rollback()
        raise


def close_stale(db, rental_id, owner_id=None):
    """Закрытие брошенной поездки — администратором или самим владельцем.

    Игрового результата нет — клиент его так и не прислал, поэтому поездка
    считается по минимуму договора (одна минута тарифа), а машина возвращается
    в строй. Свежие поездки закрывать нельзя: у игрока ещё есть шанс сам
    вернуть машину через /drive, и только там списывается наигранное время.
    Порог общий для обоих путей, иначе поездку можно было бы закрыть раньше,
    чем игра успела бы посчитать стоимость.
    """
    expire_rentals(db, exclude_active_id=rental_id)
    rental = db.get(Rental, rental_id)
    if not rental or (owner_id is not None and rental.user_id != owner_id):
        raise HTTPException(404, "Аренда не найдена")
    if rental.status != "active":
        raise HTTPException(409, "Закрыть можно только начатую поездку")
    started = rental.last_activity_at or rental.started_at or rental.created_at
    if utcnow() - started < timedelta(minutes=STALE_TRIP_MINUTES):
        raise HTTPException(
            409,
            f"С последней активности прошло меньше {STALE_TRIP_MINUTES} минут",
        )
    now = utcnow()
    changed = db.execute(
        update(Rental)
        .where(
            Rental.id == rental_id,
            Rental.status == "active",
            func.coalesce(Rental.last_activity_at, Rental.started_at, Rental.created_at)
            <= now - timedelta(minutes=STALE_TRIP_MINUTES),
        )
        .values(
            status="completed",
            finished_at=now,
            finish_address=rental.pickup_address,
            total_kopecks=rental.rate_kopecks,
        )
    )
    if changed.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "Поездка уже изменена, обновите список")
    db.execute(
        update(Car)
        .where(Car.id == rental.car_id, Car.status == "rented")
        .values(status="available")
    )
    db.flush()
    db.refresh(rental)
    return rental


def heartbeat(db, user_id, rental_id):
    rental = db.get(Rental, rental_id)
    if not rental or rental.user_id != user_id:
        raise HTTPException(404, "Поездка не найдена")
    now = utcnow()
    changed = db.execute(
        update(Rental)
        .where(
            Rental.id == rental_id,
            Rental.user_id == user_id,
            Rental.status == "active",
            func.coalesce(Rental.last_activity_at, Rental.started_at, Rental.created_at)
            > now - timedelta(minutes=STALE_TRIP_MINUTES),
        )
        .values(last_activity_at=now)
    )
    if changed.rowcount != 1:
        db.rollback()
        expire_rentals(db)
        raise HTTPException(409, "Поездка завершена или ещё не началась")
    db.commit()
    db.refresh(rental)
    return rental


def rental_view(db, rental):
    car = db.get(Car, rental.car_id)
    result = {column.name: getattr(rental, column.name) for column in Rental.__table__.columns}
    result.update(
        car_name=rental.car_name_snapshot or f"{car.brand} {car.model}",
        plate=rental.plate_snapshot or car.plate,
        address=rental.finish_address or rental.pickup_address or car.address,
    )
    result["expires_at"] = rental.created_at + timedelta(minutes=RESERVATION_MINUTES)
    result["closeable_at"] = (
        (rental.last_activity_at or rental.started_at or rental.created_at)
        + timedelta(minutes=STALE_TRIP_MINUTES)
        if rental.status == "active"
        else None
    )
    result["server_now"] = utcnow()
    result["estimated_kopecks"] = (
        max(1, ceil((utcnow() - rental.started_at).total_seconds() / 60)) * rental.rate_kopecks
        if rental.status == "active"
        else rental.total_kopecks
    )
    return result


def reserve(db, user_id, car_id, expected_rate=None):
    expire_rentals(db)
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
    expire_rentals(db)
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
            values["last_activity_at"] = now
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
    expire_rentals(db)
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
        clock_fields = (data.time_scale, data.duration_ms, data.distance_meters)
        has_clock = any(value is not None for value in clock_fields)
        if has_clock:
            if any(value is None for value in clock_fields):
                raise HTTPException(422, "Передайте время и пробег поездки вместе")
            played = data.duration_ms / 1000
            if abs(played - data.duration_seconds) > 0.501 or played > elapsed + 5:
                raise HTTPException(422, "Длительность не совпадает с игровыми часами")
            distance_limit = played * trip.TIME_SCALE * trip.MAX_CITY_SPEED / 3.6 + 1
            if data.distance_meters > distance_limit:
                raise HTTPException(422, "Пробег не совпадает с длительностью поездки")
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
            killer=data.killer,
            dodges=data.dodges,
        )
        # Old clients and historical outcomes retain their previous billing rules.
        minutes = max(1, ceil(elapsed / 60))
        if has_clock:
            minutes = trip.charged_minutes(data.duration_ms)
            result.update(
                time_scale=trip.TIME_SCALE,
                duration_ms=data.duration_ms,
                trip_duration_seconds=data.duration_ms * trip.TIME_SCALE / 1000,
                charged_minutes=minutes,
                distance_meters=data.distance_meters,
            )
        changed = db.execute(
            update(Rental)
            .where(Rental.id == rental.id, Rental.status == "active")
            .values(
                status="completed",
                finished_at=now,
                finish_address=rental.pickup_address or car.address,
                total_kopecks=minutes * rental.rate_kopecks,
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
