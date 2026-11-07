"""Cached daily-chart acceptance on the guarded, provider-blocked local stack."""

import json
import os
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

pytest.importorskip("selenium")

from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import Select
from sqlalchemy.orm import Session

import test_p0b_acceptance as harness
from app.models.market_bar_daily import MarketBarDaily
from app.models.market_symbol import MarketSymbol
from app.services import exchange_calendar

pytestmark = pytest.mark.skipif(os.environ.get("P0B_BROWSER") != "1", reason="Set P0B_BROWSER=1")
disposable_api = harness.disposable_api
PROVIDER = "fixture-history"
SECTION = "section[aria-labelledby='daily-price-history-title']"


@pytest.fixture
def chart_api(monkeypatch, request):
    monkeypatch.setenv("P3A_BAD_HISTORY_FIXTURE", "1")
    return request.getfixturevalue("disposable_api")


def _section(driver):
    return driver.find_element(By.CSS_SELECTOR, SECTION)


def _plot(driver):
    return next((canvas for canvas in _section(driver).find_elements(By.TAG_NAME, "canvas")
                 if canvas.is_displayed() and canvas.rect["width"] > 100 and canvas.rect["height"] > 100), False)


def _submit(driver, symbol, adjustment="raw"):
    field = _section(driver).find_element(By.ID, "daily-history-symbol")
    field.clear()
    field.send_keys(symbol)
    Select(_section(driver).find_element(By.ID, "daily-history-series")).select_by_value(
        json.dumps([PROVIDER, adjustment], separators=(",", ":"))
    )
    harness._click(driver, _section(driver).find_element(By.XPATH, ".//button[normalize-space()='View history']"))


def _history_reads(driver):
    return driver.execute_script("""
        return performance.getEntriesByType('resource').filter(entry => {
          const url = new URL(entry.name);
          return url.pathname.startsWith('/market/symbols/')
            && url.pathname.endsWith('/history') && entry.responseEnd > 0;
        }).length;
    """)


def _capture(driver, target, path):
    driver.execute_script("arguments[0].scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});", target)
    harness._wait(driver).until(lambda current: current.execute_script("""
        const box = arguments[0].getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.top >= 0
          && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth;
    """, target))
    driver.save_screenshot(str(path))


def _no_plot(driver):
    return not _section(driver).find_elements(By.TAG_NAME, "canvas")


def _open_prices(driver):
    summary = _section(driver).find_element(By.TAG_NAME, "summary")
    if not summary.find_element(By.XPATH, "..").get_attribute("open"):
        harness._click(driver, summary)


