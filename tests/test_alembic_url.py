from alembic.config import Config
from sqlalchemy import engine_from_config, pool


def test_encoded_database_password_survives_alembic_config():
    url = "postgresql+psycopg://user:%23secret%25value@db/fintechapp?sslmode=verify-full"
    config = Config()
    config.set_main_option("sqlalchemy.url", url.replace("%", "%%"))
    engine = engine_from_config(config.get_section(config.config_ini_section),
                                prefix="sqlalchemy.", poolclass=pool.NullPool)
    assert engine.url.password == "#secret%value"
