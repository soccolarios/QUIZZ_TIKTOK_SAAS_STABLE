from datetime import datetime, timedelta, timezone
import jwt
from backend.saas.config.settings import JWT_SECRET, JWT_EXPIRES_HOURS


def generate_token(user_id: str, is_admin: bool = False) -> str:
    payload = {
        "sub": str(user_id),
        "adm": bool(is_admin),
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRES_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def verify_token(token: str) -> str | None:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        return payload.get("sub")
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None
