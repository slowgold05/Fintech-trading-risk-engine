"""Partially filled limit lifecycle on the guarded, provider-blocked local stack.

The service seed writes the book. The browser only reads persisted rows and cancels.
"""

import json
import os
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import pytest

pytest.importorskip("selenium")

from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

import test_p0b_acceptance as h
import test_p3b_ticket as t
from app.core.security import hash_password
from app.models.asset import Asset
from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol
from app.models.order import Order
from app.models.trade import Trade
from app.models.user import User
from app.schemas.order import OrderCreate
from app.services.ledger_service import ensure_opening, reconcile_account
from app.services.order_book import place_order
from app.services.trade_execution import execute_fill

pytestmark = pytest.mark.skipif(os.environ.get("P0B_BROWSER") != "1", reason="Set P0B_BROWSER=1")
disposable_api = h.disposable_api
ARTIFACTS = h.REPO_ROOT / ".local-tools" / "p3b-lifecycle"
_CASH = Decimal("94800.00")
_OPEN_BP = "$94,700"
_FLAT_BP = "$94,800"
_CASH_LABEL = "$94,800"


def _guard(db: Session) -> None:
    if db.execute(text("SELECT current_database()")).scalar() != h.DISPOSABLE_DATABASE:
        pytest.fail("refusing to use a database other than the disposable browser database")


def _halt_is_open(db: Session) -> None:
    halted = db.execute(text("SELECT halted FROM trading_halt_state WHERE id = 1")).scalar()
    if halted is not False:
        pytest.fail("trading halt state is not open")


def _seed(engine, email: str) -> dict:
    symbol = "P3LIFE" + uuid.uuid4().hex[:6].upper()
    quoted_at = datetime.now(timezone.utc).replace(tzinfo=None)
    with Session(engine) as db:
        _guard(db)
        _halt_is_open(db)
        owner = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if owner is None:
            pytest.fail("designated trader is missing from the disposable browser database")
        ensure_opening(db, owner)
        db.add(MarketSymbol(
            symbol=symbol, company_name="Lifecycle fixture", exchange="NASDAQ", sector="Technology",
            is_active=True, is_test=False, is_etf=False, refresh_tier="hot",
        ))
        db.flush()
        asset = Asset(symbol=symbol, asset_type="stock", name="Lifecycle fixture", is_active=True)
        db.add(asset)
        db.flush()
        db.add(MarketQuoteCache(
            symbol=symbol, price=Decimal("100"), change_amount=0, change_percent=Decimal("0"),
            volume=100, source="fixture", quote_at=quoted_at, fetched_at=quoted_at,
        ))
        maker = User(
            email=f"p3life-{uuid.uuid4().hex}@example.com",
            password_hash=hash_password("synthetic-lifecycle"),
            full_name="Lifecycle maker",
            role="trader",
            cash_balance=Decimal("100000.00"),
        )
        db.add(maker)
        db.flush()
        ensure_opening(db, maker)
        execute_fill(db, maker, asset, "buy", Decimal("52"), Decimal("100"))
        for _ in range(52):
            place_order(db, maker.id, OrderCreate(symbol=symbol, side="sell", quantity="1", limit_price="100"))
        order, _matched = place_order(
            db, owner.id, OrderCreate(symbol=symbol, side="buy", quantity="53", limit_price="100"),
        )
        db.commit()
        owner_id, maker_id, order_id = int(owner.id), int(maker.id), int(order.id)
        trade_ids = [int(row) for row in db.execute(
            select(Trade.id).where(Trade.order_id == order_id, Trade.user_id == owner_id).order_by(Trade.id.asc())
        ).scalars()]
        stored = db.get(Order, order_id)
        owner = db.get(User, owner_id)
        maker = db.get(User, maker_id)
        if stored is None or owner is None or maker is None:
            pytest.fail("lifecycle fixture rows were not readable after commit")
        if stored.status != "open" or stored.remaining_quantity != Decimal("1") or len(trade_ids) != 52:
            pytest.fail("lifecycle fixture did not rest one share after fifty-two fills")
        if owner.cash_balance != _CASH or maker.cash_balance != Decimal("100000.00"):
            pytest.fail("lifecycle cash did not match the synthetic fill")
        if not reconcile_account(db, owner)["ok"] or not reconcile_account(db, maker)["ok"]:
            pytest.fail("lifecycle ledger did not reconcile before the browser read")
        return {"symbol": symbol, "order_id": order_id, "trade_ids": trade_ids, "maker_id": maker_id, "owner_id": owner_id}


