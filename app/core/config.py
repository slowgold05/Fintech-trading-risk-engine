from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # DB
    database_url: str = "mysql+pymysql://root:root@localhost:3306/fintechapp"

    # Auth
    jwt_secret: str = "change_me"
    jwt_algorithm: str = "HS256"
    access_token_exp_minutes: int = 30

    # External APIs
    alpha_vantage_api_key: str | None = None

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
