from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.db import Base, get_db
from app.core.security import create_token
from app.main import app
from app.models import Car, GameScore, Rental, User, utcnow

tokens = {}


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
                    email=f"player{i}@example.com",
                    name=f"Игрок {i}",
                    password_hash="x",
                    is_admin=False,
                )
                for i in [1, 2, 3]
            ]
        )
        db.add(
            Car(
                id=7,
                brand="BMW",
                model="320i",
                plate="BBB777",
                category="business",
                address="City",
                rate_kopecks=2200,
                fuel=80,
            )
        )
        db.commit()
        tokens.clear()
        tokens.update({i: create_token(i, db) for i in [1, 2, 3]})
    with TestClient(app) as client:
        yield client, factory
    app.dependency_overrides.clear()
    engine.dispose()


def auth(i=1):
    return {"Authorization": "Bearer " + tokens[i]}


def run(**overrides):
    payload = {
        "car_name": "Демо «Драйв Ночной»",
        "category": "comfort",
        "score": 900000,
        "level": 15,
        "knockdowns": 600,
        "drones": 12,
        "bribes": 30,
        "profit_kopecks": 42000,
        "duration_seconds": 300,
        "reason": "wrecked",
    }
    payload.update(overrides)
    return payload


def test_score_requires_login_and_board_is_public(setup):
    c, _ = setup
    assert c.post("/api/game/scores", json=run()).status_code == 401
    empty = c.get("/api/game/leaderboard").json()
    assert empty["rows"] == [] and empty["me"] is None
    assert c.get("/api/game/leaderboard?period=bogus").status_code == 422
    assert c.post("/api/game/scores", headers=auth(), json=run(score=-1)).status_code == 422


def begin(setup, user=1, duration=300, car_id=7):
    c, factory = setup
    reserved = c.post(
        "/api/rentals", headers=auth(user), json={"car_id": car_id, "expected_rate_kopecks": 2200}
    )
    assert reserved.status_code == 201, reserved.text
    ident = reserved.json()["id"]
    assert c.post(f"/api/rentals/{ident}/start", headers=auth(user)).status_code == 200
    with factory() as db:
        db.get(Rental, ident).started_at = utcnow() - timedelta(seconds=duration)
        db.commit()
    return ident


