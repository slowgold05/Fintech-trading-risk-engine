"""Headless private watchlists on the disposable browser stack.

Skipped unless P0B_BROWSER=1. Mutations use the fixture account and one fresh
designated account. The live database name is checked before any seed or read.
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

pytest.importorskip("selenium")

from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
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
ONE, TWO = "P3WLONE", "P3WLTWO"
NAME, RENAMED = "Desk private", "Desk renamed"
ARTIFACTS = h.REPO_ROOT / ".local-tools" / "p3b-watchlists-ui"


def _seed(engine) -> None:
    database = None
    try:
        with Session(engine) as db:
            database = db.execute(text("SELECT current_database()")).scalar()
            if database == h.DISPOSABLE_DATABASE:
                for symbol, company in ((ONE, "Watch one"), (TWO, "Watch two")):
                    item = db.get(MarketSymbol, symbol)
                    if item is None:
                        item = MarketSymbol(symbol=symbol, company_name=company, exchange="NASDAQ")
                        db.add(item)
                    item.company_name, item.exchange, item.sector = company, "NASDAQ", "Technology"
                    item.is_etf, item.is_test, item.is_active = False, False, True
                    item.refresh_tier, item.heatmap_size, item.source = "daily", "micro", "nasdaq_trader"
                db.flush()
                now = datetime.now(timezone.utc)
                session = now.date() - timedelta(days=2)
                provider = "fixture-watchlists-ui"
                bar = db.get(MarketBarDaily, (ONE, session, provider, "raw"))
                if bar is None:
                    bar = MarketBarDaily(symbol=ONE, session_date=session, provider=provider, adjustment_type="raw")
                    db.add(bar)
                bar.open, bar.high, bar.low, bar.close = map(Decimal, ("100", "110", "90", "105"))
                bar.volume, bar.quality_status = 0, "valid"
                bar.fetched_at = now - timedelta(minutes=1)
                db.commit()
    except Exception:
        pytest.fail("market symbol seed failed")
    if database != h.DISPOSABLE_DATABASE:
        pytest.fail("refusing to seed outside the disposable browser database")


def _owned(engine, email: str):
    database, rows, orphans = None, [], None
    try:
        with engine.connect() as connection:
            database = connection.execute(text("SELECT current_database()")).scalar()
            if database == h.DISPOSABLE_DATABASE:
                rows = connection.execute(text(
                    """
                    SELECT w.name, i.symbol, i.position
                    FROM watchlists w
                    JOIN users u ON u.id = w.user_id
                    LEFT JOIN watchlist_items i ON i.watchlist_id = w.id
                    WHERE u.email = :email
                    ORDER BY w.name, i.position, i.symbol
                    """
                ), {"email": email}).all()
                orphans = connection.execute(text(
                    """
                    SELECT COUNT(*) FROM watchlist_items i
                    LEFT JOIN watchlists w ON w.id = i.watchlist_id
                    WHERE w.id IS NULL
                    """
                )).scalar()
    except Exception:
        pytest.fail("watchlist read failed")
    if database != h.DISPOSABLE_DATABASE:
        pytest.fail("refusing to read watchlists outside the disposable browser database")
    return [(name, symbol, int(position) if position is not None else None) for name, symbol, position in rows], int(orphans or 0)


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
    return driver.find_element(By.CSS_SELECTOR, "section[aria-labelledby='watchlists-title']")


def _hits(driver, part: str) -> int:
    return int(driver.execute_script(
        "const part = arguments[0]; return performance.getEntriesByType('resource').filter((entry) => entry.name.includes(part) && entry.responseEnd > 0).length;",
        part,
    ))


def _shown_button(driver, label: str):
    return next(node for node in driver.find_elements(By.XPATH, f"//button[normalize-space()='{label}']") if node.is_displayed())


def _type_id(driver, field_id: str, value: str) -> None:
    field = driver.find_element(By.ID, field_id)
    field.clear()
    field.send_keys(value)


def _status(driver, phrase: str) -> None:
    def ready(current) -> bool:
        noticed = any(node.is_displayed() and phrase in node.text for node in current.find_elements(By.CSS_SELECTOR, "[role='status']"))
        create = current.find_elements(By.ID, "watchlist-create-name")
        return noticed and any(node.is_displayed() and node.is_enabled() for node in create)

    h._wait(driver).until(ready)


def _symbols(driver) -> list[str]:
    return [node.text.strip() for node in _section(driver).find_elements(By.CSS_SELECTOR, "li span.font-mono")]


def _choose(driver, name: str) -> None:
    Select(driver.find_element(By.ID, "watchlist-select")).select_by_visible_text(name)
    h._wait(driver).until(lambda current: (
        current.find_elements(By.ID, "watchlist-rename")
        and Select(current.find_element(By.ID, "watchlist-select")).first_selected_option.text.strip() == name
    ))


def _market(driver) -> None:
    link = next(node for node in driver.find_elements(By.CSS_SELECTOR, "a[href='/market']") if node.is_displayed() and node.text.strip() == "Market")
    h._click(driver, link)
    h._wait(driver).until(EC.url_contains("/market"))
    h._wait(driver).until(lambda current: current.find_elements(By.ID, "watchlists-title"))
    h._wait(driver).until(lambda current: "Loading watchlists." not in _section(current).text and "Loading your account." not in _section(current).text)


def _login_here(driver, email: str, password: str) -> None:
    h._wait(driver).until(EC.presence_of_element_located((By.CSS_SELECTOR, "input[aria-label='Email']")))
    email_box = driver.find_element(By.CSS_SELECTOR, "input[aria-label='Email']")
    email_box.clear()
    email_box.send_keys(email)
    password_box = driver.find_element(By.CSS_SELECTOR, "input[aria-label='Password']")
    password_box.clear()
    password_box.send_keys(password)
    h._click(driver, driver.find_element(By.CSS_SELECTOR, "button[aria-label='Sign in']"))
    h._wait(driver).until(EC.url_contains("/dashboard"))


def _sign_out(driver) -> None:
    dashboards = [node for node in driver.find_elements(By.PARTIAL_LINK_TEXT, "Open dashboard") if node.is_displayed()]
    if dashboards:
        h._click(driver, dashboards[0])
        h._wait(driver).until(EC.url_contains("/dashboard"))
    button = next(node for node in driver.find_elements(By.XPATH, "//button[normalize-space()='Sign out']") if node.is_displayed())
    logout_before = _hits(driver, "/auth/logout")
    h._click(driver, button)
    h._wait(driver).until(EC.url_contains("/login"))
    h._wait(driver).until(lambda current: _hits(current, "/auth/logout") > logout_before)
    h._wait(driver).until(EC.presence_of_element_located((By.CSS_SELECTOR, "input[aria-label='Email']")))


def _arm_handoff(driver) -> None:
    driver.execute_script(
        """
        if (window.__p3wHandoff) { return; }
        window.__p3wHandoff = [];
        const origOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url) {
          try {
            const path = new URL(String(url), window.location.origin).pathname;
            if (path.includes("/market/research") || path.includes("/history")) {
              window.__p3wHandoff.push(path);
            }
          } catch (error) { /* ignore non-URL open targets */ }
          return origOpen.apply(this, arguments);
        };
        """
    )


def _handoff_quiet(driver) -> None:
    driver.execute_script(
        "return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))));"
    )
    sent = driver.execute_script("return window.__p3wHandoff || [];")
    if sent:
        pytest.fail("symbol handoff sent research or history: " + json.dumps({"paths": sent}))


def _fits(driver) -> bool:
    return bool(driver.execute_script(
        "const root = document.documentElement, main = document.querySelector('main'); return !!main && root.scrollWidth <= root.clientWidth && main.scrollWidth <= main.clientWidth;"
    ))


def test_private_watchlists_ui(disposable_api) -> None:
    password = os.environ.get("P0B_TRADER_PASSWORD", "")
    if not password:
        pytest.fail("P0B_TRADER_PASSWORD is required")
    engine, account = disposable_api.engine, disposable_api.email
    _seed(engine)
    other = f"p3wl-other+{uuid.uuid4().hex}@example.com"
    if len(other.split("@", 1)[0]) >= 64:
        pytest.fail("designated second account local part is too long")
    h._register(other, password)
    opened = _books(engine, account)
    if not opened["reconciled"]:
        pytest.fail("opening ledger did not reconcile")
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    driver, blocked = h._driver(), False
    try:
        t._css_viewport(driver, 1280, 800, False)
        driver.get(disposable_api.web_url + "/market")
        h._wait(driver).until(lambda current: "Sign in to keep watchlists" in _section(current).text)
        private_calls = _hits(driver, "/watchlists") + _hits(driver, "/auth/me")
        if private_calls:
            pytest.fail("signed-out market called private endpoints: " + json.dumps({"count": private_calls}))
        t._shot(driver, driver.find_element(By.ID, "watchlists-title"), ARTIFACTS / "public.png")
        h._sign_in(driver, disposable_api.web_url, account, password)
        _market(driver)
        h._wait(driver).until(lambda current: "No watchlists yet." in _section(current).text)
        _type_id(driver, "watchlist-create-name", NAME)
        h._click(driver, _shown_button(driver, "Create watchlist"))
        _status(driver, "Watchlist created.")
        for symbol in (ONE, TWO):
            _type_id(driver, "watchlist-symbol", symbol)
            h._click(driver, _shown_button(driver, "Add symbol"))
            _status(driver, "Symbol saved.")
        h._click(driver, driver.find_element(By.CSS_SELECTOR, f"button[aria-label='Move {ONE} down']"))
        _status(driver, "Symbol order saved.")
        rows, orphans = _owned(engine, account)
        if rows != [(NAME, TWO, 1), (NAME, ONE, 2)] or orphans:
            pytest.fail("saved order mismatch: " + json.dumps({"symbols": [row[1] for row in rows], "orphans": orphans}))
        driver.refresh()
        h._wait(driver).until(lambda current: current.find_elements(By.ID, "watchlist-select"))
        if Select(driver.find_element(By.ID, "watchlist-select")).first_selected_option.get_attribute("value"):
            pytest.fail("reloaded watchlist select did not show the placeholder")
        _choose(driver, NAME)
        if _symbols(driver) != [TWO, ONE]:
            pytest.fail("reloaded order mismatch: " + json.dumps({"symbols": _symbols(driver)}))
        t._shot(driver, driver.find_element(By.ID, "watchlist-select"), ARTIFACTS / "persisted.png")
        _type_id(driver, "watchlist-rename", RENAMED)
        h._click(driver, _shown_button(driver, "Save name"))
        _status(driver, "Watchlist renamed.")
        h._click(driver, driver.find_element(By.CSS_SELECTOR, f"button[aria-label='Remove {TWO}']"))
        _status(driver, "Symbol removed.")
        rows, orphans = _owned(engine, account)
        if rows != [(RENAMED, ONE, 2)] or orphans:
            pytest.fail("renamed member mismatch: " + json.dumps({"symbols": [row[1] for row in rows], "kept": len(rows), "orphans": orphans}))
        if not _fits(driver):
            pytest.fail("desktop market overflowed the viewport")
        row = driver.find_element(By.XPATH, f"//section[@aria-labelledby='watchlists-title']//li[.//span[normalize-space()='{ONE}']]")
        t._shot(driver, row, ARTIFACTS / "lists-desktop.png")
        t._css_viewport(driver, 390, 844, True)
        h._wait(driver).until(lambda current: _fits(current) and _symbols(current) == [ONE])
        t._shot(driver, driver.find_element(By.XPATH, f"//section[@aria-labelledby='watchlists-title']//li[.//span[normalize-space()='{ONE}']]"), ARTIFACTS / "lists-mobile.png")
        t._css_viewport(driver, 1280, 800, False)
        h._wait(driver).until(lambda current: current.find_elements(By.ID, "research-symbol") and current.find_elements(By.ID, "daily-history-symbol"))
        research_before, history_before = _hits(driver, "/market/research"), _hits(driver, "/history")
        _arm_handoff(driver)
        h._click(driver, _shown_button(driver, "Use in research"))
        h._wait(driver).until(lambda current: current.find_element(By.ID, "research-symbol").get_attribute("value") == ONE and current.switch_to.active_element.get_attribute("id") == "research-symbol")
        _handoff_quiet(driver)
        driver.execute_script("document.getElementById('daily-history-symbol').dataset.p3wNode = 'stay';")
        _type_id(driver, "daily-history-symbol", "DRAFT")
        h._click(driver, _shown_button(driver, "Use in chart"))
        h._wait(driver).until(lambda current: current.find_element(By.ID, "daily-history-symbol").get_attribute("value") == ONE and current.switch_to.active_element.get_attribute("id") == "daily-history-symbol")
        _handoff_quiet(driver)
        _type_id(driver, "daily-history-symbol", "AGAIN")
        h._click(driver, _shown_button(driver, "Use in chart"))
        h._wait(driver).until(lambda current: current.find_element(By.ID, "daily-history-symbol").get_attribute("value") == ONE and current.find_element(By.ID, "daily-history-symbol").get_attribute("data-p3w-node") == "stay")
        _handoff_quiet(driver)
        if _hits(driver, "/market/research") != research_before or _hits(driver, "/history") != history_before:
            pytest.fail("completed research or history entries changed: " + json.dumps({"research": _hits(driver, "/market/research"), "history": _hits(driver, "/history")}))
        trade = driver.find_element(By.CSS_SELECTOR, f"a[aria-label='Trade {ONE}']")
        href = trade.get_attribute("href") or ""
        if not href.endswith(f"/trades?symbol={ONE}") or any(part in href.lower() for part in ("price", "qty", "quantity")):
            pytest.fail("trade link was not symbol-only")
        driver.execute_cdp_cmd("Network.enable", {})
        driver.execute_cdp_cmd("Network.setBlockedURLs", {"urls": ["*alphavantage*", "*yahoo*", "*polygon*", "*/market/research*", "*/history*"]})
        blocked = True
        driver.execute_script("window.__p3wStay = 1;")
        h._click(driver, next(node for node in driver.find_elements(By.PARTIAL_LINK_TEXT, "Open dashboard") if node.is_displayed()))
        h._wait(driver).until(EC.url_contains("/dashboard"))
        _sign_out(driver)
        _login_here(driver, other, password)
        _market(driver)
        if driver.execute_script("return window.__p3wStay;") != 1:
            pytest.fail("cross-account navigation reloaded the document")
        h._wait(driver).until(lambda current: "No watchlists yet." in _section(current).text)
        private = _section(driver).text
        if RENAMED in private or NAME in private or ONE in private or TWO in private:
            pytest.fail("second account private section showed the first account watchlist")
        kept, _ = _owned(engine, account)
        other_rows, _ = _owned(engine, other)
        if kept != [(RENAMED, ONE, 2)] or other_rows:
            pytest.fail("owner separation mismatch: " + json.dumps({"kept": len(kept), "other": len(other_rows)}))
        t._shot(driver, driver.find_element(By.CSS_SELECTOR, "section[aria-labelledby='watchlists-title'] [role='status']"), ARTIFACTS / "second-owner-empty.png")
        _sign_out(driver)
        _login_here(driver, account, password)
        _market(driver)
        if driver.execute_script("return window.__p3wStay;") != 1:
            pytest.fail("return navigation reloaded the document")
        _choose(driver, RENAMED)
        if _symbols(driver) != [ONE]:
            pytest.fail("returned list mismatch: " + json.dumps({"symbols": _symbols(driver)}))
        h._click(driver, _shown_button(driver, "Delete"))
        h._wait(driver).until(lambda current: current.find_elements(By.CSS_SELECTOR, "[aria-label='Confirm watchlist delete']"))
        h._click(driver, _shown_button(driver, "Cancel"))
        h._wait(driver).until(lambda current: _symbols(current) == [ONE] and current.find_elements(By.XPATH, "//button[normalize-space()='Delete']"))
        still, _ = _owned(engine, account)
        if still != [(RENAMED, ONE, 2)]:
            pytest.fail("cancel removed the watchlist")
        h._click(driver, _shown_button(driver, "Delete"))
        h._click(driver, _shown_button(driver, "Delete watchlist"))
        _status(driver, "Watchlist deleted.")
        h._wait(driver).until(lambda current: "No watchlists yet." in _section(current).text)
        gone, orphans = _owned(engine, account)
        if gone or orphans:
            pytest.fail("delete left watchlist rows: " + json.dumps({"lists": len(gone), "orphans": orphans}))
        t._shot(driver, driver.find_element(By.CSS_SELECTOR, "section[aria-labelledby='watchlists-title'] [role='status']"), ARTIFACTS / "deleted.png")
        closed = _books(engine, account)
        if closed != opened:
            pytest.fail("financial activity changed: " + json.dumps({"before": opened["counts"], "after": closed["counts"], "cash_same": opened["cash"] == closed["cash"], "reconciled": closed["reconciled"]}))
        print(json.dumps({"symbols": [ONE, TWO], "counts": closed["counts"], "cash": closed["cash"], "reconciled": closed["reconciled"], "orphans": orphans, "other_lists": len(other_rows)}))
    finally:
        if blocked:
            try:
                driver.execute_cdp_cmd("Network.setBlockedURLs", {"urls": []})
            except Exception:
                pass
        driver.quit()
