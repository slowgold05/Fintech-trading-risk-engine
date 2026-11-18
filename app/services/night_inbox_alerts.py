"""Project the activated notebook's persisted price-alert rows."""

from sqlalchemy import DateTime, String, cast, func, literal
from sqlalchemy.sql import Select
from sqlalchemy.sql.selectable import FromClause

from app.services.night_inbox import AlertSource, event_projection


def stored_alert_source(alerts: FromClause) -> AlertSource:
    """Adapt the PostgreSQL night_alerts table to the owner's trigger feed."""
    alert = alerts.c

    def owned_triggers(owner_id: int) -> Select:
        return event_projection(
            literal("alert_triggered:") + cast(alert.id, String),
            literal("alert_triggered"),
            func.timezone("UTC", alert.triggered_at, type_=DateTime()),
            symbol=alert.symbol,
            alert_id=alert.id,
            price=alert.last_close,
            target=alert.target,
            session_date=alert.last_date,
            provider=alert.last_provider,
            observed_at=func.timezone("UTC", alert.last_observed_at, type_=DateTime()),
        ).where(alert.user_id == owner_id, alert.triggered_at.is_not(None))

    return owned_triggers
