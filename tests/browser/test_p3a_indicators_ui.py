"""Indicator overlay on public daily history. Opt-in, provider-blocked, disposable DB only."""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

pytest.importorskip("selenium")

from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import Select
from sqlalchemy import select, text
from sqlalchemy.orm import Session

import test_p0b_acceptance as h
import test_p3b_ticket as t
from app.models.market_bar_daily import MarketBarDaily
from app.models.market_symbol import MarketSymbol
from app.models.user import User
from app.services.ledger_service import reconcile_account

pytestmark = pytest.mark.skipif(os.environ.get("P0B_BROWSER") != "1", reason="Set P0B_BROWSER=1")
disposable_api = h.disposable_api
SYMBOL = "P3INDUI"
MISSING = "P3INDMISSING"
PROVIDER = "fixture-indicators-ui"
ARTIFACTS = h.REPO_ROOT / ".local-tools" / "p3a-indicators-ui"
SECTION = "section[aria-labelledby='daily-price-history-title']"
OFFSETS = (0, 2, 5, 10, 18, 25)
CLOSES = (Decimal("1"), Decimal("4"), Decimal("2"), Decimal("8"), Decimal("3"), Decimal("9"))
SMA3 = ["Warm-up", "Warm-up", "2.333333", "4.666667", "4.333333", "6.666667"]
EMA3 = ["Warm-up", "Warm-up", "2.333333", "5.166667", "4.083333", "6.541667"]
# RSI needs period+1 closes to seed, one more warm-up bar than SMA/EMA's period.
RSI3 = ["Warm-up", "Warm-up", "Warm-up", "81.818182", "48.648649", "70.312500"]
SERIES = json.dumps([PROVIDER, "raw"], separators=(",", ":"))


def _seed(engine) -> None:
    database = None
    try:
        with Session(engine) as db:
            database = db.execute(text("SELECT current_database()")).scalar()
            if database == h.DISPOSABLE_DATABASE:
                item = db.get(MarketSymbol, SYMBOL)
                if item is None:
                    item = MarketSymbol(symbol=SYMBOL, company_name="Indicator fixture", exchange="NASDAQ")
                    db.add(item)
                item.company_name, item.exchange, item.sector = "Indicator fixture", "NASDAQ", "Technology"
                item.is_etf, item.is_test, item.is_active = False, False, True
                item.refresh_tier, item.heatmap_size, item.source = "daily", "micro", "nasdaq_trader"
                db.flush()
                now = datetime.now(timezone.utc)
                anchor = now.date() - timedelta(days=30)
                for offset, close in zip(OFFSETS, CLOSES, strict=True):
                    session = anchor + timedelta(days=offset)
                    bar = db.get(MarketBarDaily, (SYMBOL, session, PROVIDER, "raw"))
                    if bar is None:
                        bar = MarketBarDaily(symbol=SYMBOL, session_date=session, provider=PROVIDER, adjustment_type="raw")
                        db.add(bar)
                    bar.open, bar.high, bar.low, bar.close = close - Decimal("0.2"), close + Decimal("0.4"), close - Decimal("0.4"), close
                    bar.volume, bar.quality_status, bar.fetched_at = 0, "valid", now - timedelta(minutes=1)
                db.commit()
    except Exception:
        pytest.fail("indicator bar seed failed")
    if database != h.DISPOSABLE_DATABASE:
        pytest.fail("refusing to seed outside the disposable browser database")


def _books(engine, email: str) -> dict:
    counts = h._owner_activity_counts(engine, email)
    database, cash, reconciled = None, None, None
    try:
        with Session(engine) as db:
            database = db.execute(text("SELECT current_database()")).scalar()
            if database == h.DISPOSABLE_DATABASE:
                user = db.execute(select(User).where(User.email == email)).scalar_one()
                report = reconcile_account(db, user)
                cash, reconciled = str(user.cash_balance), bool(report.get("ok"))
    except Exception:
        pytest.fail("ledger reconciliation failed")
    if database != h.DISPOSABLE_DATABASE:
        pytest.fail("refusing to reconcile outside the disposable browser database")
    return {"counts": counts, "cash": cash, "reconciled": reconciled}


def _section(driver):
    return driver.find_element(By.CSS_SELECTOR, SECTION)


def _install_tracker(driver) -> None:
    driver.execute_script(
        """
        if (window.__p3ind) { return; }
        window.__p3ind = {history: 0, indicators: 0};
        const origOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url) {
          try {
            const path = new URL(String(url), location.origin).pathname;
            if (path === "/market/symbols/P3INDUI/history") { window.__p3ind.history += 1; }
            if (path === "/market/symbols/P3INDUI/indicators") { window.__p3ind.indicators += 1; }
          } catch (error) { /* ignore non-URL opens */ }
          return origOpen.apply(this, arguments);
        };
        """
    )


