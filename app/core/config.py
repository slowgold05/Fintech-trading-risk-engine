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
    enable_api_docs: bool = True
    rate_limit_enabled: bool = True
    mfa_required: bool = False
    impossible_travel_minutes: int = Field(default=60, ge=1, le=1440)
    login_geo_prefixes: str = ""
    large_order_step_up_notional: Decimal = Field(default=Decimal("10000"), gt=0)
    yente_url: str = ""
    yente_match_threshold: Decimal = Field(default=Decimal("0.85"), gt=0, le=1)
    massive_api_key: str = ""
    finnhub_api_key: str = ""
    twelve_data_api_key: str = ""
    kronos_checkpoint: str = ""
    trading_halted: bool = False
    scheduled_jobs_enabled: bool = False
    scheduled_job_interval_hours: int = Field(default=24, ge=1, le=168)
    scheduled_market_hot_limit: int = Field(default=200, ge=1, le=1000)
    scheduled_market_daily_limit: int = Field(default=100, ge=0, le=1000)
    scheduled_research_job_limit: int = Field(default=5, ge=0, le=50)
    research_synthesis_enabled: bool = False
    research_llm_base_url: str = "http://localhost:11434"
    research_llm_model: str = "qwen3:14b"
    research_llm_timeout_seconds: float = Field(default=120, gt=0, le=600)
    research_prompt_version: str = "v1"
    scheduled_daily_brief_limit: int = Field(default=20, ge=0, le=200)
    research_synthesis_backend: str = "simple"
    research_tradingagents_data_dir: str = "./var/tradingagents"
    forecast_kronos_enabled: bool = False
    forecast_kronos_model_name: str = "NeoQuasar/Kronos-small"
    forecast_kronos_tokenizer_name: str = "NeoQuasar/Kronos-Tokenizer-base"
    forecast_kronos_cache_dir: str = "./var/kronos"
    forecast_kronos_max_lookback: int = Field(default=400, ge=1, le=512)
    forecast_kronos_max_horizon: int = Field(default=30, ge=1, le=120)
    forecast_kronos_max_sample_count: int = Field(default=5, ge=1, le=20)
    max_stock_concentration_pct: Decimal = Field(default=Decimal("50"), gt=0, le=100)
    max_stock_position_notional: Decimal = Field(default=Decimal("50000"), gt=0)

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