def finish(setup, user=1, **values):
    ident = begin(setup, user, values.get("duration_seconds", 300))
    response = setup[0].post(
        f"/api/rentals/{ident}/game/finish", headers=auth(user), json=run(**values)
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_best_of_week_and_every_game_stays_in_history(setup):
    c, _ = setup
    first = finish(setup, score=500000)
    weaker = finish(setup, score=120000, level=9)
    better = finish(setup, score=800000, level=16)
    board = c.get("/api/game/leaderboard", headers=auth()).json()
    assert len(board["rows"]) == 1
    assert board["rows"][0]["score"] == 800000
    assert board["rows"][0]["rental_id"] == better["id"]
    assert board["rows"][0]["is_me"] is True
    assert board["totals"] == {"players": 1, "runs": 3}
    assert board["me"]["plays"] == 3
    assert board["me"]["rank"] == 1
    history = c.get("/api/rentals", headers=auth()).json()
    assert [r["game_result"]["score"] for r in history] == [800000, 120000, 500000]
    # Reposting an old trip with a forged client score cannot promote it.
    replay = c.post(
        "/api/game/scores", headers=auth(), json=run(rental_id=first["id"], score=4000000)
    )
    assert replay.status_code == 201
    assert replay.json()["improved"] is False and replay.json()["score"] == 800000
    assert weaker["status"] == "completed"


def test_board_ranks_players_and_preserves_legacy_weeks(setup):
    c, factory = setup
    finish(setup, user=1, score=400000)
    finish(setup, user=2, score=900000, level=16)
    with factory() as db:
        db.get(Car, 7).category = "economy"
        db.commit()
    finish(setup, user=3, score=650000)
    with factory() as db:
        db.add(
            GameScore(
                user_id=1,
                week="2020-W01",
                car_name="Kia Rio",
                category="economy",
                score=3000000,
                level=20,
                knockdowns=900,
                duration_seconds=400,
                reason="quit",
                created_at=utcnow(),
                updated_at=utcnow(),
            )
        )
        db.commit()
    weekly = c.get("/api/game/leaderboard", headers=auth()).json()
    assert [row["score"] for row in weekly["rows"]] == [900000, 650000, 400000]
    assert weekly["me"]["rank"] == 3
    alltime = c.get("/api/game/leaderboard?period=all", headers=auth()).json()
    assert [row["score"] for row in alltime["rows"]] == [3000000, 900000, 650000]
    assert alltime["totals"] == {"players": 3, "runs": 4}
    assert alltime["me"]["best_ever"] == 3000000
    economy = c.get("/api/game/leaderboard?category=economy", headers=auth()).json()
    assert [row["name"] for row in economy["rows"]] == ["Игрок 3"]
    page = c.get("/api/game/leaderboard?limit=1&offset=1").json()
    assert page["rows"][0]["rank"] == 2 and page["rows"][0]["score"] == 650000
    assert c.get("/leaderboard").status_code == 200


def test_implausible_game_cannot_end_or_bill_rental(setup):
    c, factory = setup
    ident = begin(setup, duration=300)
    for payload, message in [
        (run(score=5000000), "очков"),
        (run(duration_seconds=60, level=30, score=100000), "Уровень"),
        (run(duration_seconds=60, level=4, score=100000, knockdowns=3000), "сбитых"),
        (run(duration_seconds=360), "Длительность"),
    ]:
        rejected = c.post(f"/api/rentals/{ident}/game/finish", headers=auth(), json=payload)
        assert rejected.status_code == 422 and message in rejected.json()["detail"]
    with factory() as db:
        r = db.get(Rental, ident)
        assert r.status == "active" and r.total_kopecks == 0 and r.game_result is None
        assert db.get(Car, 7).status == "rented"
    assert c.get("/api/game/leaderboard").json()["rows"] == []


def test_finish_remembers_what_ended_the_shift(setup):
    c, _ = setup
    done = finish(setup, killer="drone", dodges=7)
    assert done["game_result"]["killer"] == "drone"
    assert done["game_result"]["dodges"] == 7
    assert finish(setup)["game_result"]["killer"] is None
    # Экран итогов подставляет метки из своего списка, поэтому мусор не проходит.
    ident = begin(setup, duration=60)
    junk = c.post(
        f"/api/rentals/{ident}/game/finish", headers=auth(), json=run(killer="<img src=x>")
    )
    assert junk.status_code == 422
    # Строка недели остаётся одной: killer не попал в таблицу рекордов.
    assert len(c.get("/api/game/leaderboard", headers=auth()).json()["rows"]) == 1


def test_owned_rental_snapshot_locked_billing_and_receipt(setup):
    c, factory = setup
    ident = begin(setup, duration=61)
    with factory() as db:
        car = db.get(Car, 7)
        car.brand, car.model, car.rate_kopecks = "Changed", "Car", 9999
        db.commit()
    assert c.get(f"/api/rentals/{ident}", headers=auth(2)).status_code == 404
    assert (
        c.post(f"/api/rentals/{ident}/game/finish", headers=auth(2), json=run()).status_code == 404
    )
    result = c.post(
        f"/api/rentals/{ident}/game/finish",
        headers=auth(),
        json=run(
            car_id=999,
            car_name="fake",
            category="economy",
            duration_seconds=60,
            level=3,
            score=100000,
            knockdowns=10,
            best_combo=4,
        ),
    ).json()
    assert result["total_kopecks"] == 4400
    assert result["game_result"]["car_name"] == "BMW 320i"
    assert result["game_result"]["category"] == "business"
    assert result["game_result"]["car_id"] == 7
    assert result["game_result"]["best_combo"] == 4
    assert c.get("/api/cars/7").json()["status"] == "available"
    receipt = c.get(f"/api/rentals/{ident}/receipt", headers=auth())
    assert receipt.status_code == 200 and "100000" in receipt.text
    assert "BMW 320i" in receipt.text


def test_zero_second_trip_finishes_without_qualifying_for_board(setup):
    c, _ = setup
    result = finish(setup, duration_seconds=0, level=1, score=0, knockdowns=0)
    assert result["status"] == "completed" and result["total_kopecks"] == 2200
    assert result["game_result"]["duration_seconds"] == 0
    assert c.get("/api/game/leaderboard").json()["rows"] == []
    assert c.get("/api/rentals/current", headers=auth()).json() is None


@pytest.mark.parametrize(
    "duration_ms,minutes", [(0, 1), (1499, 1), (1500, 1), (1501, 2), (60000, 40), (60001, 41)]
)
def test_accelerated_clock_bills_exact_boundaries_and_excludes_pause(setup, duration_ms, minutes):
    c, _ = setup
    ident = begin(setup, duration=120)  # Much longer wall time, including a pause.
    played = int(duration_ms / 1000 + 0.5)
    distance = min(10000, int(duration_ms / 1000 * 40 * 50 / 3.6))
    payload = run(
        duration_seconds=played,
        duration_ms=duration_ms,
        distance_meters=distance,
        time_scale=40,
        level=1,
        score=0,
        knockdowns=0,
    )
    response = c.post(f"/api/rentals/{ident}/game/finish", headers=auth(), json=payload)
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["total_kopecks"] == minutes * 2200
    outcome = saved["game_result"]
    assert outcome["charged_minutes"] == minutes
    assert outcome["trip_duration_seconds"] == duration_ms * 40 / 1000
    assert outcome["distance_meters"] == distance
    receipt = c.get(f"/api/rentals/{ident}/receipt", headers=auth()).text
    assert f"{minutes} мин" in receipt
    assert f"{distance / 1000:.1f} км" in receipt
    assert "Пробег" in receipt and "пауза не оплачивается" in receipt
    retry = c.post(f"/api/rentals/{ident}/game/finish", headers=auth(), json=payload).json()
    assert retry["game_result"] == outcome and retry["total_kopecks"] == saved["total_kopecks"]


@pytest.mark.parametrize(
    "overrides",
    [
        {"duration_ms": None},
        {"distance_meters": None},
        {"time_scale": 8},
        {"duration_ms": 310000},
        {"duration_ms": 290000},
        {"distance_meters": 500000},
    ],
)
def test_inconsistent_trip_clock_or_mileage_cannot_complete_rental(setup, overrides):
    c, factory = setup
    ident = begin(setup)
    payload = run(time_scale=40, duration_ms=300000, distance_meters=100000)
    payload.update(overrides)
    response = c.post(f"/api/rentals/{ident}/game/finish", headers=auth(), json=payload)
    assert response.status_code == 422, response.text
    with factory() as db:
        assert db.get(Rental, ident).status == "active"
        assert db.get(Rental, ident).total_kopecks == 0
        assert db.get(Rental, ident).game_result is None


def test_accelerated_clock_keeps_reserved_rate_even_after_fleet_price_changes(setup):
    c, factory = setup
    ident = begin(setup, duration=60)
    with factory() as db:
        db.get(Car, 7).rate_kopecks = 9999
        db.commit()
    response = c.post(
        f"/api/rentals/{ident}/game/finish",
        headers=auth(),
        json=run(
            duration_seconds=60,
            duration_ms=60000,
            distance_meters=30000,
            time_scale=40,
            score=100000,
            knockdowns=10,
            level=3,
        ),
    )
    assert response.status_code == 200, response.text
    assert response.json()["total_kopecks"] == 88000


def test_concurrent_completion_bills_once_and_keeps_first_outcome(setup):
    c, factory = setup
    ident = begin(setup)

    def send(score):
        return c.post(f"/api/rentals/{ident}/game/finish", headers=auth(), json=run(score=score))

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(send, [300000, 500000]))
    assert all(r.status_code == 200 for r in results)
    assert (
        results[0].json() == results[1].json()
        or results[0].json()["game_result"] == results[1].json()["game_result"]
    )
    replay = send(1000000).json()
    assert replay["game_result"] == results[0].json()["game_result"]
    with factory() as db:
        assert db.query(GameScore).count() == 1
        assert db.query(Rental).count() == 1
        assert db.get(Rental, ident).total_kopecks == replay["total_kopecks"]


