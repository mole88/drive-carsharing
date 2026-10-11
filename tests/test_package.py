from zipfile import ZipFile

from scripts.package import build


def test_release_is_standalone_and_contains_no_local_state(tmp_path):
    archive = build(tmp_path / "release.zip")
    with ZipFile(archive) as bundle:
        names = {name.removeprefix("drive-fastapi/") for name in bundle.namelist()}
        assert bundle.testzip() is None
        assert {
            "app/main.py",
            "app/api/cars.py",
            "app/api/rentals.py",
            "app/templates/base.html",
            "app/static/images/kiario.png",
            "app/static/images/hsolaris.png",
            "app/static/images/skodaoctavia.png",
            "app/static/images/BMW-3.png",
            "requirements.txt",
            "migrations/env.py",
            "README.md",
        } <= names
        assert not any(
            name.split("/")[0]
            in {"openai-site", ".venv", "node_modules", "tmp", "backups", ".git", ".openai"}
            for name in names
        )
        assert not any(name.endswith((".db", ".log", ".pyc")) or name == ".env" for name in names)
        assert "app/api/routes.py" not in names
        assert "app/api/trip_details.py" not in names
