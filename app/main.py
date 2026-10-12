import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

from fastapi import Depends, FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.orm import Session
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api.accounts import router as accounts_router
from app.api.admin import router as admin_router
from app.api.cars import router as cars_router
from app.api.game import router as game_router
from app.api.rentals import router as rentals_router
from app.api.support import router as support_router
from app.core.config import settings
from app.core.db import SessionLocal, get_db
from app.pages import router as pages_router
from app.services.rentals import expire_rentals


def cleanup():
    with SessionLocal() as db:
        expire_rentals(db)
        from sqlalchemy import delete

        from app.models import AuthThrottle, LoginSession, utcnow

        db.execute(delete(LoginSession).where(LoginSession.expires_at < utcnow()))
        db.execute(delete(AuthThrottle).where(AuthThrottle.resets_at < utcnow()))
        db.commit()


@asynccontextmanager
async def lifespan(app):
    async def worker():
        while True:
            try:
                await asyncio.to_thread(cleanup)
            except Exception:
                logging.getLogger(__name__).exception("Rental cleanup failed")
            await asyncio.sleep(30)

    task = asyncio.create_task(worker())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title="Драйв • Сервис каршеринга",
    version="0.3.0",
    lifespan=lifespan,
    docs_url="/docs" if settings.environment == "development" else None,
    redoc_url=None,
)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)
app.include_router(cars_router)
app.include_router(accounts_router)
app.include_router(admin_router)
app.include_router(support_router)
app.include_router(rentals_router)
app.include_router(game_router)
app.include_router(pages_router)


@app.middleware("http")
async def security_headers(request, call_next):
    request_id = uuid4().hex
    try:
        response = await call_next(request)
    except Exception:
        logging.getLogger(__name__).exception("Request failed: %s", request_id)
        response = JSONResponse(
            status_code=500,
            content={
                "detail": "Не удалось выполнить запрос. Попробуйте позже",
                "request_id": request_id,
            },
        )
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if request.url.path != "/docs":
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        )
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    elif request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


static = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=static), name="static")


@app.get("/health", tags=["Система"])
def health():
    return {"status": "ok"}


@app.get("/ready", tags=["Система"])
def ready(db: Session = Depends(get_db)):
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    try:
        current = db.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
        config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
        config.set_main_option(
            "script_location", str(Path(__file__).resolve().parents[1] / "migrations")
        )
        if current != ScriptDirectory.from_config(config).get_current_head():
            return JSONResponse(status_code=503, content={"status": "not_ready"})
        return {"status": "ready"}
    except Exception:
        return JSONResponse(status_code=503, content={"status": "not_ready"})
