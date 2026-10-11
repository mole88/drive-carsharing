"""Each URL renders a separate screen within the shared site layout."""

from hashlib import sha256
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import current_user

router = APIRouter()
templates = Path(__file__).parent / "templates"
static = Path(__file__).parent / "static"
asset_version = sha256(
    b"".join(
        path.read_bytes() for path in sorted(static.iterdir()) if path.suffix in {".css", ".js"}
    )
).hexdigest()[:16]
PAGES = {
    "/": ("home", "Каршеринг в Санкт-Петербурге", False),
    "/cars": ("cars", "Автомобили", False),
    "/drive": ("drive", "Поездка", True),
    "/leaderboard": ("leaderboard", "Лидерборд", False),
    "/login": ("login", "Вход и регистрация", False),
    "/how-it-works": ("how-it-works", "Как это работает", False),
    "/trips": ("trips", "Мои поездки", True),
    "/support": ("support", "Поддержка", True),
    "/profile": ("profile", "Профиль", True),
    "/admin": ("admin", "Кабинет администратора", True),
    "/admin/fleet": ("admin-fleet", "Управление автопарком", True),
}


def page(request: Request, db: Session = Depends(get_db)):
    name, title, protected = PAGES[request.url.path]
    if protected:
        try:
            user = current_user(request, token=None, db=db)
        except HTTPException as error:
            if error.status_code != 401:
                raise
            return RedirectResponse(
                "/login?next="
                + quote(
                    request.url.path + ("?" + request.url.query if request.url.query else ""),
                    safe="",
                ),
                status_code=303,
            )
        if name.startswith("admin") and not user.is_admin:
            return HTMLResponse(
                '<!doctype html><html lang="ru"><meta charset="utf-8"><title>Доступ ограничен — Драйв</title><link rel="stylesheet" href="/static/receipt.css"><main><h1>Доступ ограничен</h1><p>Этот раздел доступен администраторам сервиса.</p><a href="/cars">Вернуться к автомобилям</a></main></html>',
                status_code=403,
            )
    subnav = (
        '<nav class="admin-nav" aria-label="Разделы управления"><a href="/admin">Обращения и поездки</a><a href="/admin/fleet">Автопарк</a></nav>'
        if name.startswith("admin")
        else ""
    )
    scripts = (
        f'<script src="/static/operations.js?v={asset_version}" defer></script>'
        if name in {"support", "admin", "admin-fleet"}
        else ""
    )
    if name == "drive":
        scripts = "".join(
            f'<script src="/static/{file}?v={asset_version}" defer></script>'
            for file in ("game-core.js", "game-art.js", "game-audio.js", "game.js")
        )
    if name == "leaderboard":
        scripts = f'<script src="/static/leaderboard.js?v={asset_version}" defer></script>'
    styles = (
        f'<link rel="stylesheet" href="/static/game.css?v={asset_version}" />'
        if name in {"drive", "leaderboard"}
        else ""
    )
    html = (templates / "base.html").read_text(encoding="utf-8")
    values = {
        "title": title,
        "page": name,
        "subnav": subnav,
        "styles": styles,
        "content": (templates / f"{name}.html").read_text(encoding="utf-8"),
        "scripts": scripts,
        "asset_version": asset_version,
    }
    for key, value in values.items():
        html = html.replace("{{" + key + "}}", value)
    return HTMLResponse(html, headers={"Cache-Control": "no-store"})


for path in PAGES:
    router.add_api_route(path, page, methods=["GET"], include_in_schema=False)