def _starts(driver) -> dict:
    raw = driver.execute_script("return window.__p3ind || {history: 0, indicators: 0};")
    return {"history": int(raw["history"]), "indicators": int(raw["indicators"])}


def _frames(driver) -> None:
    driver.execute_async_script(
        "const done = arguments[arguments.length - 1]; requestAnimationFrame(() => requestAnimationFrame(() => done(true)));"
    )


def _fill(driver, symbol: str, indicator: str, period: str | None) -> None:
    field = _section(driver).find_element(By.ID, "daily-history-symbol")
    field.clear()
    field.send_keys(symbol)
    Select(_section(driver).find_element(By.ID, "daily-history-series")).select_by_value(SERIES)
    Select(_section(driver).find_element(By.ID, "daily-history-indicator")).select_by_value(indicator)
    if period is not None:
        box = _section(driver).find_element(By.ID, "daily-history-period")
        box.clear()
        box.send_keys(period)


def _view(driver) -> None:
    h._click(driver, _section(driver).find_element(By.XPATH, ".//button[normalize-space()='View history']"))


def _chart(driver):
    box = _section(driver).find_element(By.CSS_SELECTOR, "div.h-80")
    if not box.is_displayed() or not box.find_elements(By.TAG_NAME, "canvas"):
        return False
    if "Daily price chart unavailable" in _section(driver).text:
        return False
    return box


def _open_prices(driver) -> None:
    summary = _section(driver).find_element(By.TAG_NAME, "summary")
    if not summary.find_element(By.XPATH, "..").get_attribute("open"):
        h._click(driver, summary)


def _indicator_cells(driver) -> list[str]:
    table = _section(driver).find_element(By.CSS_SELECTOR, "details table")
    return [row.find_elements(By.TAG_NAME, "td")[-1].text.strip() for row in table.find_elements(By.CSS_SELECTOR, "tbody tr")]


def _headers(driver) -> list[str]:
    return [(node.get_attribute("textContent") or "").strip() for node in _section(driver).find_elements(By.CSS_SELECTOR, "details table thead th")]


def _wait_prices(driver, expected: list[str], header: str) -> None:
    def ready(current) -> bool:
        _open_prices(current)
        return _indicator_cells(current) == expected and _headers(current)[-1] == header

    h._wait(driver).until(ready)


