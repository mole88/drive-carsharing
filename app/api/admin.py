from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import admin_user
from app.models import AuditEvent, Car, Rental, SupportTicket, User
from app.schemas import CarInput, CarOut, RentalOut
from app.services.rentals import close_stale, expire_rentals, rental_view

router = APIRouter(prefix="/api/admin", tags=["Администратор"], dependencies=[Depends(admin_user)])


@router.put("/cars/{car_id}", response_model=CarOut)
def edit_car(
    car_id: int, data: CarInput, user: User = Depends(admin_user), db: Session = Depends(get_db)
):
    try:
        result = db.execute(
            update(Car)
            .where(Car.id == car_id, Car.status.in_(["available", "maintenance"]))
            .values(**data.model_dump())
        )
        if result.rowcount != 1:
            raise HTTPException(409, "Автомобиль занят или не найден. Дождитесь завершения аренды")
        db.add(AuditEvent(actor_id=user.id, action="car.updated", target=f"car:{car_id}"))
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Этот госномер уже используется") from None
    return db.get(Car, car_id)


@router.get("/summary")
def summary(db: Session = Depends(get_db)):
    expire_rentals(db)
    return {
        "cars": db.scalar(select(func.count(Car.id))),
        "active_rentals": db.scalar(select(func.count(Rental.id)).where(Rental.status == "active")),
        "open_tickets": db.scalar(
            select(func.count(SupportTicket.id)).where(SupportTicket.status == "open")
        ),
        "completed_kopecks": db.scalar(
            select(func.coalesce(func.sum(Rental.total_kopecks), 0)).where(
                Rental.status == "completed"
            )
        ),
    }


@router.get("/rentals", response_model=list[RentalOut])
def rentals(
    search: str = Query("", max_length=100),
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    query = select(Rental).join(Car).join(User, Rental.user_id == User.id)
    if search.strip():
        term = search.strip()
        clauses = [
            Car.plate.contains(term, autoescape=True),
            User.email.contains(term, autoescape=True),
        ]
        if term.isdecimal():
            clauses.append(Rental.id == int(term))
        query = query.where(or_(*clauses))
    return [
        rental_view(db, row)
        for row in db.scalars(query.order_by(Rental.id.desc()).offset(offset).limit(limit)).all()
    ]


@router.post("/rentals/{rental_id}/close", response_model=RentalOut)
def close_rental(
    rental_id: int, user: User = Depends(admin_user), db: Session = Depends(get_db)
):
    try:
        rental = close_stale(db, rental_id)
        db.add(
            AuditEvent(
                actor_id=user.id,
                action="rental.force_closed",
                target=f"rental:{rental_id}",
            )
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(rental)
    return rental_view(db, rental)


@router.get("/audit")
def audit(
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        select(AuditEvent, User.name)
        .join(User, AuditEvent.actor_id == User.id)
        .order_by(AuditEvent.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    return [
        {
            "id": item.id,
            "actor": name,
            "action": item.action,
            "target": item.target,
            "created_at": item.created_at.isoformat() + "Z",
        }
        for item, name in rows
    ]
