from datetime import UTC, datetime

from sqlalchemy import JSON, CheckConstraint, ForeignKey, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


def utcnow():
    return datetime.now(UTC).replace(tzinfo=None)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    password_hash: Mapped[str]
    is_admin: Mapped[bool] = mapped_column(default=False)


class Car(Base):
    __tablename__ = "cars"
    __table_args__ = (
        CheckConstraint("rate_kopecks > 0"),
        CheckConstraint("fuel BETWEEN 0 AND 100"),
        CheckConstraint("status IN ('available','reserved','rented','maintenance')"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    brand: Mapped[str] = mapped_column(String(60))
    model: Mapped[str] = mapped_column(String(60))
    plate: Mapped[str] = mapped_column(String(20), unique=True)
    category: Mapped[str] = mapped_column(String(30))
    address: Mapped[str] = mapped_column(String(200))
    fuel: Mapped[int] = mapped_column(default=100)
    rate_kopecks: Mapped[int]
    status: Mapped[str] = mapped_column(default="available")
    image: Mapped[str | None] = mapped_column(String(255), nullable=True)


class Rental(Base):
    __tablename__ = "rentals"
    __table_args__ = (
        CheckConstraint("status IN ('reserved','active','completed','cancelled')"),
        Index(
            "uq_user_open_rental",
            "user_id",
            unique=True,
            sqlite_where=text("status IN ('reserved','active')"),
            postgresql_where=text("status IN ('reserved','active')"),
        ),
        Index(
            "uq_car_open_rental",
            "car_id",
            unique=True,
            sqlite_where=text("status IN ('reserved','active')"),
            postgresql_where=text("status IN ('reserved','active')"),
        ),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    car_id: Mapped[int] = mapped_column(ForeignKey("cars.id"))
    status: Mapped[str] = mapped_column(default="reserved")
    rate_kopecks: Mapped[int]
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    started_at: Mapped[datetime | None]
    finished_at: Mapped[datetime | None]
    total_kopecks: Mapped[int] = mapped_column(default=0)
    car_name_snapshot: Mapped[str] = mapped_column(String(125), default="")
    plate_snapshot: Mapped[str] = mapped_column(String(20), default="")
    pickup_address: Mapped[str] = mapped_column(String(200), default="")
    finish_address: Mapped[str | None] = mapped_column(String(200))
    game_result: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class LoginSession(Base):
    __tablename__ = "login_sessions"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    expires_at: Mapped[datetime]


class AuthThrottle(Base):
    __tablename__ = "auth_throttles"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    attempts: Mapped[int]
    resets_at: Mapped[datetime]


class SupportTicket(Base):
    __tablename__ = "support_tickets"
    __table_args__ = (CheckConstraint("status IN ('open','answered','closed')"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    rental_id: Mapped[int | None] = mapped_column(ForeignKey("rentals.id"))
    subject: Mapped[str] = mapped_column(String(120))
    message: Mapped[str] = mapped_column(String(4000))
    reply: Mapped[str] = mapped_column(String(4000), default="")
    status: Mapped[str] = mapped_column(default="open")
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow)


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    actor_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(80))
    target: Mapped[str] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class GameScore(Base):
    """Лучший результат игрока за неделю: одна строка на (user, week)."""

    __tablename__ = "game_scores"
    __table_args__ = (
        CheckConstraint("score >= 0"),
        CheckConstraint("level >= 1"),
        CheckConstraint("reason IN ('wrecked','broke','quit')"),
        Index("ix_game_week_score", "week", "score"),
        Index("ix_game_score", "score"),
        Index("uq_game_user_week", "user_id", "week", unique=True),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    rental_id: Mapped[int | None] = mapped_column(ForeignKey("rentals.id"), nullable=True)
    week: Mapped[str] = mapped_column(String(9), default="")
    car_id: Mapped[int | None] = mapped_column(ForeignKey("cars.id"))
    car_name: Mapped[str] = mapped_column(String(125), default="")
    category: Mapped[str] = mapped_column(String(30), default="comfort")
    score: Mapped[int] = mapped_column(default=0)
    level: Mapped[int] = mapped_column(default=1)
    knockdowns: Mapped[int] = mapped_column(default=0)
    drones: Mapped[int] = mapped_column(default=0)
    bribes: Mapped[int] = mapped_column(default=0)
    profit_kopecks: Mapped[int] = mapped_column(default=0)
    duration_seconds: Mapped[int] = mapped_column(default=0)
    reason: Mapped[str] = mapped_column(String(16), default="wrecked")
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow)