def _region_state(driver, order_id: int) -> dict | None:
    found = driver.execute_script(
        """
        const label = arguments[0];
        const region = document.querySelector(`[aria-label="${label}"]`);
        if (!region) { return null; }
        const own = (node) => Array.from(node.childNodes)
          .filter((child) => child.nodeType === Node.TEXT_NODE)
          .map((child) => child.textContent)
          .join(" ")
          .replace(/\\s+/g, " ")
          .trim();
        const fields = {};
        for (const dt of region.querySelectorAll("dt")) {
          const name = own(dt);
          const dd = dt.nextElementSibling;
          if (!name || !dd || dd.tagName !== "DD") { continue; }
          fields[name] = (dd.textContent || "").replace(/\\s+/g, " ").trim();
        }
        const ids = Array.from(region.querySelectorAll("table tbody tr")).map((row) => (row.cells[0] ? row.cells[0].textContent.trim() : ""));
        const button = (name) => {
          const node = Array.from(region.querySelectorAll("button")).find((item) => item.textContent.trim() === name);
          return node ? {disabled: Boolean(node.disabled)} : null;
        };
        const text = region.innerText || "";
        return {
          fields: fields,
          ids: ids,
          whole: text,
          error: text.includes("Order details could not be loaded."),
          first: button("First page"),
          next: button("Next"),
          financial: ["Original", "Filled", "Remaining", "Limit"].every((name) => Object.prototype.hasOwnProperty.call(fields, name)),
        };
        """,
        f"Order {order_id} details",
    )
    return found if isinstance(found, dict) else None


def _page_fits(driver) -> bool:
    return bool(driver.execute_script(
        "const root=document.documentElement,main=document.querySelector('main');"
        "return !!main&&root.scrollWidth<=root.clientWidth&&main.scrollWidth<=main.clientWidth;"
    ))


def _fail_mobile(driver, order_id: int) -> None:
    path = ARTIFACTS / "mobile-failure.png"
    saved = False
    try:
        driver.save_screenshot(str(path))
        saved = True
    except Exception:
        saved = False
    geometry: dict = {"shot": path.name if saved else None}
    try:
        found = driver.execute_script(
            """
            const label = arguments[0];
            const root = document.documentElement;
            const main = document.querySelector("main");
            const region = document.querySelector(`[aria-label="${label}"]`);
            let filled = null;
            if (region) {
              const own = (node) => Array.from(node.childNodes)
                .filter((child) => child.nodeType === Node.TEXT_NODE)
                .map((child) => child.textContent)
                .join(" ")
                .replace(/\\s+/g, " ")
                .trim();
              for (const dt of region.querySelectorAll("dt")) {
                if (own(dt) !== "Filled") { continue; }
                const dd = dt.nextElementSibling;
                filled = dd && dd.tagName === "DD" ? (dd.textContent || "").replace(/\\s+/g, " ").trim() : null;
                break;
              }
            }
            const overflow = [];
            for (const node of document.querySelectorAll("*")) {
              if (overflow.length >= 8) { break; }
              const box = node.getBoundingClientRect();
              if (node.scrollWidth > node.clientWidth || box.right > window.innerWidth || box.left < 0) {
                overflow.push({
                  tag: node.tagName,
                  id: node.id || "",
                  className: String(node.className || "").slice(0, 120),
                  clientWidth: node.clientWidth,
                  scrollWidth: node.scrollWidth,
                  width: box.width,
                  left: box.left,
                  right: box.right,
                });
              }
            }
            return {
              viewport: {width: window.innerWidth, height: window.innerHeight},
              root: {clientWidth: root.clientWidth, scrollWidth: root.scrollWidth},
              main: main ? {clientWidth: main.clientWidth, scrollWidth: main.scrollWidth} : null,
              region: Boolean(region),
              filledEquals52: filled === "52.000000",
              overflow: overflow,
            };
            """,
            f"Order {order_id} details",
        )
        if isinstance(found, dict):
            geometry.update(found)
    except Exception:
        geometry["geometry"] = "unavailable"
    pytest.fail("mobile details wait failed: " + json.dumps(geometry, sort_keys=True))


