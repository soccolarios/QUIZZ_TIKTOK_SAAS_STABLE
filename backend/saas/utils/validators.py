import re


EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def is_valid_email(email: str) -> bool:
    return bool(EMAIL_RE.match(email))


def is_valid_password(password: str) -> tuple[bool, str]:
    if len(password) < 8:
        return False, "Password must be at least 8 characters"
    return True, ""


def is_valid_name(name: str, field: str = "name") -> tuple[bool, str]:
    if not name or not name.strip():
        return False, f"{field} is required"
    if len(name.strip()) > 255:
        return False, f"{field} must be 255 characters or less"
    return True, ""