def test_rank_write_failure_rolls_back_completion(setup, monkeypatch):
    c, factory = setup
    ident = begin(setup)

    def fail(*args):
        raise RuntimeError("test transaction failure")

    monkeypatch.setattr("app.services.game.record", fail)
    failed = c.post(f"/api/rentals/{ident}/game/finish", headers=auth(), json=run())
    assert failed.status_code == 500
    with factory() as db:
        assert db.get(Rental, ident).status == "active"
        assert db.get(Rental, ident).game_result is None
        assert db.get(Car, 7).status == "rented"
        assert db.query(GameScore).count() == 0


def test_only_active_owned_game_results_are_accepted(setup):
    c, _ = setup
    assert c.post("/api/game/scores", headers=auth(), json=run()).status_code == 422
    ident = begin(setup)
    assert c.post("/api/game/scores", headers=auth(), json=run(rental_id=ident)).status_code == 409
    assert c.post("/api/game/scores", headers=auth(2), json=run(rental_id=ident)).status_code == 404
    assert c.post("/api/rentals/999/game/finish", headers=auth(), json=run()).status_code == 404
    assert c.get(f"/drive?rental={ident}", headers=auth()).status_code == 200
    redirect = c.get(f"/drive?rental={ident}", follow_redirects=False)
    assert redirect.status_code == 303
    assert redirect.headers["location"] == f"/login?next=%2Fdrive%3Frental%3D{ident}"


def test_submissions_are_throttled(setup):
    c, _ = setup
    result = finish(setup, user=2)
    for index in range(40):
        response = c.post("/api/game/scores", headers=auth(2), json=run(rental_id=result["id"]))
        assert response.status_code == 201, index
    blocked = c.post("/api/game/scores", headers=auth(2), json=run(rental_id=result["id"]))
    assert blocked.status_code == 429
