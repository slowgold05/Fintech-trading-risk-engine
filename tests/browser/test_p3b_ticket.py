"""Empty-book market ticket on the guarded, provider-blocked local stack."""

import json
import os
from datetime import datetime, timezone
from decimal import Decimal

import pytest

pytest.importorskip("selenium")

from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import Select
from sqlalchemy import select, text
from sqlalchemy.orm import Session

import test_p0b_acceptance as h
from app.models.asset import Asset
from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol

pytestmark = pytest.mark.skipif(os.environ.get("P0B_BROWSER") != "1", reason="Set P0B_BROWSER=1")
disposable_api = h.disposable_api
SYMBOL, ARTIFACTS = "P3BTICKET", h.REPO_ROOT / ".local-tools" / "p3b-ticket"
_HEADER_OFFSET = """
const offset = Array.from(document.querySelectorAll('header')).reduce((max, bar) => {
  if (bar.closest('aside, nav, thead')) { return max; }
  const style = getComputedStyle(bar);
  const box = bar.getBoundingClientRect();
  const pinned = (style.position === 'sticky' || style.position === 'fixed')
    && box.width > 0 && box.height > 0 && box.bottom > 0 && box.top <= 0;
  return pinned ? Math.max(max, box.bottom) : max;
}, 0);
"""


def _seed(engine) -> None:
    quoted_at = datetime.now(timezone.utc).replace(tzinfo=None)
    with Session(engine) as db:
        if db.execute(text("SELECT current_database()")).scalar() != h.DISPOSABLE_DATABASE:
            pytest.fail("refusing to seed outside the disposable browser database")
        item = db.get(MarketSymbol, SYMBOL)
        if item is None:
            item = MarketSymbol(symbol=SYMBOL, company_name="Ticket fixture", exchange="NASDAQ")
            db.add(item)
        item.company_name, item.exchange, item.sector = "Ticket fixture", "NASDAQ", "Technology"
        item.is_active, item.is_test, item.is_etf, item.refresh_tier = True, False, False, "hot"
        db.flush()
        asset = db.execute(select(Asset).where(Asset.symbol == SYMBOL)).scalar_one_or_none()
        if asset is None:
            db.add(Asset(symbol=SYMBOL, asset_type="stock", name="Ticket fixture", is_active=True))
        else:
            asset.asset_type, asset.name, asset.is_active = "stock", "Ticket fixture", True
        quote = db.get(MarketQuoteCache, SYMBOL)
        if quote is None:
            quote = MarketQuoteCache(symbol=SYMBOL)
            db.add(quote)
        quote.price, quote.change_amount, quote.change_percent = Decimal(100), 0, Decimal(0)
        quote.volume, quote.source, quote.quote_at, quote.fetched_at = 100, "fixture", quoted_at, quoted_at
        db.commit()


_ESTIMATES = ("Initial reservation", "Estimated fill quantity", "Estimated fill notional", "Unfilled quantity")


def _shown(driver, selector: str) -> bool:
    return any(node.is_displayed() for node in driver.find_elements(By.CSS_SELECTOR, selector))


def _ready(driver, quantity: str) -> bool:
    return _shown(driver, "button[aria-label='Confirm paper order']") and h._preview_has_values(driver, {
        "Initial reservation": "0.00",
        "Estimated fill quantity": "0.000000",
        "Estimated fill notional": "0.00",
        "Unfilled quantity": f"{quantity}.000000",
    })


def _cleared(driver) -> bool:
    if _shown(driver, "button[aria-label='Confirm paper order']"):
        return False
    fields = h._preview_fields(driver)
    if fields is None:
        return True
    if fields["ready"]:
        return False
    return not any(fields["values"].get(label) for label in _ESTIMATES)


def _click_preview(driver) -> None:
    buttons = [node for node in driver.find_elements(By.CSS_SELECTOR, "button[aria-label='Preview order']") if node.is_displayed() and node.is_enabled()]
    if not buttons:
        buttons = [node for node in driver.find_elements(By.XPATH, "//button[normalize-space()='Retry' or normalize-space()='Retry preview']") if node.is_displayed()]
    if not buttons:
        pytest.fail("preview retry control was not available")
    h._click(driver, buttons[0])


def _shot_geometry(driver, element) -> dict:
    try:
        geometry = driver.execute_script(
            _HEADER_OFFSET + """
            const box = arguments[0].getBoundingClientRect();
            const main = document.querySelector('main');
            return {
              offset: offset, innerWidth: window.innerWidth, innerHeight: window.innerHeight,
              width: box.width, height: box.height, top: box.top, right: box.right, bottom: box.bottom, left: box.left,
              mainClientHeight: main ? main.clientHeight : null, mainScrollTop: main ? main.scrollTop : null,
            };
            """,
            element,
        )
    except Exception:
        return {"geometry": "unavailable"}
    return geometry if isinstance(geometry, dict) else {"geometry": "unavailable"}


