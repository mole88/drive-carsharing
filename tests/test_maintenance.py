import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

from app.maintenance import backup_sqlite


def test_backup_live_database_and_no_overwrite(tmp_path):
    source = tmp_path / "source.db"
    target = tmp_path / "backup.db"
    with sqlite3.connect(source) as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT)")
        connection.execute("INSERT INTO sample VALUES (1, 'saved')")
        connection.commit()
        backup_sqlite(f"sqlite:///{source}", target)
        connection.execute("INSERT INTO sample VALUES (2, 'later')")
    with sqlite3.connect(target) as copy:
        assert copy.execute("SELECT * FROM sample").fetchall() == [(1, "saved")]
    with pytest.raises(ValueError, match="new file"):
        backup_sqlite(f"sqlite:///{source}", target)
    with pytest.raises(ValueError, match="new file"):
        backup_sqlite(f"sqlite:///{source}", source)


def test_migrate_existing_rental_preserves_data(tmp_path):
    database = tmp_path / "migration.db"
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{database}"}
    root = Path(__file__).resolve().parents[1]

    def migrate(revision):
        subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", revision],
            env=env,
            cwd=root,
            check=True,
            capture_output=True,
        )

    migrate("0001")
    with sqlite3.connect(database) as db:
        db.execute("INSERT INTO users VALUES (1,'old@example.com','Old user','hash',0)")
        db.execute(
            "INSERT INTO cars VALUES (1,'Kia','Rio','ABC123','economy','Current address',80,900,'available')"
        )
        db.execute(
            "INSERT INTO rentals VALUES (1,1,1,'completed',900,'2026-01-01 10:00:00','2026-01-01 10:01:00','2026-01-01 10:02:00',900)"
        )
    migrate("head")
    with sqlite3.connect(database) as db:
        result = db.execute(
            "SELECT total_kopecks, car_name_snapshot, plate_snapshot, pickup_address, finish_address FROM rentals WHERE id=1"
        ).fetchone()
        assert result == (900, "Kia Rio", "ABC123", "", None)
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
        assert db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 1
        assert db.execute("SELECT image FROM cars WHERE id=1").fetchone() == (None,)
    subprocess.run(
        [sys.executable, "-m", "alembic", "check"],
        env=env,
        cwd=root,
        check=True,
        capture_output=True,
    )
    for _ in range(2):
        subprocess.run(
            [sys.executable, "-m", "app.cli", "seed"],
            env=env,
            cwd=root,
            check=True,
            capture_output=True,
        )
    with sqlite3.connect(database) as db:
        photos = db.execute("SELECT image FROM cars WHERE image IS NOT NULL").fetchall()
        assert len(photos) == 4
        assert db.execute("SELECT COUNT(*) FROM cars").fetchone()[0] == 5
        assert db.execute("SELECT total_kopecks FROM rentals WHERE id=1").fetchone() == (900,)
        for (photo,) in photos:
            assert (root / "app" / "static" / photo).is_file()


def test_photo_backfill_preserves_custom_photos_and_car_details(tmp_path):
    database = tmp_path / "photos.db"
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{database}"}
    root = Path(__file__).resolve().parents[1]

    def migrate(revision):
        subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", revision],
            env=env,
            cwd=root,
            check=True,
            capture_output=True,
        )

    migrate("0005")
    with sqlite3.connect(database) as db:
        db.executemany(
            "INSERT INTO cars (brand,model,plate,category,address,fuel,rate_kopecks,status,image) "
            "VALUES (?,?,?,'economy','Saved address',37,1733,'maintenance',?)",
            [
                ("Kia", "Rio", "А101АА178", None),
                ("Hyundai", "Solaris", "А102АА178", ""),
                ("Skoda", "Octavia", "А103АА178", None),
                ("BMW", "320i", "А104АА178", "images/custom.png"),
                ("Kia", "Rio", "PRIVATE123", None),
            ],
        )
    migrate("head")
    migrate("head")
    with sqlite3.connect(database) as db:
        assert db.execute("SELECT image FROM cars ORDER BY id").fetchall() == [
            ("images/kiario.png",),
            ("images/hsolaris.png",),
            ("images/skodaoctavia.png",),
            ("images/custom.png",),
            (None,),
        ]
        assert db.execute(
            "SELECT DISTINCT address,fuel,rate_kopecks,status FROM cars"
        ).fetchall() == [("Saved address", 37, 1733, "maintenance")]