def test_cached_daily_chart(chart_api):
    now = datetime.now(timezone.utc)
    sessions = [(now - timedelta(days=4)).date(), (now - timedelta(days=2)).date()]
    with Session(chart_api.engine) as db:
        for symbol in ("P3HISTORY", "P3EMPTY", "P3INVALID"):
            item = db.get(MarketSymbol, symbol)
            if item is None:
                item = MarketSymbol(symbol=symbol, company_name="Chart fixture", exchange="NASDAQ")
                db.add(item)
            item.is_active, item.is_test, item.is_etf = True, False, False
            item.sector, item.heatmap_size = "Technology", "micro"
        db.flush()
        for symbol, adjustments in (("P3HISTORY", ("raw", "split_adjusted")), ("P3INVALID", ("raw",))):
            for adjustment in adjustments:
                for session in sessions:
                    key = (symbol, session, PROVIDER, adjustment)
                    bar = db.get(MarketBarDaily, key)
                    if bar is None:
                        bar = MarketBarDaily(symbol=symbol, session_date=session, provider=PROVIDER, adjustment_type=adjustment)
                        db.add(bar)
                    values = ("100", "110", "90", "105") if adjustment == "raw" else ("50", "55", "45", "52.5")
                    bar.open, bar.high, bar.low, bar.close = map(Decimal, values)
                    bar.volume, bar.quality_status = 0, "valid"
                    bar.fetched_at = now - timedelta(minutes=1)
        db.commit()

    artifacts = harness.REPO_ROOT / ".local-tools" / "p3a-history"
    artifacts.mkdir(parents=True, exist_ok=True)
    driver = harness._driver()
    try:
        driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": 1280, "height": 800, "deviceScaleFactor": 1, "mobile": False})
        driver.get(chart_api.web_url + "/market")
        harness._wait(driver).until(lambda current: current.find_elements(By.CSS_SELECTOR, "#daily-history-series option[value]:not([value=''])"))
        assert _history_reads(driver) == 0
        assert _no_plot(driver)
        assert driver.execute_script("return !performance.getEntriesByType('resource').some(e => e.name.includes('lightweight-charts.production'))")

        _submit(driver, "P3HISTORY")
        canvas = harness._wait(driver).until(_plot)
        text = _section(driver).text
        assert PROVIDER in text and "adjustment raw" in text
        # Only 2 of the many expected NYSE trading days in the 2-year window were stored, so
        # the reviewed calendar always reports at least "Gaps". If either fixture session
        # itself falls on a real non-trading day, it also reports "Unexpected sessions".
        unexpected = any(not exchange_calendar.is_nyse_trading_day(session) for session in sessions)
        expected_coverage_label = "Gaps and unexpected sessions" if unexpected else "Gaps"
        assert expected_coverage_label in text and "Disabled" in text and "Partial" in text
        for session in sessions:
            assert session.isoformat() in text
        _open_prices(driver)
        harness._wait(driver).until(lambda current: "105.000000" in _section(current).find_element(By.CSS_SELECTOR, "details table").text)
        table_text = _section(driver).find_element(By.CSS_SELECTOR, "details table").text
        assert "Volume" in table_text
        _capture(driver, canvas, artifacts / "chart-desktop.png")

        desktop_width = canvas.rect["width"]
        driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": True})
        harness._wait(driver).until(lambda current: harness._viewport(current)["width"] == 390
                                   and (plot := _plot(current)) and plot.rect["width"] < desktop_width)
        assert driver.execute_script("""
            const root = document.documentElement, main = document.querySelector('main');
            return root.scrollWidth <= root.clientWidth && main.scrollWidth <= main.clientWidth;
        """)
        _capture(driver, harness._wait(driver).until(_plot), artifacts / "chart-mobile.png")
        driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": 1280, "height": 800, "deviceScaleFactor": 1, "mobile": False})
        harness._wait(driver).until(lambda current: harness._viewport(current)["width"] == 1280)

        _submit(driver, "P3HISTORY", "split_adjusted")
        harness._wait(driver).until(_plot)
        _open_prices(driver)
        harness._wait(driver).until(lambda current: "52.500000" in _section(current).text)
        assert "105.000000" not in _section(driver).text
        canvas = harness._wait(driver).until(_plot)
        canvas_id, reads = canvas.id, _history_reads(driver)
        _submit(driver, "P3HISTORY", "split_adjusted")
        harness._wait(driver).until(lambda current: _history_reads(current) > reads)
        driver.execute_async_script("const done = arguments[arguments.length - 1]; requestAnimationFrame(() => requestAnimationFrame(() => done(true)));")
        assert harness._wait(driver).until(_plot).id == canvas_id

        driver.execute_cdp_cmd("Network.enable", {})
        driver.execute_cdp_cmd("Network.setBlockedURLs", {"urls": ["*127.0.0.1:8000/market/symbols/P3HISTORY/history*"]})
        try:
            _submit(driver, "P3HISTORY", "split_adjusted")
            harness._wait(driver).until(lambda current: "Cached daily history could not be loaded." in _section(current).text)
            harness._wait(driver).until(_no_plot)
            assert not _section(driver).find_elements(By.TAG_NAME, "summary")
            _capture(driver, _section(driver).find_element(By.CSS_SELECTOR, "[role='alert']"), artifacts / "chart-error.png")
        finally:
            driver.execute_cdp_cmd("Network.setBlockedURLs", {"urls": []})
        harness._click(driver, _section(driver).find_element(By.XPATH, ".//button[normalize-space()='Retry']"))
        harness._wait(driver).until(_plot)

        _submit(driver, "P3EMPTY")
        harness._wait(driver).until(lambda current: "No cached daily bars for this symbol, source, and adjustment." in _section(current).text)
        assert _no_plot(driver)
        assert "Unavailable" in _section(driver).text
        _capture(driver, _section(driver).find_element(By.CSS_SELECTOR, "[role='status']"), artifacts / "chart-empty.png")

        _submit(driver, "P3INVALID")
        harness._wait(driver).until(lambda current: "Cached daily bars could not be plotted." in _section(current).text)
        assert _no_plot(driver)
        assert not _section(driver).find_elements(By.TAG_NAME, "summary")
        _capture(driver, _section(driver).find_element(By.CSS_SELECTOR, "[role='alert']"), artifacts / "chart-invalid.png")

        assert _section(driver).find_element(By.LINK_TEXT, "https://www.tradingview.com/").get_attribute("href") == "https://www.tradingview.com/"
        assets = driver.execute_async_script("""
            const done = arguments[arguments.length - 1];
            Promise.all([
              ['lightweight-charts-LICENSE.txt', 'Apache License'],
              ['lightweight-charts-NOTICE.txt', 'TradingView Lightweight Charts'],
              ['fancy-canvas-LICENSE.txt', 'Copyright (c) 2019 TradingView']
            ].map(async ([name, prefix]) => {
              const response = await fetch('/licenses/' + name);
              return response.status === 200 && (await response.text()).trimStart().startsWith(prefix);
            })).then(done).catch(() => done([false]));
        """)
        assert assets == [True, True, True]

        _submit(driver, "P3HISTORY")
        canvas = harness._wait(driver).until(_plot)
        harness._click(driver, driver.find_element(By.LINK_TEXT, "Log in"))
        harness._wait(driver).until(EC.url_contains("/login"))
        harness._wait(driver).until(EC.staleness_of(canvas))
        driver.back()
        harness._wait(driver).until(EC.presence_of_element_located((By.ID, "daily-history-series")))
        assert _no_plot(driver)
        assert _section(driver).find_element(By.ID, "daily-history-symbol").get_attribute("value") == ""
        print(json.dumps({"check": "cached daily chart", "series": 2, "provider_http": "blocked", "license_assets": len(assets)}))
    finally:
        driver.quit()
