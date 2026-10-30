from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field, field_validator
from decimal import Decimal


class Settings(BaseSettings):
    # DB
    database_url: str
    migration_database_url: str | None = None

    # Auth
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    access_token_exp_minutes: int = 30
    refresh_token_exp_days: int = 30
    refresh_cookie_secure: bool = False
    enable_hsts: bool = False
    rate_limit_enabled: bool = True
    trading_halted: bool = False
    max_stock_concentration_pct: Decimal = Field(default=Decimal("50"), gt=0, le=100)

    # External APIs
    alpha_vantage_api_key: str | None = None
    sec_user_agent: str = "FintechRiskPlatform contact@example.com"
    market_hot_refresh_minutes: int = 15
    market_daily_refresh_hours: int = 24
    market_request_delay_seconds: float = 12.0

    # Frontend/API
    cors_origins: list[str] = Field(default_factory=list)

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @field_validator("jwt_secret")
    @classmethod
    def validate_jwt_secret(cls, value: str) -> str:
        if len(value.encode("utf-8")) < 32 or value == "change_me":
            raise ValueError("JWT_SECRET must contain at least 32 bytes and cannot be the default")
        return value


settings = Settings()