def _shot(driver, element, path) -> None:
    driver.execute_script(
        """
        arguments[0].scrollIntoView({block: 'center', inline: 'nearest', behavior: 'instant'});
        """ + _HEADER_OFFSET + """
        const box = arguments[0].getBoundingClientRect();
        if (box.top < offset) {
          const main = document.querySelector('main');
          const delta = box.top - offset - 8;
          if (main && main.scrollHeight > main.clientHeight) { main.scrollBy(0, delta); }
          else { window.scrollBy(0, delta); }
        }
        """,
        element,
    )
    try:
        h._wait(driver).until(lambda current: current.execute_script(
            _HEADER_OFFSET + """
            const box = arguments[0].getBoundingClientRect();
            return box.width > 0 && box.height > 0 && box.top >= offset - 1 && box.bottom <= innerHeight
              && box.left >= 0 && box.right <= innerWidth;
            """,
            element,
        ))
    except Exception:
        fail_path = path.with_name(path.stem + "-fail.png")
        try:
            driver.save_screenshot(str(fail_path))
        except Exception:
            fail_path = None
        pytest.fail("shot target was not fully visible: " + json.dumps({
            "shot": path.name,
            "failure_shot": None if fail_path is None else fail_path.name,
            "geometry": _shot_geometry(driver, element),
        }))
    driver.save_screenshot(str(path))


def _css_viewport(driver, width: int, height: int, mobile: bool) -> dict:
    driver.set_window_size(width, height)
    driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": width, "height": height, "deviceScaleFactor": 1, "mobile": mobile})
    h._wait(driver).until(lambda current: h._viewport(current) == {"width": width, "height": height})
    return h._viewport(driver)


def _preview_http(driver) -> list:
    return driver.execute_script(
        "return (window.__p0bOrders || []).filter((item) => item.kind !== 'create').map((item) => ({status: item.status, orderStatus: item.orderStatus}));"
    )


def _enter_confirm(driver) -> None:
    confirm = h._wait(driver).until(lambda current: next((
        node for node in current.find_elements(By.CSS_SELECTOR, "button[aria-label='Confirm paper order']") if node.is_displayed()
    ), False))
    driver.execute_script("arguments[0].focus();", confirm)
    h._wait(driver).until(lambda current: current.switch_to.active_element.get_attribute("aria-label") == "Confirm paper order")
    driver.switch_to.active_element.send_keys(Keys.ENTER)


def _preview_root_has(driver, phrase: str) -> bool:
    return bool(driver.execute_script(
        """
        const phrase = arguments[0];
        const heading = Array.from(document.querySelectorAll("h3")).find((node) => node.textContent.trim() === "Order preview");
        const root = heading && (heading.closest("section, form") || heading.parentElement);
        return Boolean(root && (root.innerText || "").includes(phrase));
        """,
        phrase,
    ))


def _sell_reason_node(driver):
    return driver.execute_script(
        """
        const phrase = "Not enough holdings to sell";
        const heading = Array.from(document.querySelectorAll("h3")).find((node) => node.textContent.trim() === "Order preview");
        const root = heading && (heading.closest("section, form") || heading.parentElement);
        if (!root) { return null; }
        return Array.from(root.querySelectorAll("*")).find((node) =>
          node.childElementCount === 0 && (node.textContent || "").includes(phrase)
        ) || null;
        """
    ) or False


def _sell_blocked(driver, prior: int) -> bool:
    if _shown(driver, "button[aria-label='Confirm paper order']"):
        return False
    posts = _preview_http(driver)
    latest = posts[-1] if len(posts) > prior else None
    return bool(
        latest and latest["status"] == 200 and latest["orderStatus"] == "blocked"
        and _preview_root_has(driver, "Not enough holdings to sell")
    )


def _canceled_surface(driver):
    """Order canceled on a status message or the Your Orders row, without a Filled claim."""
    return driver.execute_script(
        """
        const symbol = arguments[0];
        const surfaces = Array.from(document.querySelectorAll("[role='status']"));
        const orders = Array.from(document.querySelectorAll("section")).find((section) =>
          Array.from(section.querySelectorAll("h2, h3")).some((heading) => heading.textContent.trim() === "Your Orders")
        );
        const row = orders && Array.from(orders.querySelectorAll("tr")).find((candidate) =>
          candidate.querySelector("td") && (candidate.innerText || "").toUpperCase().includes(symbol)
        );
        if (row) { surfaces.push(row); }
        const textOf = (node) => (node.innerText || "").replace(/\\s+/g, " ").trim();
        const canceled = surfaces.some((node) => textOf(node).includes("Order canceled"));
        const filled = surfaces.some((node) => /(?:^|[^A-Za-z])Filled(?:[^A-Za-z]|$)/i.test(textOf(node)));
        if (!canceled || filled) { return null; }
        return surfaces.find((node) => textOf(node).includes("Order canceled")) || null;
        """,
        SYMBOL,
    ) or False


