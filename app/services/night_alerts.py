from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.market_bar_daily import MarketBarDaily
from app.models.market_symbol import MarketSymbol
from app.models.night_alerts import NightAlert
from app.schemas.night_alerts import AlertCollection, AlertCreate, AlertOut, AlertSource
from app.services.night_notebook import as_utc, constraint_name, notebook_error, owner_write


MAX_ALERTS = 25
MARKET_TIME = ZoneInfo("America/New_York")


def _as_output(alert: NightAlert) -> AlertOut:
    source = None
    if alert.last_date is not None:
        source = AlertSource(
            provider=alert.last_provider,
            session_date=alert.last_date,
            observed_at=as_utc(alert.last_observed_at),
        )
    return AlertOut(
        id=alert.id, symbol=alert.symbol, direction=alert.direction, target=alert.target,
        status="triggered" if alert.triggered_at is not None else "armed",
        last_date=alert.last_date, last_close=alert.last_close,
        triggered_at=as_utc(alert.triggered_at) if alert.triggered_at is not None else None, source=source,
    )


def _owned_alerts(db: Session, user_id: int) -> list[NightAlert]:
    return list(db.scalars(select(NightAlert).where(NightAlert.user_id == user_id).order_by(NightAlert.id)))


def list_alerts(db: Session, user_id: int) -> AlertCollection:
    return AlertCollection(items=[_as_output(alert) for alert in _owned_alerts(db, user_id)])


def _duplicate_rule():
    return notebook_error(409, "duplicate_alert", "An armed alert already uses this rule.")


def create_alert(db: Session, user_id: int, payload: AlertCreate) -> AlertOut:
    with owner_write(db, user_id):
        symbol = db.scalar(select(MarketSymbol.symbol).where(
            MarketSymbol.symbol == payload.symbol, MarketSymbol.is_active.is_(True), MarketSymbol.is_test.is_(False),
        ))
        if symbol is None:
            raise notebook_error(404, "symbol_not_found", "Symbol not found.")
        alerts = _owned_alerts(db, user_id)
        if any(
            alert.triggered_at is None and alert.symbol == symbol
            and alert.direction == payload.direction and alert.target == payload.target
            for alert in alerts
        ):
            raise _duplicate_rule()
        if len(alerts) >= MAX_ALERTS:
            raise notebook_error(409, "alert_limit", "An account can have at most 25 alerts.")
        alert = NightAlert(user_id=user_id, **payload.model_dump())
        db.add(alert)
        try:
            db.flush()
        except IntegrityError as exc:
            if constraint_name(exc) == "uq_night_alerts_active_rule":
                raise _duplicate_rule() from None
            raise
        return _as_output(alert)


def _latest_raw_close(db: Session, symbol: str, now: datetime) -> MarketBarDaily | None:
    bar = MarketBarDaily
    return db.scalar(
        select(bar).where(
            bar.symbol == symbol, bar.adjustment_type == "raw", bar.quality_status == "valid",
            bar.session_date <= now.astimezone(MARKET_TIME).date(), bar.fetched_at <= now,
        ).order_by(bar.session_date.desc(), (bar.provider == "massive").desc(), bar.provider).limit(1)
    )


def evaluate_alerts(db: Session, user_id: int) -> AlertCollection:
    with owner_write(db, user_id):
        now = datetime.now(timezone.utc)
        alerts = _owned_alerts(db, user_id)
        armed = [alert for alert in alerts if alert.triggered_at is None]
        closes = {symbol: _latest_raw_close(db, symbol, now) for symbol in sorted({a.symbol for a in armed})}
        for alert in armed:
            bar = closes[alert.symbol]
            if bar is None or (alert.last_date is not None and bar.session_date <= alert.last_date):
                continue
            alert.last_date = bar.session_date
            alert.last_close = bar.close
            alert.last_provider = bar.provider
            alert.last_observed_at = bar.fetched_at
            if ((alert.direction == "at_or_above" and bar.close >= alert.target)
                    or (alert.direction == "at_or_below" and bar.close <= alert.target)):
                alert.triggered_at = now
        return AlertCollection(items=[_as_output(alert) for alert in alerts])


def delete_alert(db: Session, user_id: int, alert_id: int) -> None:
    with owner_write(db, user_id):
        alert = db.scalar(select(NightAlert).where(NightAlert.user_id == user_id, NightAlert.id == alert_id))
        if alert is None:
            raise notebook_error(404, "alert_not_found", "Alert not found.")
        db.delete(alert)
