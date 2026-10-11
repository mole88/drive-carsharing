import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.db import Base, get_db
from app.core.security import create_token
from app.main import app
from app.models import Car, GameScore, User, utcnow
from app.services.game import week_of

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


def test_best_of_the_week_wins(setup):
    c, _ = setup
    first = c.post("/api/game/scores", headers=auth(), json=run(score=500000))
    assert first.status_code == 201
    assert first.json()["improved"] is True
    weaker = c.post("/api/game/scores", headers=auth(), json=run(score=120000, level=9))
    assert weaker.json()["improved"] is False
    assert weaker.json()["score"] == 500000
    better = c.post("/api/game/scores", headers=auth(), json=run(score=800000, level=16))
    assert better.json()["improved"] is True
    assert better.json()["score"] == 800000
    assert better.json()["personal"]["rank"] == 1
    board = c.get("/api/game/leaderboard", headers=auth()).json()
    assert len(board["rows"]) == 1
    assert board["totals"] == {"players": 1, "runs": 1}
    assert board["rows"][0]["is_me"] is True
    assert board["me"]["plays"] == 1


def test_board_ranks_players_and_separates_weeks(setup):
    c, factory = setup
    c.post("/api/game/scores", headers=auth(1), json=run(score=400000))
    c.post("/api/game/scores", headers=auth(2), json=run(score=900000, level=16))
    c.post("/api/game/scores", headers=auth(3), json=run(score=650000, category="economy"))
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
        weeks = {row.week for row in db.query(GameScore).all()}
        assert week_of() in weeks and "2020-W01" in weeks
    weekly = c.get("/api/game/leaderboard", headers=auth(1)).json()
    assert [row["score"] for row in weekly["rows"]] == [900000, 650000, 400000]
    assert [row["rank"] for row in weekly["rows"]] == [1, 2, 3]
    assert weekly["me"]["rank"] == 3
    alltime = c.get("/api/game/leaderboard?period=all", headers=auth(1)).json()
    assert [row["score"] for row in alltime["rows"]] == [3000000, 900000, 650000]
    assert alltime["totals"]["players"] == 3
    assert alltime["totals"]["runs"] == 4
    assert alltime["me"]["rank"] == 1
    assert alltime["me"]["best_ever"] == 3000000
    economy = c.get("/api/game/leaderboard?category=economy", headers=auth(1)).json()
    assert [row["name"] for row in economy["rows"]] == ["Игрок 3"]


def test_implausible_runs_are_rejected(setup):
    c, _ = setup
    too_fast = c.post("/api/game/scores", headers=auth(), json=run(score=5000000))
    assert too_fast.status_code == 422
    assert "очков" in too_fast.json()["detail"]
    wrong_level = c.post(
        "/api/game/scores", headers=auth(), json=run(duration_seconds=60, level=30, score=100000)
    )
    assert wrong_level.status_code == 422
    assert "Уровень" in wrong_level.json()["detail"]
    too_many = c.post(
        "/api/game/scores",
        headers=auth(),
        json=run(duration_seconds=60, level=4, score=100000, knockdowns=3000),
    )
    assert too_many.status_code == 422
    assert "сбитых" in too_many.json()["detail"]
    assert c.get("/api/game/leaderboard", headers=auth()).json()["rows"] == []


def test_car_snapshot_overrides_the_client_label(setup):
    c, _ = setup
    response = c.post("/api/game/scores", headers=auth(), json=run(car_id=7, car_name="чепуха"))
    assert response.status_code == 201
    row = c.get("/api/game/leaderboard", headers=auth()).json()["rows"][0]
    assert row["car_name"] == "BMW 320i"
    assert row["category"] == "business"
    missing = c.post("/api/game/scores", headers=auth(2), json=run(car_id=999))
    assert missing.status_code == 404


def test_submissions_are_throttled(setup):
    c, _ = setup
    for index in range(40):
        response = c.post("/api/game/scores", headers=auth(2), json=run(score=index + 1))
        assert response.status_code == 201, index
    blocked = c.post("/api/game/scores", headers=auth(2), json=run(score=99))
    assert blocked.status_code == 429
