"""Build the standalone FastAPI source release; never package local state."""

from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
FILES = (
    "README.md",
    ".env.example",
    ".gitignore",
    ".dockerignore",
    "requirements.txt",
    "requirements-dev.txt",
    "pyproject.toml",
    "alembic.ini",
    "start.ps1",
    "Dockerfile",
    "compose.yaml",
    "package.json",
    "pnpm-lock.yaml",
)
DIRECTORIES = ("app", "migrations", "tests", "docs", "scripts")
SOURCE_EXTENSIONS = {".py", ".html", ".css", ".js", ".cjs", ".md", ".png", ".mp3"}


def source_files(root: Path = ROOT):
    for name in FILES:
        yield root / name
    for name in DIRECTORIES:
        for path in sorted((root / name).rglob("*")):
            if (
                path.is_file()
                and path.suffix in SOURCE_EXTENSIONS
                and "__pycache__" not in path.parts
            ):
                if not path.resolve().is_relative_to(root.resolve()):
                    raise ValueError(f"Source points outside the project: {path}")
                yield path


def build(destination: Path | None = None):
    target = destination or ROOT / "dist" / "drive-fastapi.zip"
    target.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(target, "w", compression=ZIP_DEFLATED) as archive:
        for path in source_files():
            archive.write(path, "drive-fastapi/" + path.relative_to(ROOT).as_posix())
    return target


if __name__ == "__main__":
    print(build())
