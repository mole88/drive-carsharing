from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_serializer, field_validator


class Register(BaseModel):
    email: EmailStr
    name: str = Field(min_length=2, max_length=100)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value):
        if len(value.strip()) < 2:
            raise ValueError("Введите имя")
        return value.strip()


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: str
    name: str
    is_admin: bool


class CarInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    brand: str = Field(min_length=1, max_length=60)
    model: str = Field(min_length=1, max_length=60)
    plate: str = Field(min_length=3, max_length=20)
    category: Literal["economy", "comfort", "business"] = "economy"
    address: str = Field(min_length=3, max_length=200)
    fuel: int = Field(ge=0, le=100, default=100)
    rate_kopecks: int = Field(gt=0, le=100000)


class CarOut(CarInput):
    model_config = ConfigDict(from_attributes=True)
    id: int
    status: str
    image: str | None = None


class ReserveInput(BaseModel):
    car_id: int
    expected_rate_kopecks: int | None = Field(default=None, gt=0)


class FinishInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    address: str = Field(min_length=3, max_length=200)
    fuel: int = Field(ge=0, le=100)


class RentalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    car_id: int
    status: str
    rate_kopecks: int
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    total_kopecks: int
    car_name: str
    plate: str
    address: str
    expires_at: datetime
    estimated_kopecks: int
    server_now: datetime
    pickup_address: str
    finish_address: str | None
    game_result: dict | None = None

    @field_serializer("created_at", "started_at", "finished_at", "expires_at", "server_now")
    def serialize_utc(self, value):
        return value.isoformat() + "Z" if value else None


class ScoreInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    rental_id: int | None = Field(default=None, gt=0)
    car_id: int | None = Field(default=None, gt=0)
    car_name: str = Field(default="", max_length=125)
    category: Literal["economy", "comfort", "business"] = "comfort"
    score: int = Field(ge=0, le=5000000)
    level: int = Field(ge=1, le=60)
    knockdowns: int = Field(ge=0, le=30000)
    drones: int = Field(ge=0, le=3000, default=0)
    bribes: int = Field(ge=0, le=3000, default=0)
    profit_kopecks: int = Field(ge=-100000000, le=100000000, default=0)
    duration_seconds: int = Field(ge=10, le=7200)
    reason: Literal["wrecked", "broke", "quit"]


class GameFinishInput(ScoreInput):
    duration_seconds: int = Field(ge=0, le=7200)
    best_combo: int = Field(default=1, ge=1, le=10)
    time_scale: Literal[40] | None = None
    duration_ms: int | None = Field(default=None, ge=0, le=7200000)
    distance_meters: int | None = Field(default=None, ge=0, le=10000000)


class ScoreOut(BaseModel):
    accepted: bool
    improved: bool
    score: int
    level: int
    week: str
    personal: dict


class LeaderRow(BaseModel):
    rental_id: int | None = None
    rank: int
    name: str
    car_name: str
    category: str
    score: int
    level: int
    knockdowns: int
    drones: int
    bribes: int
    profit_kopecks: int
    duration_seconds: int
    reason: str
    is_me: bool


class BoardOut(BaseModel):
    period: str
    week: str | None
    category: str | None
    rows: list[LeaderRow]
    totals: dict
    me: dict | None
