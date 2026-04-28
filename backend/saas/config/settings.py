import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL: str = os.environ.get("DATABASE_URL", "")
JWT_SECRET: str = os.environ.get("JWT_SECRET", "")
JWT_EXPIRES_HOURS: int = int(os.environ.get("JWT_EXPIRES_HOURS", "168"))
BCRYPT_ROUNDS: int = int(os.environ.get("BCRYPT_ROUNDS", "12"))

STRIPE_SECRET_KEY: str = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_PUBLISHABLE_KEY: str = os.environ.get("STRIPE_PUBLISHABLE_KEY", "")
STRIPE_WEBHOOK_SECRET: str = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
STRIPE_PRICE_PRO: str = os.environ.get("STRIPE_PRICE_PRO", "")
STRIPE_PRICE_PREMIUM: str = os.environ.get("STRIPE_PRICE_PREMIUM", "")

MAILJET_API_KEY: str = os.environ.get("MAILJET_API_KEY", "")
MAILJET_SECRET_KEY: str = os.environ.get("MAILJET_SECRET_KEY", "")
MAILJET_SENDER_EMAIL: str = os.environ.get("MAILJET_SENDER_EMAIL", "")
MAILJET_SENDER_NAME: str = os.environ.get("MAILJET_SENDER_NAME", "")
PASSWORD_RESET_EXPIRY_MINUTES: int = int(os.environ.get("PASSWORD_RESET_EXPIRY_MINUTES", "30"))

APP_BASE_URL: str = os.environ.get("APP_BASE_URL", "http://localhost:5173")
SAAS_BASE_URL: str = os.environ.get("SAAS_BASE_URL", "http://localhost:5001")
SAAS_PORT: int = int(os.environ.get("SAAS_PORT", "5001"))
FLASK_DEBUG: bool = os.environ.get("FLASK_DEBUG", "0") == "1"
FLASK_ENV: str = os.environ.get("FLASK_ENV", "production")

IS_PRODUCTION: bool = FLASK_ENV == "production"

CORS_ORIGINS: list = [
    origin.strip()
    for origin in os.environ.get("CORS_ORIGINS", APP_BASE_URL).split(",")
    if origin.strip()
]
