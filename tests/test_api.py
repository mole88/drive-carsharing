from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.db import Base, get_db
from app.core.security import create_token, password_hash
from app.main import app
from app.models import Car, Rental, User, utcnow


@pytest.fixture
def setup(tmp_path, monkeypatch):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'test.db'}", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr("app.main.SessionLocal", factory)

    def override():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = override
    with factory() as db:
        db.add_all(
            [
                User(
                    id=i,
                    email=f"user{i}@example.com",
                    name="Test",
                    password_hash=password_hash.hash("Strongpass123"),
                    is_admin=i == 3,
                )
                for i in [1, 2, 3]
            ]
        )
        db.add_all(
            [
                Car(
                    id=i,
                    brand="Kia",
                    model="Rio",
                    plate=f"ABC{i}",
                    category="economy",
                    address="City center",
                    rate_kopecks=950,
                    fuel=80,
                )
                for i in [1, 2]
            ]
        )
        db.commit()
    with factory() as db:
        tokens.clear()
        tokens.update({i: create_token(i, db) for i in [1, 2, 3]})
    with TestClient(app) as client:
        yield client, factory
    app.dependency_overrides.clear()
    engine.dispose()


tokens = {}


def auth(i=1):
    return {"Authorization": "Bearer " + tokens[i]}


def test_auth(setup):
    c, _ = setup
    data = {"email": "new@example.com", "name": "New user", "password": "Strongpass123"}
    assert c.post("/api/auth/register", json=data).status_code == 201
    assert c.post("/api/auth/register", json=data).status_code == 409
    assert (
        c.post("/api/auth/token", data={"username": data["email"], "password": "bad"}).status_code
        == 401
    )
    token = c.post(
        "/api/auth/token", data={"username": data["email"], "password": data["password"]}
    ).json()["access_token"]
    me = c.get("/api/auth/me", headers={"Authorization": "Bearer " + token}).json()
    assert me["is_admin"] is False and "password_hash" not in me
    c.cookies.clear()
    assert c.get("/api/rentals").status_code == 401


def test_full_trip_and_billing(setup):
    c, factory = setup
    r = c.post("/api/rentals", headers=auth(), json={"car_id": 1}).json()
    rid = r["id"]
    assert (
        c.post(
            f"/api/rentals/{rid}/finish",
            headers=auth(),
            json={"address": "New address", "fuel": 50},
        ).status_code
        == 409
    )
    assert c.post(f"/api/rentals/{rid}/start", headers=auth(2)).status_code == 404
    assert c.post(f"/api/rentals/{rid}/start", headers=auth()).status_code == 200
    assert c.post(f"/api/rentals/{rid}/start", headers=auth()).status_code == 409
    with factory() as db:
        db.get(Rental, rid).started_at = utcnow() - timedelta(seconds=61)
        db.commit()
    result = c.post(
        f"/api/rentals/{rid}/finish", headers=auth(), json={"address": "New address", "fuel": 50}
    )
    assert result.status_code == 200 and result.json()["total_kopecks"] == 1900
    assert (
        c.post(
            f"/api/rentals/{rid}/finish",
            headers=auth(),
            json={"address": "New address", "fuel": 50},
        ).status_code
        == 409
    )
    car = c.get("/api/cars").json()[0]
    assert car["status"] == "available" and car["fuel"] == 50 and car["address"] == "New address"
    assert c.get("/api/rentals", headers=auth(2)).json() == []


def test_booking_conflicts_and_rollback(setup):
    c, _ = setup
    rid = c.post("/api/rentals", headers=auth(), json={"car_id": 1}).json()["id"]
    assert c.post("/api/rentals", headers=auth(2), json={"car_id": 1}).status_code == 409
    assert c.post("/api/rentals", headers=auth(), json={"car_id": 2}).status_code == 409
    assert c.get("/api/cars").json()[1]["status"] == "available"
    assert c.post(f"/api/rentals/{rid}/cancel", headers=auth()).status_code == 200
    assert c.post("/api/rentals", headers=auth(2), json={"car_id": 1}).status_code == 201


def test_admin_and_validation(setup):
    c, _ = setup
    assert c.patch("/api/cars/1/status?status=maintenance", headers=auth()).status_code == 403
    assert c.patch("/api/cars/1/status?status=maintenance", headers=auth(3)).status_code == 200
    assert c.post("/api/rentals", headers=auth(), json={"car_id": 1}).status_code == 409
    assert len(c.get("/api/cars?available=true").json()) == 1
    assert c.patch("/api/cars/1/status?status=available", headers=auth(3)).status_code == 200
    c.post("/api/rentals", headers=auth(), json={"car_id": 1})
    assert c.patch("/api/cars/1/status?status=maintenance", headers=auth(3)).status_code == 409
    assert c.get("/api/cars?limit=-1").status_code == 422