def _cash(engine, email: str) -> Decimal:
    database_ok, value = False, None
    try:
        with engine.connect() as connection:
            database_ok = connection.execute(text("SELECT current_database()")).scalar() == h.DISPOSABLE_DATABASE
            if database_ok:
                value = connection.execute(text("SELECT cash_balance FROM users WHERE email = :email"), {"email": email}).scalar()
    except Exception:
        pytest.fail("cash balance read failed")
    if not database_ok:
        pytest.fail("refusing to read cash outside the disposable browser database")
    if value is None:
        pytest.fail("designated trader is missing from the disposable browser database")
    return Decimal(value)


def test_empty_market_ticket(disposable_api) -> None:
    password = os.environ.get("P0B_TRADER_PASSWORD", "")
    if not password:
        pytest.fail("P0B_TRADER_PASSWORD is required")
    _seed(disposable_api.engine)
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    driver = h._driver()
    desktop = mobile = None
    try:
        desktop = _css_viewport(driver, 1280, 800, False)
        h._sign_in(driver, disposable_api.web_url, disposable_api.email, password)
        driver.get(disposable_api.web_url + "/trades")
        h._wait(driver).until(lambda current: current.find_elements(By.CSS_SELECTOR, "select[aria-label='Order type']"))
        driver.find_element(By.CSS_SELECTOR, "input[aria-label='Trade symbol']").send_keys(SYMBOL)
        driver.find_element(By.CSS_SELECTOR, "input[aria-label='Trade quantity']").send_keys("1")
        Select(driver.find_element(By.CSS_SELECTOR, "select[aria-label='Order type']")).select_by_value("market")
        h._wait(driver).until(lambda current: not current.find_elements(By.CSS_SELECTOR, "input[aria-label='Limit price']"))
        h._install_order_hook(driver, disposable_api.api_url)
        email, engine = disposable_api.email, disposable_api.engine
        before = h._owner_activity_counts(engine, email)
        opened = {key: value for key, value in before.items() if key != "ledger_entries"}
        if any(opened.values()):
            pytest.fail("owner activity was not empty before preview: " + json.dumps(before))
        _click_preview(driver)
        h._wait(driver).until(lambda current: _ready(current, "1"))
        posts, created = _preview_http(driver), h._order_summary(driver)
        if created or not posts or posts[-1]["status"] != 200 or posts[-1]["orderStatus"] != "eligible":
            pytest.fail("preview capture mismatch: " + json.dumps({"creates": len(created), "posts": posts}))
        after = h._owner_activity_counts(engine, email)
        if after != before:
            pytest.fail("owner activity changed before an order: " + json.dumps({"before": before, "after": after}))
        assert driver.execute_script("const root=document.documentElement,main=document.querySelector('main');return !!main&&root.scrollWidth<=root.clientWidth&&main.scrollWidth<=main.clientWidth;")
        _shot(driver, driver.find_element(By.XPATH, "//h3[normalize-space()='Order preview']"), ARTIFACTS / "ticket-preview-desktop.png")
        _shot(driver, driver.find_element(By.CSS_SELECTOR, "button[aria-label='Confirm paper order']"), ARTIFACTS / "ticket-confirm-desktop.png")
        mobile = _css_viewport(driver, 390, 844, True)
        h._wait(driver).until(lambda current: not current.find_elements(By.CSS_SELECTOR, "input[aria-label='Limit price']") and _ready(current, "1") and current.execute_script(
            "const root=document.documentElement,main=document.querySelector('main');return !!main&&root.scrollWidth<=root.clientWidth&&main.scrollWidth<=main.clientWidth;"
        ))
        _shot(driver, driver.find_element(By.XPATH, "//h3[normalize-space()='Order preview']"), ARTIFACTS / "ticket-preview-mobile.png")
        _shot(driver, driver.find_element(By.CSS_SELECTOR, "button[aria-label='Confirm paper order']"), ARTIFACTS / "ticket-confirm-mobile.png")
        _css_viewport(driver, 1280, 800, False)
        quantity = driver.find_element(By.CSS_SELECTOR, "input[aria-label='Trade quantity']")
        quantity.clear()
        quantity.send_keys("2")
        h._wait(driver).until(lambda current: _cleared(current) and not _shown(current, "[role='alert']"))
        _click_preview(driver)
        h._wait(driver).until(lambda current: _ready(current, "2"))
        driver.execute_cdp_cmd("Network.enable", {})
        driver.execute_cdp_cmd("Network.setBlockedURLs", {"urls": ["*orders/preview*"]})
        try:
            _click_preview(driver)
            h._wait(driver).until(lambda current: _cleared(current) and _shown(current, "[role='alert']"))
            _shot(driver, driver.find_element(By.CSS_SELECTOR, "[role='alert']"), ARTIFACTS / "ticket-preview-error.png")
        finally:
            driver.execute_cdp_cmd("Network.setBlockedURLs", {"urls": []})
        _click_preview(driver)
        h._wait(driver).until(lambda current: _ready(current, "2"))
        _enter_confirm(driver)
        surface = h._wait(driver).until(_canceled_surface)
        summary = h._order_summary(driver)
        if len(summary) != 1 or summary[0]["status"] != 200 or summary[0]["orderStatus"] != "canceled":
            pytest.fail("order capture mismatch: " + json.dumps({"count": len(summary), "statuses": [item["status"] for item in summary], "order_statuses": [item["orderStatus"] for item in summary]}))
        counts = h._owner_activity_counts(engine, email)
        expected = dict(before)
        expected["orders"] = 1
        expected["order_requests"] = 1
        if counts != expected:
            pytest.fail("market order activity mismatch: " + json.dumps(counts))
        if _cash(engine, email) != Decimal("100000.00"):
            pytest.fail("cash balance changed")
        _shot(driver, surface, ARTIFACTS / "ticket-market-canceled.png")
        h._wait(driver).until(lambda current: not any(
            node.is_displayed() for node in current.find_elements(By.CSS_SELECTOR, "div[aria-label='Notifications'] .toast-item")
        ))
        mobile = _css_viewport(driver, 390, 844, True)
        if driver.find_element(By.CSS_SELECTOR, "input[aria-label='Trade quantity']").get_attribute("value") != "2":
            pytest.fail("sell preview quantity was not the blocked market quantity")
        sell = h._wait(driver).until(lambda current: next((
            node for node in current.find_elements(By.CSS_SELECTOR, "button[aria-label='Sell']") if node.is_displayed()
        ), False))
        h._click(driver, sell)
        driver.execute_script("window.scrollTo(0, 0); const main = document.querySelector('main'); if (main) { main.scrollTo(0, 0); }")
        h._wait(driver).until(lambda current: current.execute_script(
            _HEADER_OFFSET + """
            const sell = document.querySelector("button[aria-label='Sell']");
            if (!sell) { return false; }
            const box = sell.getBoundingClientRect();
            if (box.top < offset || box.bottom > innerHeight) {
              const main = document.querySelector('main');
              const delta = box.top < offset ? box.top - offset - 8 : box.bottom - innerHeight + 8;
              if (main && main.scrollHeight > main.clientHeight) { main.scrollBy(0, delta); }
              else { window.scrollBy(0, delta); }
            }
            const placed = sell.getBoundingClientRect();
            return placed.width > 0 && placed.height > 0 && placed.top >= offset - 1 && placed.bottom <= innerHeight
              && placed.left >= 0 && placed.right <= innerWidth;
            """
        ))
        driver.save_screenshot(str(ARTIFACTS / "ticket-sell-form-mobile.png"))
        prior_previews = len(_preview_http(driver))
        _click_preview(driver)
        h._wait(driver).until(lambda current: _sell_blocked(current, prior_previews))
        reason = h._wait(driver).until(_sell_reason_node)
        _shot(driver, reason, ARTIFACTS / "ticket-sell-blocked-mobile.png")
        if h._order_summary(driver) != summary:
            pytest.fail("sell preview posted an order: " + json.dumps({"count": len(h._order_summary(driver))}))
        sell_counts = h._owner_activity_counts(engine, email)
        if sell_counts != expected:
            pytest.fail("sell preview changed owner activity: " + json.dumps(sell_counts))
        if _cash(engine, email) != Decimal("100000.00"):
            pytest.fail("cash balance changed")
        print(json.dumps({"check": "empty market ticket", "preview_status": "eligible", "order_count": 1, "order_status": "canceled", "cash": "unchanged", "fills": 0, "desktop_viewport": desktop, "mobile_viewport": mobile, "viewport_source": "window.innerWidth/innerHeight", "same_key_retry": "omitted_private_vault", "sell_preview_status": "blocked"}, sort_keys=True))
    finally:
        try:
            driver.execute_cdp_cmd("Network.setBlockedURLs", {"urls": []})
        except Exception:
            pass
        driver.quit()
