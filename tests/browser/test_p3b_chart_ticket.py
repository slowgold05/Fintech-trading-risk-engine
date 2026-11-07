"""Signed-out chart to signed-in empty-book limit ticket. Guarded disposable stack only."""

import json
import os
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from urllib.parse import urlsplit

import pytest

pytest.importorskip("selenium")

from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support import expected_conditions as EC
from sqlalchemy import select, text
from sqlalchemy.orm import Session

import test_p0b_acceptance as h
import test_p3a_history as p3a
import test_p3b_ticket as t
from app.models.asset import Asset
from app.models.market_bar_daily import MarketBarDaily
from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol

pytestmark = pytest.mark.skipif(os.environ.get("P0B_BROWSER") != "1", reason="Set P0B_BROWSER=1")
disposable_api = h.disposable_api
SYMBOL = "P3HANDOFF"
ARTIFACTS = h.REPO_ROOT / ".local-tools" / "p3b-chart-ticket"
LINK = "Trade this symbol"
_DETAIL_TEXT = ("Open with no quantity executed yet.", "No recorded fills.")
_DETAIL_VALUES = {
    "Original": "1.000000",
    "Filled": "0.000000",
    "Remaining": "1.000000",
    "Status": "open",
    "Limit": "100.000000 USD",
}


def _seed(engine) -> None:
    now = datetime.now(timezone.utc)
    sessions = [now.date() - timedelta(days=2), now.date() - timedelta(days=1)]
    quoted_at = now.replace(tzinfo=None)
    with Session(engine) as db:
        if db.execute(text("SELECT current_database()")).scalar() != h.DISPOSABLE_DATABASE:
            pytest.fail("refusing to seed outside the disposable browser database")
        item = db.get(MarketSymbol, SYMBOL)
        if item is None:
            item = MarketSymbol(symbol=SYMBOL, company_name="Chart handoff", exchange="NASDAQ")
            db.add(item)
        item.company_name, item.exchange, item.sector = "Chart handoff", "NASDAQ", "Technology"
        item.is_active, item.is_test, item.is_etf, item.refresh_tier = True, False, False, "hot"
        db.flush()
        asset = db.execute(select(Asset).where(Asset.symbol == SYMBOL)).scalar_one_or_none()
        if asset is None:
            db.add(Asset(symbol=SYMBOL, asset_type="stock", name="Chart handoff", is_active=True))
        else:
            asset.asset_type, asset.name, asset.is_active = "stock", "Chart handoff", True
        quote = db.get(MarketQuoteCache, SYMBOL)
        if quote is None:
            quote = MarketQuoteCache(symbol=SYMBOL)
            db.add(quote)
        quote.price, quote.change_amount, quote.change_percent = Decimal(100), 0, Decimal(0)
        quote.volume, quote.source, quote.quote_at, quote.fetched_at = 100, "fixture", quoted_at, quoted_at
        for adjustment, values in (
            ("raw", ("100", "110", "90", "105")),
            ("split_adjusted", ("50", "55", "45", "52.5")),
        ):
            for session in sessions:
                bar = db.get(MarketBarDaily, (SYMBOL, session, p3a.PROVIDER, adjustment))
                if bar is None:
                    bar = MarketBarDaily(
                        symbol=SYMBOL, session_date=session, provider=p3a.PROVIDER, adjustment_type=adjustment,
                    )
                    db.add(bar)
                bar.open, bar.high, bar.low, bar.close = map(Decimal, values)
                bar.volume, bar.quality_status = 0, "valid"
                bar.fetched_at = now - timedelta(minutes=1)
        db.commit()


def _link(driver):
    return next((node for node in driver.find_elements(By.LINK_TEXT, LINK) if node.is_displayed()), False)


def _query(link) -> str:
    return urlsplit(link.get_attribute("href") or "").query


def _symbol_only(query: str) -> bool:
    lowered = query.lower()
    banned = ("close", "price", "qty", "quantity", "provider", "adjustment", "105", "52.5")
    return query == f"symbol={SYMBOL}" and not any(word in lowered for word in banned)


def _fits(driver) -> bool:
    return bool(driver.execute_script(
        "const root=document.documentElement,main=document.querySelector('main');"
        "return !!main && root.scrollWidth<=root.clientWidth && main.scrollWidth<=main.clientWidth;"
    ))


def _watch_preview_bodies(driver) -> None:
    driver.execute_script(
        """
        if (window.__p3bPreviewWatch) { return; }
        window.__p3bPreviewWatch = true;
        window.__p3bPreviewBodies = [];
        const send = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function(body) {
          try {
            const parsed = JSON.parse(String(body || ""));
            const url = String(this.__p0b && this.__p0b.url || "");
            if (parsed && typeof parsed === "object" && url.includes("/orders/preview")) {
              window.__p3bPreviewBodies.push(parsed);
            }
          } catch (error) { /* non-JSON bodies are ignored */ }
          return send.apply(this, arguments);
        };
        """
    )