def _open_details(driver, symbol: str, order_id: int) -> None:
    label = f"Details for {symbol} order {order_id}"
    button = h._wait(driver).until(lambda current: next((
        node for node in current.find_elements(By.CSS_SELECTOR, f"button[aria-label='{label}']") if node.is_displayed()
    ), False))
    driver.execute_script("arguments[0].focus();", button)
    h._wait(driver).until(lambda current: current.switch_to.active_element.get_attribute("aria-label") == label)
    driver.switch_to.active_element.send_keys(Keys.ENTER)


def _expect_fields(state: dict, status: str) -> None:
    fields = state.get("fields") or {}
    expected = {
        "Original": "53.000000",
        "Filled": "52.000000",
        "Remaining": "1.000000",
        "Status": status,
        "Limit": "100.000000 USD",
    }
    if any(fields.get(key) != value for key, value in expected.items()):
        pytest.fail("order detail fields mismatched: " + json.dumps({"status": fields.get("Status"), "keys": sorted(fields)}))
    if "UTC" not in fields.get("Created", "") or "UTC" not in fields.get("Read", ""):
        pytest.fail("order detail timestamps were not visible UTC")


def _trade_ids(state: dict) -> list[str]:
    return [str(item) for item in state.get("ids") or []]


def _click_named(driver, order_id: int, name: str) -> None:
    button = h._wait(driver).until(lambda current: current.execute_script(
        """
        const region = document.querySelector(`[aria-label="${arguments[0]}"]`);
        if (!region) { return null; }
        return Array.from(region.querySelectorAll("button")).find((item) => item.textContent.trim() === arguments[1] && !item.disabled) || null;
        """,
        f"Order {order_id} details",
        name,
    ))
    h._click(driver, button)


def _nav(driver, href: str) -> None:
    link = h._wait(driver).until(lambda current: next((
        node for node in current.find_elements(By.CSS_SELECTOR, f"a[href='{href}']") if node.is_displayed()
    ), False))
    h._click(driver, link)


def _shot_heading(driver, order_id: int, level: str, text: str, path) -> None:
    heading = h._wait(driver).until(lambda current: current.execute_script(
        """
        const region = document.querySelector(`[aria-label="${arguments[0]}"]`);
        if (!region) { return null; }
        return Array.from(region.querySelectorAll(arguments[1])).find((node) => node.textContent.trim() === arguments[2]) || null;
        """,
        f"Order {order_id} details",
        level,
        text,
    ))
    t._shot(driver, heading, path)


def _reconcile(engine, owner_id: int, maker_id: int) -> None:
    with Session(engine) as db:
        _guard(db)
        owner, maker = db.get(User, owner_id), db.get(User, maker_id)
        if owner is None or maker is None:
            pytest.fail("lifecycle accounts were missing for reconcile")
        if owner.cash_balance != _CASH:
            pytest.fail("owner cash changed")
        if not reconcile_account(db, owner)["ok"] or not reconcile_account(db, maker)["ok"]:
            pytest.fail("lifecycle ledger did not reconcile")


def _persisted(engine, order_id: int, owner_id: int) -> dict:
    with Session(engine) as db:
        _guard(db)
        order = db.get(Order, order_id)
        trades = db.execute(
            select(func.count()).select_from(Trade).where(Trade.order_id == order_id, Trade.user_id == owner_id)
        ).scalar()
        if order is None:
            pytest.fail("owner order was missing")
        return {"status": order.status, "remaining": order.remaining_quantity, "trades": int(trades or 0)}