def test_indicator_overlay_ui(disposable_api) -> None:
    _seed(disposable_api.engine)
    before = _books(disposable_api.engine, disposable_api.email)
    assert before["reconciled"] is True
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    driver = h._driver()
    try:
        t._css_viewport(driver, 1280, 800, False)
        driver.get(disposable_api.web_url + "/market")
        h._wait(driver).until(lambda current: current.find_elements(By.CSS_SELECTOR, "#daily-history-series option[value]:not([value=''])"))
        assert _section(driver).find_element(By.ID, "daily-history-indicator").get_attribute("value") == "none"
        assert not _section(driver).find_elements(By.ID, "daily-history-period")
        _install_tracker(driver)
        quiet = _starts(driver)

        _fill(driver, SYMBOL, "sma", "3")
        _frames(driver)
        assert _starts(driver) == quiet

        _view(driver)
        h._wait(driver).until(_chart)
        _wait_prices(driver, SMA3, "SMA (3)")
        headers = _headers(driver)
        assert headers[:5] == ["Session date", "Open", "High", "Low", "Close"]
        assert headers[-1] == "SMA (3)"
        text = _section(driver).text
        assert "on observed stored closes" in text and "Warm-up: the first 2" in text
        assert "1.000000" in text and "9.000000" in text
        trade = _section(driver).find_element(By.LINK_TEXT, "Trade this symbol")
        assert trade.get_attribute("href").endswith("/trades?symbol=P3INDUI")
        assert "price" not in (trade.get_attribute("href") or "") and "qty" not in (trade.get_attribute("href") or "")
        first = _starts(driver)
        assert first["indicators"] == quiet["indicators"] + 1 and first["history"] == quiet["history"]
        t._shot(driver, h._wait(driver).until(_chart), ARTIFACTS / "sma-desktop.png")
        t._shot(driver, _section(driver).find_element(By.CSS_SELECTOR, "details .table-shell"), ARTIFACTS / "sma-table.png")

        Select(_section(driver).find_element(By.ID, "daily-history-indicator")).select_by_value("ema")
        _frames(driver)
        assert _starts(driver) == first and _indicator_cells(driver) == SMA3

        _view(driver)
        _wait_prices(driver, EMA3, "EMA (3)")
        ema = _starts(driver)
        assert ema["history"] == first["history"] and ema["indicators"] == first["indicators"] + 1
        t._shot(driver, h._wait(driver).until(_chart), ARTIFACTS / "ema-desktop.png")

        period = _section(driver).find_element(By.ID, "daily-history-period")
        period.clear()
        period.send_keys("20")
        _view(driver)
        h._wait(driver).until(lambda current: "Insufficient stored closes for this period." in _section(current).text)
        _wait_prices(driver, ["Warm-up"] * 6, "EMA (20)")
        assert "0.000000" not in " ".join(_indicator_cells(driver))
        assert h._wait(driver).until(_chart)
        t._shot(driver, h._wait(driver).until(_chart), ARTIFACTS / "insufficient.png")

        Select(_section(driver).find_element(By.ID, "daily-history-indicator")).select_by_value("sma")
        period = _section(driver).find_element(By.ID, "daily-history-period")
        period.clear()
        period.send_keys("3")
        held = _starts(driver)
        _view(driver)
        _wait_prices(driver, SMA3, "SMA (3)")
        _frames(driver)
        back = _starts(driver)
        assert back["history"] == held["history"] and back["indicators"] >= held["indicators"]

        t._css_viewport(driver, 390, 844, True)
        h._wait(driver).until(_chart)
        assert driver.execute_script(
            """
            const root = document.documentElement, main = document.querySelector('main');
            const chart = document.querySelector("section[aria-labelledby='daily-price-history-title'] div.h-80");
            const box = chart.getBoundingClientRect();
            return root.scrollWidth <= root.clientWidth && main.scrollWidth <= main.clientWidth
              && box.width > 0 && box.right <= window.innerWidth + 1;
            """
        )
        assert _section(driver).find_element(By.ID, "daily-history-symbol").is_displayed()
        assert _section(driver).find_element(By.XPATH, ".//button[normalize-space()='View history']").is_enabled()
        t._shot(driver, h._wait(driver).until(_chart), ARTIFACTS / "sma-mobile.png")
        t._css_viewport(driver, 1280, 800, False)

        Select(_section(driver).find_element(By.ID, "daily-history-indicator")).select_by_value("none")
        _frames(driver)
        none_draft = _starts(driver)
        assert none_draft == back and _indicator_cells(driver) == SMA3
        _view(driver)
        h._wait(driver).until(lambda current: "SMA (3)" not in _section(current).text and "2.333333" not in _section(current).text)
        h._wait(driver).until(_chart)
        _open_prices(driver)
        h._wait(driver).until(lambda current: _headers(current) == ["Session date", "Open", "High", "Low", "Close", "Volume"])
        after_none = _starts(driver)
        assert after_none["history"] == none_draft["history"] + 1 and after_none["indicators"] == none_draft["indicators"]

        Select(_section(driver).find_element(By.ID, "daily-history-indicator")).select_by_value("rsi")
        period = _section(driver).find_element(By.ID, "daily-history-period")
        period.clear()
        period.send_keys("3")
        rsi_draft = _starts(driver)
        _view(driver)
        _wait_prices(driver, RSI3, "RSI (3)")
        rsi = _starts(driver)
        assert rsi["history"] == after_none["history"] and rsi["indicators"] == rsi_draft["indicators"] + 1
        assert "Warm-up: the first 3 observed stored closes have no indicator value." in _section(driver).text
        t._shot(driver, h._wait(driver).until(_chart), ARTIFACTS / "rsi-desktop.png")

        _fill(driver, MISSING, "none", None)
        _view(driver)
        h._wait(driver).until(lambda current: "This symbol is not in the cached symbol list." in _section(current).text)
        h._wait(driver).until(lambda current: not _section(current).find_elements(By.TAG_NAME, "canvas") and not _section(current).find_elements(By.TAG_NAME, "table"))
        t._shot(driver, _section(driver).find_element(By.CSS_SELECTOR, "[role='alert']"), ARTIFACTS / "error.png")
        counts = _starts(driver)
        print(json.dumps({
            "check": "indicator overlay",
            "history_starts": counts["history"],
            "indicator_starts": counts["indicators"],
            "reconciled": before["reconciled"],
        }))
    finally:
        driver.quit()
    after = _books(disposable_api.engine, disposable_api.email)
    assert after["counts"] == before["counts"] and after["cash"] == before["cash"] and after["reconciled"] is True
