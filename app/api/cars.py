from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import admin_user
from app.models import AuditEvent, Car, User
from app.schemas import CarInput, CarOut
from app.services import rentals

router = APIRouter(prefix="/api")


@router.get("/cars", response_model=list[CarOut], tags=["Автопарк"])
def cars(
    category: str | None = None,
    available: bool = False,
    search: str = Query("", max_length=100),
    sort: Literal["default", "price_asc", "price_desc", "fuel"] = "default",
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    rentals.expire_rentals(db)
    query = select(Car)
    if search.strip():
        term = search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        query = query.where(
            or_(
                *(
                    field.ilike(f"%{term}%", escape="\\")
                    for field in [Car.brand, Car.model, Car.plate, Car.address]
                )
            )
        )
    ordering = {
        "default": Car.id,
        "price_asc": Car.rate_kopecks,
        "price_desc": Car.rate_kopecks.desc(),
        "fuel": Car.fuel.desc(),
    }
    query = query.order_by(ordering[sort], Car.id)
    if category:
        query = query.where(Car.category == category)
    if available:
        query = query.where(Car.status == "available", Car.fuel >= 10)
    return db.scalars(query.offset(offset).limit(limit)).all()


@router.get("/cars/{car_id}", response_model=CarOut, tags=["Автопарк"])
def car_details(car_id: int, db: Session = Depends(get_db)):
    rentals.expire_rentals(db)
    car = db.get(Car, car_id)
    if car is None:
        raise HTTPException(404, "Автомобиль не найден")
    return car


@router.post(
    "/cars",
    response_model=CarOut,
    status_code=201,
    dependencies=[Depends(admin_user)],
    tags=["Администратор"],
)
def add_car(data: CarInput, db: Session = Depends(get_db), user: User = Depends(admin_user)):
    car = Car(**data.model_dump())
    db.add(car)
    try:
        db.flush()
        db.add(AuditEvent(actor_id=user.id, action="car.created", target=f"car:{car.id}"))
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Номер автомобиля уже существует") from None
    return car


@router.patch(
    "/cars/{car_id}/status",
    response_model=CarOut,
    dependencies=[Depends(admin_user)],
    tags=["Администратор"],
)
def car_status(
    car_id: int,
    status: Literal["available", "maintenance"],
    db: Session = Depends(get_db),
    user: User = Depends(admin_user),
):
    result = db.execute(
        update(Car)
        .where(Car.id == car_id, Car.status.in_(["available", "maintenance"]))
        .values(status=status)
    )
    if result.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "Автомобиль занят или не найден")
    db.add(AuditEvent(actor_id=user.id, action="car." + status, target=f"car:{car_id}"))
    db.commit()
    return db.get(Car, car_id)