def test_partial_fill_lifecycle(disposable_api) -> None:
    password = os.environ.get("P0B_TRADER_PASSWORD", "")
    if not password:
        pytest.fail("P0B_TRADER_PASSWORD is required")
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    driver = h._driver()
    desktop = mobile = None
    try:
        desktop = t._css_viewport(driver, 1280, 800, False)
        h._sign_in(driver, disposable_api.web_url, disposable_api.email, password)
        seeded = _seed(disposable_api.engine, disposable_api.email)
        symbol, order_id = seeded["symbol"], seeded["order_id"]
        own = [str(item) for item in seeded["trade_ids"]]
        engine, email = disposable_api.engine, disposable_api.email
        before = h._owner_activity_counts(engine, email)
        driver.get(disposable_api.web_url + "/dashboard")
        h._wait(driver).until(lambda current: h._money_after(current, "Cash") == _CASH_LABEL and h._money_after(current, "Buying power") == _OPEN_BP)
        _nav(driver, "/trades")
        h._wait(driver).until(lambda current: current.find_elements(By.XPATH, "//h2[normalize-space()='Your Orders']"))
        _open_details(driver, symbol, order_id)
        h._wait(driver).until(lambda current: (state := _region_state(current, order_id)) and state["fields"].get("Original") == "53.000000")
        state = _region_state(driver, order_id)
        _expect_fields(state, "open")
        if "Whole order: 52 recorded fills." not in state["whole"] or _trade_ids(state) != own[:50]:
            pytest.fail("first fill page was not the first fifty owned trades: " + json.dumps({"shown": len(_trade_ids(state))}))
        if any(item not in own for item in _trade_ids(state)):
            pytest.fail("trade column included an id outside the owner fills")
        if h._owner_activity_counts(engine, email) != before:
            pytest.fail("reading details changed owner activity")
        h._wait(driver).until(_page_fits)
        _shot_heading(driver, order_id, "h3", f"Order {order_id}", ARTIFACTS / "details-desktop.png")
        _shot_heading(driver, order_id, "h4", "Recorded fills", ARTIFACTS / "fills-desktop.png")
        mobile = t._css_viewport(driver, 390, 844, True)
        try:
            h._wait(driver).until(lambda current: _page_fits(current) and (_region_state(current, order_id) or {}).get("fields", {}).get("Filled") == "52.000000")
        except TimeoutException:
            _fail_mobile(driver, order_id)
        _shot_heading(driver, order_id, "h3", f"Order {order_id}", ARTIFACTS / "details-mobile.png")
        _shot_heading(driver, order_id, "h4", "Recorded fills", ARTIFACTS / "fills-mobile.png")
        t._css_viewport(driver, 1280, 800, False)
        _click_named(driver, order_id, "Next")
        h._wait(driver).until(lambda current: _trade_ids(_region_state(current, order_id) or {}) == own[50:])
        page_two = _region_state(driver, order_id)
        _expect_fields(page_two, "open")
        if len(_trade_ids(page_two)) != 2 or "Whole order: 52 recorded fills." not in page_two["whole"]:
            pytest.fail("second page did not keep the fifty-two fill count")
        if not page_two["next"]["disabled"] or page_two["first"]["disabled"]:
            pytest.fail("second page controls were not next-disabled and first-available")
        if h._owner_activity_counts(engine, email) != before:
            pytest.fail("paging changed owner activity")
        h._wait(driver).until(_page_fits)
        _shot_heading(driver, order_id, "h4", "Recorded fills", ARTIFACTS / "page-two.png")
        driver.execute_cdp_cmd("Network.enable", {})
        driver.execute_cdp_cmd("Network.setBlockedURLs", {"urls": [f"*orders/{order_id}*"]})
        try:
            _click_named(driver, order_id, "First page")
            h._wait(driver).until(lambda current: (state := _region_state(current, order_id)) and state["error"] and not state["financial"])
            error = h._wait(driver).until(lambda current: current.execute_script(
                """
                const region = document.querySelector(arguments[0]);
                if (!region) { return null; }
                return Array.from(region.querySelectorAll("p")).find((node) => node.textContent.trim() === "Order details could not be loaded.") || null;
                """,
                f'[aria-label="Order {order_id} details"]',
            ))
            t._shot(driver, error, ARTIFACTS / "detail-error.png")
        finally:
            driver.execute_cdp_cmd("Network.setBlockedURLs", {"urls": []})
        _click_named(driver, order_id, "Retry")
        h._wait(driver).until(lambda current: _trade_ids(_region_state(current, order_id) or {}) == own[:50])
        restored = _region_state(driver, order_id)
        _expect_fields(restored, "open")
        if h._owner_activity_counts(engine, email) != before:
            pytest.fail("detail retry changed owner activity")
        cancel = h._wait(driver).until(lambda current: next((
            node for node in current.find_elements(By.CSS_SELECTOR, f"button[aria-label='Cancel {symbol} order {order_id}']") if node.is_displayed()
        ), False))
        h._click(driver, cancel)
        h._wait(driver).until(lambda current: (
            (state := _region_state(current, order_id))
            and state["fields"].get("Status") == "canceled"
            and state["fields"].get("Filled") == "52.000000"
            and state["fields"].get("Remaining") == "1.000000"
            and "Whole order: 52 recorded fills." in state["whole"]
        ))
        h._wait(driver).until(lambda current: current.execute_script(
            """
            const symbol = arguments[0];
            const section = Array.from(document.querySelectorAll("section")).find((node) =>
              Array.from(node.querySelectorAll("h2")).some((heading) => heading.textContent.trim() === "Your Orders")
            );
            if (!section) { return false; }
            return Array.from(section.querySelectorAll("tbody tr")).some((row) => {
              const cells = Array.from(row.cells).map((cell) => cell.textContent.trim().toLowerCase());
              return cells.includes(symbol.toLowerCase()) && cells.includes("canceled");
            });
            """,
            symbol,
        ))
        canceled = _region_state(driver, order_id)
        if _trade_ids(canceled) != own[:50]:
            pytest.fail("cancel replaced the recorded fill page")
        if "UTC" not in (canceled["fields"].get("Canceled") or ""):
            pytest.fail("canceled timestamp was not visible UTC")
        after = h._owner_activity_counts(engine, email)
        if after != before:
            pytest.fail("cancel changed owner activity counts: " + json.dumps(after))
        row = _persisted(engine, order_id, seeded["owner_id"])
        if row["status"] != "canceled" or row["remaining"] != Decimal("1") or row["trades"] != 52:
            pytest.fail("persisted order did not keep the partial fill: " + json.dumps({"status": row["status"], "trades": row["trades"]}))
        _reconcile(engine, seeded["owner_id"], seeded["maker_id"])
        h._wait(driver).until(_page_fits)
        _shot_heading(driver, order_id, "h3", f"Order {order_id}", ARTIFACTS / "canceled.png")
        _nav(driver, "/dashboard")
        h._wait(driver).until(lambda current: h._money_after(current, "Cash") == _CASH_LABEL and h._money_after(current, "Buying power") == _FLAT_BP)
        print(json.dumps({
            "check": "partial fill lifecycle",
            "fills": 52,
            "remaining": "1",
            "status": "canceled",
            "cash": "94800",
            "buying_power_open": "94700",
            "buying_power_canceled": "94800",
            "owner_counts": before,
            "desktop_viewport": desktop,
            "mobile_viewport": mobile,
            "viewport_source": "window.innerWidth/innerHeight",
        }, sort_keys=True))
    finally:
        try:
            driver.execute_cdp_cmd("Network.setBlockedURLs", {"urls": []})
        except Exception:
            pass
        driver.quit()