def test_concurrent_booking(setup):
    c, _ = setup
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(
            pool.map(
                lambda i: c.post("/api/rentals", headers=auth(i), json={"car_id": 1}).status_code,
                [1, 2],
            )
        )
    assert sorted(results) == [201, 409]


def test_pages(setup):
    c, _ = setup
    import re

    page = c.get("/cars")
    assert page.status_code == 200
    assert page.headers["cache-control"] == "no-store"
    for filename in ["app.js", "style.css"]:
        url = re.search(rf"/static/{re.escape(filename)}\?v=[a-f0-9]{{16}}", page.text)
        assert url, f"{filename} must have a versioned URL to bypass old browser caches"
        asset = c.get(url.group())
        assert asset.status_code == 200
        assert asset.headers["cache-control"] == "no-cache"
        cached = c.get(url.group(), headers={"If-None-Match": asset.headers["etag"]})
        assert cached.status_code == 304
        assert cached.headers["cache-control"] == "no-cache"
    assert c.get("/health").json() == {"status": "ok"}
    assert c.get("/openapi.json").status_code == 200


def test_expired_booking_releases_car_and_cannot_start(setup):
    c, factory = setup
    rid = c.post("/api/rentals", headers=auth(), json={"car_id": 1}).json()["id"]
    with factory() as db:
        db.get(Rental, rid).created_at = utcnow() - timedelta(minutes=21)
        db.commit()
    assert c.post(f"/api/rentals/{rid}/start", headers=auth()).status_code == 409
    history = c.get("/api/rentals", headers=auth()).json()
    assert history[0]["status"] == "cancelled"
    assert history[0]["created_at"].endswith("Z")
    assert history[0]["car_name"] == "Kia Rio"
    assert c.post("/api/rentals", headers=auth(2), json={"car_id": 1}).status_code == 201


def test_search_and_sort(setup):
    c, factory = setup
    with factory() as db:
        db.get(Car, 2).rate_kopecks = 500
        db.commit()
    assert c.get("/api/cars?search=ABC1").json()[0]["id"] == 1
    assert c.get("/api/cars?search=not-found").json() == []
    assert c.get("/api/cars?sort=price_asc").json()[0]["id"] == 2
    assert c.get("/api/cars?sort=price_desc").json()[0]["id"] == 1
    assert c.get("/api/cars?search=%25").json() == []


def test_finish_rejects_blank_address(setup):
    c, _ = setup
    rid = c.post("/api/rentals", headers=auth(), json={"car_id": 1}).json()["id"]
    c.post(f"/api/rentals/{rid}/start", headers=auth())
    assert (
        c.post(
            f"/api/rentals/{rid}/finish", headers=auth(), json={"address": "   ", "fuel": 30}
        ).status_code
        == 422
    )


def test_new_page_content(setup):
    c, _ = setup
    html = c.get("/").text
    assert "Учебный сервис" not in html
    assert "20 минут бесплатной брони" in html
    assert 'id="search"' not in html
    assert 'id="search"' in c.get("/cars").text


def test_cookie_logout_revokes_token(setup):
    c, _ = setup
    response = c.post(
        "/api/auth/token", data={"username": "user1@example.com", "password": "Strongpass123"}
    )
    assert "HttpOnly" in response.headers["set-cookie"]
    assert "SameSite=strict" in response.headers["set-cookie"]
    bearer = {"Authorization": "Bearer " + response.json()["access_token"]}
    assert c.get("/api/auth/me").status_code == 200
    assert c.post("/api/auth/logout").status_code == 200
    assert c.get("/api/auth/me").status_code == 401
    assert c.get("/api/auth/me", headers=bearer).status_code == 401


def test_password_change_revokes_all_sessions(setup):
    c, _ = setup
    data = {"current_password": "wrong", "new_password": "NewStrongpass123"}
    assert c.post("/api/auth/password", headers=auth(), json=data).status_code == 400
    data["current_password"] = "Strongpass123"
    assert c.post("/api/auth/password", headers=auth(), json=data).status_code == 200
    assert c.get("/api/auth/me", headers=auth()).status_code == 401
    assert c.get("/api/auth/me", headers=auth(2)).status_code == 200
    assert (
        c.post(
            "/api/auth/token", data={"username": "user1@example.com", "password": "Strongpass123"}
        ).status_code
        == 401
    )
    assert (
        c.post(
            "/api/auth/token",
            data={"username": "user1@example.com", "password": "NewStrongpass123"},
        ).status_code
        == 200
    )