def _preview_bodies(driver) -> list:
    found = driver.execute_script("return window.__p3bPreviewBodies || [];")
    return found if isinstance(found, list) else []


def _symbol_order_count(engine) -> int:
    with engine.connect() as connection:
        if connection.execute(text("SELECT current_database()")).scalar() != h.DISPOSABLE_DATABASE:
            pytest.fail("refusing to read orders outside the disposable browser database")
        return int(connection.execute(
            text("SELECT COUNT(*) FROM orders WHERE symbol = :symbol"), {"symbol": SYMBOL},
        ).scalar() or 0)


def _owner_order(engine, email: str) -> dict | None:
    with engine.connect() as connection:
        if connection.execute(text("SELECT current_database()")).scalar() != h.DISPOSABLE_DATABASE:
            pytest.fail("refusing to read orders outside the disposable browser database")
        row = connection.execute(
            text(
                """
                SELECT o.id, o.status, o.quantity, o.remaining_quantity, o.limit_price, o.side, o.order_type
                FROM orders o JOIN users u ON u.id = o.user_id
                WHERE u.email = :email AND o.symbol = :symbol
                ORDER BY o.id
                """
            ),
            {"email": email, "symbol": SYMBOL},
        ).mappings().all()
    if len(row) != 1:
        return None
    item = row[0]
    return {
        "id": int(item["id"]),
        "status": str(item["status"]),
        "quantity": Decimal(item["quantity"]),
        "remaining": Decimal(item["remaining_quantity"]),
        "limit": Decimal(item["limit_price"]) if item["limit_price"] is not None else None,
        "side": str(item["side"]),
        "order_type": str(item["order_type"]),
    }


def _money(amount: Decimal) -> str:
    cents = amount.quantize(Decimal("0.01"))
    text_amount = f"{abs(cents):,.2f}"
    if text_amount.endswith(".00"):
        text_amount = text_amount[:-3]
    return ("-$" if cents < 0 else "$") + text_amount


def _detail_state(driver, order_id: int) -> dict | None:
    found = driver.execute_script(
        """
        const region = document.querySelector(`[aria-label="Order ${arguments[0]} details"]`);
        if (!region) { return null; }
        const own = (node) => Array.from(node.childNodes).filter((child) => child.nodeType === Node.TEXT_NODE)
          .map((child) => child.textContent).join(" ").replace(/\\s+/g, " ").trim();
        const fields = {};
        for (const dt of region.querySelectorAll("dt")) {
          const label = own(dt);
          const dd = dt.nextElementSibling;
          if (label && dd && dd.tagName === "DD") { fields[label] = (dd.textContent || "").replace(/\\s+/g, " ").trim(); }
        }
        return {text: (region.innerText || "").replace(/\\s+/g, " ").trim(), fields: fields};
        """,
        order_id,
    )
    return found if isinstance(found, dict) else None


def _details_match(driver, order_id: int):
    state = _detail_state(driver, order_id)
    if not state:
        return False
    fields = state.get("fields") or {}
    text = state.get("text") or ""
    if any(fields.get(key) != value for key, value in _DETAIL_VALUES.items()):
        return False
    if any(phrase not in text for phrase in _DETAIL_TEXT):
        return False
    return state


def _spa(driver, href: str):
    link = h._wait(driver).until(lambda current: next((
        node for node in current.find_elements(By.CSS_SELECTOR, f"a[href='{href}']") if node.is_displayed()
    ), False))
    h._click(driver, link)
    return link


def _capture_chart(driver, chart_path, link_path) -> None:
    if not _fits(driver):
        pytest.fail("chart viewport overflowed root or main")
    t._shot(driver, h._wait(driver).until(p3a._plot), chart_path)
    link = h._wait(driver).until(_link)
    if not _symbol_only(_query(link)):
        pytest.fail("trade link query was not the symbol alone")
    t._shot(driver, link, link_path)


