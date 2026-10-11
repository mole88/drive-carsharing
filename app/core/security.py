from datetime import UTC, datetime, timedelta
from hashlib import sha256
from secrets import token_urlsafe
from urllib.parse import urlsplit

import jwt
from fastapi import Depends, HTTPException, Request, Response
from fastapi.security import OAuth2PasswordBearer
from pwdlib import PasswordHash
from sqlalchemy import case, delete
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.models import AuthThrottle, LoginSession, User, utcnow

password_hash = PasswordHash.recommended()
dummy_hash = password_hash.hash("unused-dummy-password-for-constant-hash-work")
oauth2 = OAuth2PasswordBearer(tokenUrl="/api/auth/token", auto_error=False)
COOKIE = "drive_session"


def create_token(user_id, db):
    sid = token_urlsafe(32)
    expiry = datetime.now(UTC) + timedelta(minutes=settings.token_minutes)
    db.add(LoginSession(id=sid, user_id=user_id, expires_at=expiry.replace(tzinfo=None)))
    db.commit()
    return jwt.encode(
        {"sub": str(user_id), "jti": sid, "exp": expiry}, settings.secret_key, algorithm="HS256"
    )


def set_session_cookie(response: Response, token: str):
    response.set_cookie(
        COOKIE,
        token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        max_age=settings.token_minutes * 60,
        path="/",
    )


def current_user(
    request: Request, token: str | None = Depends(oauth2), db: Session = Depends(get_db)
):
    if not token:
        token = request.cookies.get(COOKIE)
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            origin = request.headers.get("origin")
            if request.headers.get("sec-fetch-site") == "cross-site" or (
                origin and urlsplit(origin).netloc != request.url.netloc
            ):
                raise HTTPException(403, "Запрос с другого сайта отклонён")
    user = None
    try:
        payload = jwt.decode(
            token or "",
            settings.secret_key,
            algorithms=["HS256"],
            options={"require": ["sub", "exp", "jti"]},
        )
        session = db.get(LoginSession, payload["jti"])
        if session and session.expires_at > utcnow() and session.user_id == int(payload["sub"]):
            user = db.get(User, session.user_id)
            request.state.session_id = session.id
    except (jwt.PyJWTError, ValueError, TypeError):
        pass
    if user is None:
        raise HTTPException(
            401, "Сессия завершена. Войдите снова", headers={"WWW-Authenticate": "Bearer"}
        )
    return user


def throttle(db, identity, limit=10):
    if db.bind.dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    now = utcnow()
    reset = now + timedelta(minutes=15)
    key = sha256(identity.encode()).hexdigest()
    statement = insert(AuthThrottle).values(key=key, attempts=1, resets_at=reset)
    statement = statement.on_conflict_do_update(
        index_elements=[AuthThrottle.key],
        set_={
            "attempts": case((AuthThrottle.resets_at <= now, 1), else_=AuthThrottle.attempts + 1),
            "resets_at": case((AuthThrottle.resets_at <= now, reset), else_=AuthThrottle.resets_at),
        },
    ).returning(AuthThrottle.attempts, AuthThrottle.resets_at)
    attempts, resets_at = db.execute(statement).one()
    db.commit()
    if attempts > limit:
        raise HTTPException(
            429,
            "Слишком много попыток. Попробуйте позже",
            headers={"Retry-After": str(max(1, int((resets_at - now).total_seconds())))},
        )


def revoke_sessions(db, user_id):
    db.execute(delete(LoginSession).where(LoginSession.user_id == user_id))


def admin_user(user: User = Depends(current_user)):
    if not user.is_admin:
        raise HTTPException(403, "Требуются права администратора")
    return user


def optional_user(
    request: Request, token: str | None = Depends(oauth2), db: Session = Depends(get_db)
):
    """Для публичных эндпоинтов: гость остаётся гостем, а не ошибкой."""
    try:
        return current_user(request, token=token, db=db)
    except HTTPException as error:
        if error.status_code != 401:
            raise
        return None