def test_profile_permissions_and_csrf(setup):
    c, _ = setup
    assert (
        c.patch(
            "/api/auth/me", headers=auth(), json={"name": "Updated", "is_admin": True}
        ).status_code
        == 422
    )
    assert c.patch("/api/auth/me", headers=auth(), json={"name": "  "}).status_code == 422
    assert (
        c.patch("/api/auth/me", headers=auth(), json={"name": "Updated"}).json()["name"]
        == "Updated"
    )
    c.post("/api/auth/token", data={"username": "user1@example.com", "password": "Strongpass123"})
    assert (
        c.patch(
            "/api/auth/me", headers={"Origin": "https://evil.example"}, json={"name": "Malicious"}
        ).status_code
        == 403
    )
    assert c.get("/api/auth/me").json()["name"] == "Updated"


def test_login_throttling_and_expiration(setup):
    c, factory = setup
    from sqlalchemy import update

    from app.models import AuthThrottle

    for _ in range(10):
        assert (
            c.post(
                "/api/auth/token", data={"username": "missing@example.com", "password": "invalid"}
            ).status_code
            == 401
        )
    blocked = c.post(
        "/api/auth/token", data={"username": "missing@example.com", "password": "invalid"}
    )
    assert blocked.status_code == 429 and int(blocked.headers["Retry-After"]) > 0
    with factory() as db:
        db.execute(update(AuthThrottle).values(resets_at=utcnow() - timedelta(seconds=1)))
        db.commit()
    assert (
        c.post(
            "/api/auth/token", data={"username": "missing@example.com", "password": "invalid"}
        ).status_code
        == 401
    )


def test_support_ownership_and_reply(setup):
    c, _ = setup
    rid = c.post("/api/rentals", headers=auth(), json={"car_id": 1}).json()["id"]
    data = {"subject": "Car issue", "message": "Please check the vehicle", "rental_id": rid}
    assert c.post("/api/support", headers=auth(2), json=data).status_code == 404
    response = c.post("/api/support", headers=auth(), json=data)
    assert response.status_code == 201
    ticket_id = response.json()["id"]
    assert c.get("/api/support", headers=auth(2)).json() == []
    assert c.get("/api/admin/support", headers=auth()).status_code == 403
    assert (
        c.patch(
            f"/api/admin/support/{ticket_id}", headers=auth(), json={"reply": "Unauthorized"}
        ).status_code
        == 403
    )
    assert (
        c.patch(
            f"/api/admin/support/{ticket_id}",
            headers=auth(3),
            json={"reply": "We will check it", "status": "answered"},
        ).status_code
        == 200
    )
    ticket = c.get("/api/support", headers=auth()).json()[0]
    assert ticket["reply"] == "We will check it" and ticket["status"] == "answered"
    assert ticket["created_at"].endswith("Z")
    audit = c.get("/api/admin/audit", headers=auth(3)).json()
    assert audit[0]["action"] == "support.answered"
    assert c.get("/api/admin/support?status=open", headers=auth(3)).json() == []


def test_admin_edit_and_audit(setup):
    c, _ = setup
    data = {
        "brand": "Skoda",
        "model": "Octavia",
        "plate": "XYZ123",
        "category": "comfort",
        "address": "New location",
        "fuel": 90,
        "rate_kopecks": 1200,
    }
    assert c.put("/api/admin/cars/1", headers=auth(), json=data).status_code == 403
    assert c.put("/api/admin/cars/1", headers=auth(3), json=data).status_code == 200
    assert c.get("/api/admin/audit", headers=auth(3)).json()[0]["action"] == "car.updated"
    c.post("/api/rentals", headers=auth(), json={"car_id": 1})
    assert (
        c.put("/api/admin/cars/1", headers=auth(3), json={**data, "rate_kopecks": 800}).status_code
        == 409
    )
    assert c.get("/api/cars").json()[0]["rate_kopecks"] == 1200
    assert len(c.get("/api/admin/rentals?search=XYZ123", headers=auth(3)).json()) == 1
    assert c.get("/api/admin/summary", headers=auth()).status_code == 403
    assert c.get("/api/admin/summary", headers=auth(3)).json()["cars"] == 2


def test_support_validation_and_pagination(setup):
    c, _ = setup
    assert (
        c.post(
            "/api/support", headers=auth(), json={"subject": "   ", "message": "          "}
        ).status_code
        == 422
    )
    for n in range(3):
        c.post(
            "/api/support",
            headers=auth(),
            json={"subject": f"Subject {n}", "message": "A valid support message"},
        )
    a = c.get("/api/support?limit=2", headers=auth()).json()
    b = c.get("/api/support?limit=2&offset=2", headers=auth()).json()
    assert len(a) == 2 and len(b) == 1 and a[0]["id"] != b[0]["id"]
    assert c.get("/api/admin/audit?limit=0", headers=auth(3)).status_code == 422


