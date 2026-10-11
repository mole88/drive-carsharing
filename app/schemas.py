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

    @field_serializer("created_at", "started_at", "finished_at", "expires_at", "server_now")
    def serialize_utc(self, value):
        return value.isoformat() + "Z" if value else None
