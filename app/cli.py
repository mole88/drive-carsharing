"""Local administration: python -m app.cli seed | admin EMAIL."""

import argparse
from getpass import getpass

from sqlalchemy import select

from app.core.db import SessionLocal
from app.core.security import password_hash
from app.models import Car, User


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["seed", "admin"])
    parser.add_argument("email", nargs="?")
    args = parser.parse_args()
    with SessionLocal() as db:
        if args.command == "seed":
            for brand, model, plate, category, address, rate, image in [
                (
                    "Kia",
                    "Rio",
                    "А101АА178",
                    "economy",
                    "Санкт-Петербург, ул. Профессора Попова, 5",
                    900,
                    "images/kiario.png",
                ),
                (
                    "Hyundai",
                    "Solaris",
                    "А102АА178",
                    "economy",
                    "Санкт-Петербург, Невский проспект, 28",
                    950,
                    "images/hsolaris.png",
                ),
                (
                    "Skoda",
                    "Octavia",
                    "А103АА178",
                    "comfort",
                    "Санкт-Петербург, Большой проспект П.С., 84",
                    1400,
                    "images/skodaoctavia.png",
                ),
                (
                    "BMW",
                    "320i",
                    "А104АА178",
                    "business",
                    "Санкт-Петербург, Петроградская набережная, 18",
                    2200,
                    "images/BMW-3.png",
                ),
            ]:
                car = db.scalar(select(Car).where(Car.plate == plate))

                if car:
                    car.image = image
                else:
                    db.add(
                        Car(
                            brand=brand,
                            model=model,
                            plate=plate,
                            category=category,
                            address=address,
                            rate_kopecks=rate,
                            fuel=85,
                            image=image,
                        )
                    )
        else:
            if not args.email:
                parser.error("Укажите email")
            user = db.scalar(select(User).where(User.email == args.email.lower()))
            if user:
                user.is_admin = True
            else:
                password = getpass("Пароль администратора (от 8 символов): ")
                if len(password) < 8:
                    parser.error("Пароль слишком короткий")
                db.add(
                    User(
                        email=args.email.lower(),
                        name="Администратор",
                        password_hash=password_hash.hash(password),
                        is_admin=True,
                    )
                )
        db.commit()
        print("Done")


if __name__ == "__main__":
    main()