def test_history_snapshot_and_receipt(setup):
    c, factory = setup
    rid = c.post(
        "/api/rentals", headers=auth(), json={"car_id": 1, "expected_rate_kopecks": 950}
    ).json()["id"]
    assert c.get(f"/api/rentals/{rid}/receipt", headers=auth()).status_code == 409
    c.post(f"/api/rentals/{rid}/start", headers=auth())
    c.post(
        f"/api/rentals/{rid}/finish", headers=auth(), json={"address": "Final parking", "fuel": 60}
    )
    with factory() as db:
        car = db.get(Car, 1)
        car.brand = "Changed"
        car.plate = "NEW123"
        car.address = "Different address"
        car.rate_kopecks = 2500
        db.commit()
    old = c.get("/api/rentals", headers=auth()).json()[0]
    assert old["car_name"] == "Kia Rio" and old["plate"] == "ABC1"
    assert old["pickup_address"] == "City center" and old["finish_address"] == "Final parking"
    receipt = c.get(f"/api/rentals/{rid}/receipt", headers=auth())
    assert receipt.status_code == 200 and "Final parking" in receipt.text and "9.50" in receipt.text
    assert "Changed" not in receipt.text
    assert c.get(f"/api/rentals/{rid}/receipt", headers=auth(2)).status_code == 404
    assert c.get("/api/rentals/summary", headers=auth()).json() == {
        "completed_count": 1,
        "total_kopecks": 950,
    }
    assert c.get("/api/rentals/current", headers=auth()).json() is None


def test_changed_quote_does_not_reserve(setup):
    c, _ = setup
    assert (
        c.post(
            "/api/rentals", headers=auth(), json={"car_id": 1, "expected_rate_kopecks": 500}
        ).status_code
        == 409
    )
    assert c.get("/api/cars").json()[0]["status"] == "available"
    assert c.get("/api/rentals/current", headers=auth()).json() is None
    assert (
        c.post(
            "/api/rentals", headers=auth(), json={"car_id": 1, "expected_rate_kopecks": 950}
        ).status_code
        == 201
    )
    assert c.get("/api/rentals/current", headers=auth()).json()["status"] == "reserved"


def test_readiness_and_security_headers(setup):
    c, factory = setup
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    from sqlalchemy import text

    assert c.get("/ready").status_code == 503
    head = ScriptDirectory.from_config(Config("alembic.ini")).get_current_head()
    with factory() as db:
        db.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)"))
        db.execute(text("INSERT INTO alembic_version VALUES (:head)"), {"head": head})
        db.commit()
    assert c.get("/ready").json() == {"status": "ready"}
    response = c.get("/")
    assert response.headers["x-frame-options"] == "DENY"
    assert "script-src 'self'" in response.headers["content-security-policy"]
    assert len(response.headers["x-request-id"]) == 32
    assert c.get("/", headers={"Host": "untrusted.example"}).status_code == 400


def test_production_configuration():
    from pydantic import ValidationError

    from app.core.config import Settings

    with pytest.raises(ValidationError):
        Settings(environment="production", cookie_secure=False)
    with pytest.raises(ValidationError):
        Settings(environment="production", cookie_secure=True, allowed_hosts=["*"])
    assert (
        Settings(
            environment="production", cookie_secure=True, allowed_hosts=["drive.example"]
        ).environment
        == "production"
    )


def test_separate_public_pages(setup):
    c, _ = setup
    for path, marker in [
        ("/", "home-links"),
        ("/cars", 'id="fleet"'),
        ("/login", 'id="auth"'),
        ("/how-it-works", 'id="how"'),
    ]:
        response = c.get(path)
        assert response.status_code == 200 and marker in response.text
        assert 'href="/cars"' in response.text
    home = c.get("/").text
    assert 'id="fleet"' not in home and 'id="auth-form"' not in home
    cars = c.get("/cars").text
    assert 'id="profile-form"' not in cars and 'id="support-form"' not in cars
    assert c.get("/not-a-page").status_code == 404


def test_private_pages_require_session_and_admin(setup):
    c, _ = setup
    from app.core.security import COOKIE

    for path in ["/trips", "/profile", "/support", "/admin", "/admin/fleet"]:
        response = c.get(path, follow_redirects=False)
        assert response.status_code == 303
        assert response.headers["location"].startswith("/login?next=")
    c.cookies.set(COOKIE, tokens[1])
    for path, marker in [
        ("/trips", 'id="rentals"'),
        ("/profile", 'id="profile-form"'),
        ("/support", 'id="support-form"'),
    ]:
        response = c.get(path)
        assert response.status_code == 200 and marker in response.text
        assert 'id="cars"' not in response.text
    assert c.get("/admin").status_code == 403
    assert c.get("/admin/fleet").status_code == 403
    c.cookies.set(COOKIE, tokens[3])
    assert 'id="operations"' in c.get("/admin").text
    fleet = c.get("/admin/fleet")
    assert fleet.status_code == 200 and 'id="edit-car-form"' in fleet.text
    assert 'id="support-form"' not in fleet.text