def test_chart_to_ticket_handoff(disposable_api) -> None:
    password = os.environ.get("P0B_TRADER_PASSWORD", "")
    if not password:
        pytest.fail("P0B_TRADER_PASSWORD is required")
    _seed(disposable_api.engine)
    if _symbol_order_count(disposable_api.engine) != 0:
        pytest.fail("symbol already has an order on the disposable book")
    email, engine, web = disposable_api.email, disposable_api.engine, disposable_api.web_url
    cash_before = t._cash(engine, email)
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    driver = h._driver()
    try:
        t._css_viewport(driver, 1280, 800, False)
        driver.get(web + "/market")
        h._wait(driver).until(lambda current: current.find_elements(By.CSS_SELECTOR, "#daily-history-series option[value]:not([value=''])"))
        p3a._submit(driver, SYMBOL)
        h._wait(driver).until(p3a._plot)
        link = h._wait(driver).until(_link)
        if not _symbol_only(_query(link)):
            pytest.fail("trade link query was not the symbol alone")
        _capture_chart(driver, ARTIFACTS / "chart-desktop.png", ARTIFACTS / "chart-desktop-link.png")

        symbol_field = driver.find_element(By.ID, "daily-history-symbol")
        symbol_field.clear()
        symbol_field.send_keys("P3DRAFT")
        h._wait(driver).until(lambda current: "unsent changes" in p3a._section(current).text and _symbol_only(_query(_link(current))))
        symbol_field.clear()
        symbol_field.send_keys(SYMBOL)
        h._wait(driver).until(lambda current: "unsent changes" not in p3a._section(current).text and _symbol_only(_query(_link(current))))

        t._css_viewport(driver, 390, 844, True)
        _capture_chart(driver, ARTIFACTS / "chart-mobile.png", ARTIFACTS / "chart-mobile-link.png")
        t._css_viewport(driver, 1280, 800, False)

        before_login = h._owner_activity_counts(engine, email)
        h._click(driver, h._wait(driver).until(_link))
        h._wait(driver).until(EC.url_contains("/login"))
        h._wait(driver).until(EC.presence_of_element_located((By.CSS_SELECTOR, "input[aria-label='Email']")))
        driver.find_element(By.CSS_SELECTOR, "input[aria-label='Email']").send_keys(email)
        driver.find_element(By.CSS_SELECTOR, "input[aria-label='Password']").send_keys(password)
        driver.find_element(By.CSS_SELECTOR, "button[aria-label='Sign in']").click()
        h._wait(driver).until(EC.url_contains(f"/trades?symbol={SYMBOL}"))
        h._wait(driver).until(EC.presence_of_element_located((By.CSS_SELECTOR, "input[aria-label='Trade symbol']")))
        h._install_order_hook(driver, disposable_api.api_url)
        _watch_preview_bodies(driver)
        if h._order_summary(driver) or _preview_bodies(driver):
            pytest.fail("ticket posted before entry")
        after_login = h._owner_activity_counts(engine, email)
        if after_login != before_login:
            pytest.fail("owner activity changed across sign-in: " + json.dumps({"before": before_login, "after": after_login}))
        symbol_box = driver.find_element(By.CSS_SELECTOR, "input[aria-label='Trade symbol']")
        quantity = driver.find_element(By.CSS_SELECTOR, "input[aria-label='Trade quantity']")
        limit = driver.find_element(By.CSS_SELECTOR, "input[aria-label='Limit price']")
        if symbol_box.get_attribute("value") != SYMBOL or quantity.get_attribute("value") or limit.get_attribute("value"):
            pytest.fail("ticket was not limited to the symbol seed")
        if t._shown(driver, "button[aria-label='Confirm paper order']"):
            pytest.fail("blank ticket offered confirm")
        if not _fits(driver):
            pytest.fail("ticket desktop overflowed root or main")
        t._shot(driver, symbol_box, ARTIFACTS / "ticket-desktop.png")
        t._css_viewport(driver, 390, 844, True)
        h._wait(driver).until(lambda current: _fits(current) and current.find_element(By.CSS_SELECTOR, "input[aria-label='Trade symbol']").get_attribute("value") == SYMBOL)
        t._shot(driver, driver.find_element(By.CSS_SELECTOR, "input[aria-label='Trade symbol']"), ARTIFACTS / "ticket-mobile.png")
        t._css_viewport(driver, 1280, 800, False)
        if h._order_summary(driver) or _preview_bodies(driver):
            pytest.fail("blank ticket previewed itself")

        quantity = driver.find_element(By.CSS_SELECTOR, "input[aria-label='Trade quantity']")
        limit = driver.find_element(By.CSS_SELECTOR, "input[aria-label='Limit price']")
        quantity.send_keys("1")
        limit.send_keys("100")
        t._click_preview(driver)
        h._wait(driver).until(h._order_preview_ready)
        bodies = _preview_bodies(driver)
        if len(bodies) != 1:
            pytest.fail("preview capture mismatch: " + json.dumps({"count": len(bodies)}))
        body = bodies[0]
        allowed = {"symbol", "side", "order_type", "quantity", "limit_price"}
        if set(body) - allowed or body.get("symbol") != SYMBOL or body.get("side") != "buy" or body.get("order_type") != "limit":
            pytest.fail("preview payload keys mismatched")
        if Decimal(str(body.get("quantity"))) != Decimal(1) or Decimal(str(body.get("limit_price"))) != Decimal(100):
            pytest.fail("preview payload quantity or limit mismatched")
        encoded = json.dumps(body)
        if "105" in encoded or "52.5" in encoded or "52.50" in encoded:
            pytest.fail("preview payload included a historical close")
        if h._order_summary(driver) or h._owner_activity_counts(engine, email) != before_login:
            pytest.fail("preview wrote order activity")
        if t._cash(engine, email) != cash_before:
            pytest.fail("cash changed before confirm")

        confirm = h._wait(driver).until(EC.visibility_of_element_located((By.CSS_SELECTOR, "button[aria-label='Confirm paper order']")))
        driver.execute_script("arguments[0].focus();", confirm)
        h._wait(driver).until(lambda current: current.switch_to.active_element.get_attribute("aria-label") == "Confirm paper order")
        driver.switch_to.active_element.send_keys(Keys.ENTER)
        summary = h._wait(driver).until(lambda current: h._order_summary(current) if len(h._order_summary(current)) == 1 else False)
        if summary[0]["status"] != 200 or summary[0]["orderStatus"] != "open":
            pytest.fail("order capture mismatch: " + json.dumps({"status": summary[0]["status"], "order_status": summary[0]["orderStatus"]}))
        opened = h._wait(driver).until(lambda current: _owner_order(engine, email) if (_owner_order(engine, email) or {}).get("status") == "open" else False)
        if opened["quantity"] != Decimal(1) or opened["remaining"] != Decimal(1) or opened["limit"] != Decimal(100) or opened["side"] != "buy":
            pytest.fail("resting order quantity or limit mismatched")
        if _symbol_order_count(engine) != 1:
            pytest.fail("symbol book was not a single resting order")
        counts = h._owner_activity_counts(engine, email)
        if counts["orders"] != before_login["orders"] + 1 or counts["order_requests"] != before_login["order_requests"] + 1:
            pytest.fail("order activity mismatch: " + json.dumps(counts))
        if counts["trades"] != before_login["trades"] or counts["holdings"] != before_login["holdings"] or counts["lots"] != before_login["lots"]:
            pytest.fail("resting limit created a fill: " + json.dumps(counts))
        if t._cash(engine, email) != cash_before:
            pytest.fail("cash changed for the resting limit")
        _spa(driver, "/dashboard")
        h._wait(driver).until(lambda current: h._money_after(current, "Cash") == _money(cash_before) and h._money_after(current, "Buying power") == _money(cash_before - Decimal(100)))
        _spa(driver, "/trades")
        h._wait(driver).until(EC.presence_of_element_located((By.CSS_SELECTOR, f"button[aria-label='Details for {SYMBOL} order {opened['id']}']")))
        details = driver.find_element(By.CSS_SELECTOR, f"button[aria-label='Details for {SYMBOL} order {opened['id']}']")
        driver.execute_script("arguments[0].focus();", details)
        h._wait(driver).until(lambda current: current.switch_to.active_element.get_attribute("aria-label") == f"Details for {SYMBOL} order {opened['id']}")
        driver.switch_to.active_element.send_keys(Keys.ENTER)
        state = h._wait(driver).until(lambda current: _details_match(current, opened["id"]))
        fields = state.get("fields") or {}
        if any(fields.get(key) != value for key, value in _DETAIL_VALUES.items()):
            pytest.fail("order detail fields mismatched: " + json.dumps({"keys": sorted(fields)}))
        if any(phrase not in (state.get("text") or "") for phrase in _DETAIL_TEXT):
            pytest.fail("order detail copy mismatched")
        region = driver.find_element(By.CSS_SELECTOR, f"[aria-label='Order {opened['id']} details']")
        t._shot(driver, region, ARTIFACTS / "order-detail.png")
        h._click(driver, driver.find_element(By.CSS_SELECTOR, f"button[aria-label='Cancel {SYMBOL} order {opened['id']}']"))
        h._wait(driver).until(lambda current: (_owner_order(engine, email) or {}).get("status") == "canceled")
        if t._cash(engine, email) != cash_before:
            pytest.fail("cash changed after cancel")
        _spa(driver, "/dashboard")
        h._wait(driver).until(lambda current: h._money_after(current, "Cash") == _money(cash_before) and h._money_after(current, "Buying power") == _money(cash_before))
        print(json.dumps({
            "check": "chart ticket handoff",
            "link": "symbol-only",
            "preview_status": "eligible",
            "order_status": "canceled",
            "counts": counts,
            "fills": 0,
        }, sort_keys=True))
    finally:
        try:
            driver.execute_cdp_cmd("Network.setBlockedURLs", {"urls": []})
        except Exception:
            pass
        driver.quit()
