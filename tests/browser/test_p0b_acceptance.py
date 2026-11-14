"""Local Selenium acceptance for the P0-B browser journey.

Skipped unless P0B_BROWSER=1. The mutating journey accepts only loopback web
and API URLs. It starts the API itself after checking that both configured
database URLs are the disposable p0b_browser database on 127.0.0.1:54331.
The hosted test only opens the public page. Each local test derives a fresh
UUID-tagged address from P0B_TRADER_EMAIL and registers that new account.

Captured order records keep authorization material inside the page. Assertion
messages receive counts and statuses. Replay runs in the page and returns the
response status and order id.

The access token lives in page memory, so deleting cookies and loading a new
document is recorded as a missing session. A separate case keeps the document
open, sends an expired access token, and revokes the disposable refresh token.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import uuid
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

import pytest

pytest.importorskip("selenium")

from selenium import webdriver
from selenium.common.exceptions import ElementClickInterceptedException, TimeoutException
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

pytestmark = pytest.mark.skipif(
    os.environ.get("P0B_BROWSER") != "1",
    reason="Set P0B_BROWSER=1 to run the local Selenium journey",
)

HOSTED = "https://fintechapp-preview.gps5zt7wg4yqg.us-east-2.cs.amazonlightsail.com"
VIEWPORT = (1280, 800)
SYMBOL = "P0B"
DISPOSABLE_DATABASE = "p0b_browser"
DISPOSABLE_PORT = 54331
API_PORT = 8000
WEB_PORT = 4173
ALEMBIC_HEAD = "8f3a1c6d9e20"
DISPOSABLE_JWT_SECRET = "p0b-browser-jwt-secret-value-32b"
REPO_ROOT = Path(__file__).resolve().parents[2]
ACCESS_EVENT = re.compile(r'"([A-Z]+) ([^"\s]+) HTTP/[0-9.]+" (\d{3})')


class _DisposableApi:
    def __init__(self, log_path: Path, engine, email: str, web_url: str, api_url: str) -> None:
        self.log_path = log_path
        self.engine = engine
        self.email = email
        self.web_url = web_url
        self.api_url = api_url

    def __repr__(self) -> str:
        return "_DisposableApi(p0b_browser)"


def _loopback_url(url: str, port: int, label: str) -> str:
    parts = urlsplit(url.strip())
    host = (parts.hostname or "").lower()
    if (
        parts.scheme != "http"
        or parts.username
        or parts.password
        or host not in {"127.0.0.1", "localhost"}
        or parts.port != port
        or parts.path not in {"", "/"}
        or parts.query
        or parts.fragment
    ):
        pytest.fail(f"{label} must be an http loopback URL on port {port} with no userinfo or path")
    return f"http://127.0.0.1:{port}"


def _require_database_url(url: str, username: str | None) -> str:
    try:
        from sqlalchemy.engine import make_url

        parsed = make_url(url)
    except Exception:
        pytest.fail("disposable database URL could not be read")
    host = (parsed.host or "").lower()
    if host not in {"127.0.0.1", "localhost"} or parsed.port != DISPOSABLE_PORT or parsed.database != DISPOSABLE_DATABASE:
        pytest.fail("disposable database URL must target loopback port 54331 database p0b_browser")
    if not parsed.password or (username is not None and parsed.username != username):
        pytest.fail("disposable database URL is missing the expected role")
    return url


def _port_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.4)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def _safe_log_excerpt(text: str) -> str:
    kept: list[str] = []
    for line in text.splitlines()[-40:]:
        lowered = line.lower()
        if "://" in line or "bearer " in lowered or "password" in lowered:
            continue
        kept.append(line[:180])
    return " | ".join(kept[-8:])


def _service_popen_kwargs() -> dict[str, bool]:
    if os.name == "nt":
        return {}
    return {"start_new_session": True}


def _signal_owned_group(group_id: int, signum: int) -> None:
    try:
        os.killpg(group_id, signum)
    except ProcessLookupError:
        return


def _wait_bounded(proc: subprocess.Popen, timeout: float) -> None:
    if proc.poll() is not None:
        return
    try:
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        return


def _stop_owned_process_group(proc: subprocess.Popen) -> None:
    """Terminate, then kill, only the session started for this service."""
    group_id = proc.pid
    if group_id <= 1:
        return
    _signal_owned_group(group_id, signal.SIGTERM)
    _wait_bounded(proc, 10)
    _signal_owned_group(group_id, signal.SIGKILL)
    _wait_bounded(proc, 5)


def _stop_process(proc: subprocess.Popen) -> None:
    if os.name != "nt":
        _stop_owned_process_group(proc)
        return
    if proc.poll() is not None:
        return
    subprocess.run(
        ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()


def _fresh_designated_email(provided: str) -> str:
    local, separator, domain = provided.strip().partition("@")
    if not separator or not local or not domain or "@" in domain or any(char.isspace() for char in provided):
        pytest.fail("P0B_TRADER_EMAIL must be one designated test email address")
    return f"{local}+{uuid.uuid4().hex}@{domain}"


def _wait_http(url: str, proc: subprocess.Popen, log_path: Path) -> None:
    deadline = time.time() + 40
    while time.time() < deadline:
        if proc.poll() is not None:
            excerpt = _safe_log_excerpt(log_path.read_text(encoding="utf-8", errors="replace"))
            pytest.fail(f"process exited before the loopback service was ready; log={excerpt}")
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status == 200:
                    return
        except Exception:
            time.sleep(0.4)
    excerpt = _safe_log_excerpt(log_path.read_text(encoding="utf-8", errors="replace"))
    pytest.fail(f"timed out waiting for the loopback service; log={excerpt}")


def _register(email: str, password: str) -> None:
    request = urllib.request.Request(
        f"http://127.0.0.1:{API_PORT}/auth/register",
        data=json.dumps({"email": email, "password": password}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            status = response.status
            response.read()
    except urllib.error.HTTPError as exc:
        pytest.fail(f"disposable registration failed with status {exc.code}")
    except Exception:
        pytest.fail("disposable registration could not reach the loopback API")
    if status != 200:
        pytest.fail(f"disposable registration failed with status {status}")


def _verify_disposable_connection(url: str):
    from sqlalchemy import create_engine, text

    engine = None
    try:
        engine = create_engine(url, pool_pre_ping=True)
        with engine.connect() as connection:
            database = connection.execute(text("SELECT current_database()")).scalar()
            revision = connection.execute(text("SELECT version_num FROM alembic_version")).scalar()
    except Exception:
        if engine is not None:
            engine.dispose()
        pytest.fail("disposable database connection failed")
    if database != DISPOSABLE_DATABASE or revision != ALEMBIC_HEAD:
        engine.dispose()
        pytest.fail("disposable browser database did not match the expected name and revision")
    return engine


@pytest.fixture(scope="function")
def disposable_api(monkeypatch):
    web_url = _loopback_url(os.environ.get("P0B_WEB_URL", f"http://127.0.0.1:{WEB_PORT}"), WEB_PORT, "P0B_WEB_URL")
    api_url = _loopback_url(os.environ.get("P0B_API_URL", f"http://127.0.0.1:{API_PORT}"), API_PORT, "P0B_API_URL")
    provided_email = os.environ.get("P0B_TRADER_EMAIL", "")
    password = os.environ.get("P0B_TRADER_PASSWORD", "")
    owner_url = os.environ.get("P0B_DISPOSABLE_DATABASE_URL", "")
    app_url = os.environ.get("P0B_APP_DATABASE_URL", "")
    if not provided_email or not password or not owner_url or not app_url:
        pytest.fail("disposable trader and database configuration is required")
    email = _fresh_designated_email(provided_email)
    monkeypatch.setenv("P0B_TRADER_EMAIL", email)
    owner_url = _require_database_url(owner_url, None)
    app_url = _require_database_url(app_url, "fintech_app")
    if _port_open(API_PORT) or _port_open(WEB_PORT):
        pytest.fail("loopback API or web port is already in use; refusing to attach to an existing process")
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if not npm:
        pytest.fail("npm was not found on PATH")

    owner_engine = _verify_disposable_connection(owner_url)
    app_engine = _verify_disposable_connection(app_url)
    app_engine.dispose()

    log_dir = Path(tempfile.mkdtemp(prefix="p0b-browser-"))
    api_log_path = log_dir / "api.log"
    web_log_path = log_dir / "web.log"
    api_log = open(api_log_path, "w", encoding="utf-8", buffering=1)
    web_log = open(web_log_path, "w", encoding="utf-8", buffering=1)
    api_env = os.environ.copy()
    for key in ("P0B_TRADER_PASSWORD", "P0B_DISPOSABLE_DATABASE_URL", "P0B_APP_DATABASE_URL"):
        api_env.pop(key, None)
    api_env.update({
        "PYTHONUNBUFFERED": "1",
        "DATABASE_URL": app_url,
        "MIGRATION_DATABASE_URL": owner_url,
        "JWT_SECRET": DISPOSABLE_JWT_SECRET,
        "SCHEDULED_JOBS_ENABLED": "false",
        "MFA_REQUIRED": "false",
        "RATE_LIMIT_ENABLED": "false",
        "REFRESH_COOKIE_SECURE": "false",
        "ENABLE_API_DOCS": "false",
        "TRADING_HALTED": "false",
        "CORS_ORIGINS": "[\"http://127.0.0.1:4173\"]",
        "ALPHA_VANTAGE_API_KEY": "",
    })
    web_env = {
        key: value
        for key, value in os.environ.items()
        if "DATABASE" not in key and "PASSWORD" not in key and "SECRET" not in key and not key.startswith("P0B_")
    }
    api = None
    web = None
    try:
        api = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "isolated_api:app", "--app-dir", str(REPO_ROOT / "tests" / "browser"), "--host", "127.0.0.1", "--port", str(API_PORT)],
            cwd=REPO_ROOT,
            env=api_env,
            stdout=api_log,
            stderr=subprocess.STDOUT,
            **_service_popen_kwargs(),
        )
        web = subprocess.Popen(
            [
                npm,
                "run",
                "preview",
                "--",
                "--host",
                "127.0.0.1",
                "--port",
                str(WEB_PORT),
                "--strictPort",
            ],
            cwd=REPO_ROOT / "frontend",
            env=web_env,
            stdout=web_log,
            stderr=subprocess.STDOUT,
            **_service_popen_kwargs(),
        )
        _wait_http(f"{api_url}/health", api, api_log_path)
        _wait_http(f"{web_url}/", web, web_log_path)
        _register(email, password)
        yield _DisposableApi(api_log_path, owner_engine, email, web_url, api_url)
    finally:
        if api is not None:
            _stop_process(api)
        if web is not None:
            _stop_process(web)
        api_log.close()
        web_log.close()
        owner_engine.dispose()
        shutil.rmtree(log_dir, ignore_errors=True)


def _driver() -> webdriver.Chrome:
    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--disable-gpu")
    options.add_argument("--window-size=1280,800")
    options.add_argument("--window-position=0,0")
    driver = webdriver.Chrome(options=options)
    driver.set_window_size(*VIEWPORT)
    driver.set_page_load_timeout(30)
    driver.set_script_timeout(20)
    return driver


def _wait(driver: webdriver.Chrome) -> WebDriverWait:
    return WebDriverWait(driver, 20)


def _bundle(driver: webdriver.Chrome) -> str:
    source = driver.page_source
    start = source.find("/assets/index-")
    if start < 0:
        return "bundle-not-found"
    end = source.find('"', start)
    return source[start:end]


def _viewport(driver: webdriver.Chrome) -> dict[str, int]:
    size = driver.execute_script("return {width: window.innerWidth, height: window.innerHeight};")
    return {"width": int(size["width"]), "height": int(size["height"])}


def _install_order_hook(driver: webdriver.Chrome, api_url: str) -> None:
    driver.execute_script(
        """
        if (window.__p0bHook) { return; }
        window.__p0bHook = true;
        window.__p0bOrders = [];
        const apiBase = String(arguments[0]).replace(/\\/$/, "");
        const vault = [];
        const origOpen = XMLHttpRequest.prototype.open;
        const origSend = XMLHttpRequest.prototype.send;
        const origSet = XMLHttpRequest.prototype.setRequestHeader;
        function header(headers, name) {
          const match = Object.keys(headers).find((key) => key.toLowerCase() === name);
          return match ? String(headers[match]) : "";
        }
        XMLHttpRequest.prototype.open = function(method, url) {
          let absolute = String(url);
          if (absolute.startsWith("/")) { absolute = apiBase + absolute; }
          this.__p0b = { method: method, url: absolute, headers: {} };
          return origOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
          if (this.__p0b) { this.__p0b.headers[name] = value; }
          return origSet.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function(body) {
          const meta = this.__p0b;
          if (meta) { meta.body = body; }
          this.addEventListener("loadend", function() {
            if (!meta || String(meta.method).toUpperCase() !== "POST" || !String(meta.url).includes("/orders")) {
              return;
            }
            const authorization = header(meta.headers, "authorization");
            const idempotencyKey = header(meta.headers, "idempotency-key");
            const contentType = header(meta.headers, "content-type");
            let orderId = null;
            let orderStatus = null;
            try {
              const parsed = JSON.parse(String(this.responseText || ""));
              if (parsed && typeof parsed === "object") {
                orderId = parsed.id == null ? null : parsed.id;
                orderStatus = parsed.status == null ? null : parsed.status;
              }
            } catch (error) {
              orderId = null;
            }
            const kind = String(meta.url).replace(/\\/$/, "").endsWith("/orders") ? "create" : "other";
            if (kind === "create") {
              vault.push({
                url: meta.url,
                body: meta.body == null ? "" : String(meta.body),
                authorization: authorization,
                idempotencyKey: idempotencyKey,
                contentType: contentType,
              });
            }
            window.__p0bOrders.push({
              kind: kind,
              status: this.status,
              orderId: orderId,
              orderStatus: orderStatus,
              hasAuthorization: Boolean(authorization),
              hasIdempotencyKey: Boolean(idempotencyKey),
            });
          });
          return origSend.apply(this, arguments);
        };
        window.__p0bReplay = function(index) {
          const item = vault[index];
          if (!item) { return Promise.resolve({status: 0, id: null}); }
          vault[index] = null;
          return new Promise((resolve) => {
            const xhr = new XMLHttpRequest();
            xhr.open("POST", item.url);
            xhr.setRequestHeader("Content-Type", item.contentType || "application/json");
            xhr.setRequestHeader("Idempotency-Key", item.idempotencyKey);
            xhr.setRequestHeader("Authorization", item.authorization);
            xhr.onloadend = function() {
              let id = null;
              try {
                const parsed = JSON.parse(String(xhr.responseText || ""));
                id = parsed && parsed.id != null ? parsed.id : null;
              } catch (error) {
                id = null;
              }
              resolve({status: xhr.status, id: id});
            };
            xhr.send(item.body);
          });
        };
        """,
        api_url,
    )


def _order_summary(driver: webdriver.Chrome) -> list[dict]:
    return driver.execute_script(
        """
        return (window.__p0bOrders || []).filter((item) => item.kind === "create").map((item) => ({
          status: item.status,
          orderId: item.orderId,
          orderStatus: item.orderStatus,
          hasAuthorization: Boolean(item.hasAuthorization),
          hasIdempotencyKey: Boolean(item.hasIdempotencyKey),
        }));
        """
    )


def _money_after(driver: webdriver.Chrome, label: str) -> str:
    return driver.execute_script(
        """
        const label = arguments[0];
        const ownText = (node) => Array.from(node.childNodes)
          .filter((child) => child.nodeType === Node.TEXT_NODE)
          .map((child) => child.textContent)
          .join("")
          .trim();
        const nodes = Array.from(document.querySelectorAll("div"));
        const match = nodes.find((node) => ownText(node) === label);
        if (!match) { return ""; }
        const next = match.nextElementSibling;
        return next ? next.textContent.trim() : "";
        """,
        label,
    )


def _click(driver: webdriver.Chrome, element) -> None:
    driver.execute_script("arguments[0].scrollIntoView({block: 'center', inline: 'nearest'});", element)
    try:
        element.click()
    except ElementClickInterceptedException:
        driver.execute_script("arguments[0].click();", element)


def _sign_in(driver: webdriver.Chrome, web: str, email: str, password: str, destination: str | None = "/dashboard") -> None:
    driver.get(web + "/login")
    _wait(driver).until(EC.presence_of_element_located((By.CSS_SELECTOR, "input[aria-label='Email']")))
    driver.find_element(By.CSS_SELECTOR, "input[aria-label='Email']").send_keys(email)
    driver.find_element(By.CSS_SELECTOR, "input[aria-label='Password']").send_keys(password)
    driver.find_element(By.CSS_SELECTOR, "button[aria-label='Sign in']").click()
    if destination is None:
        _wait(driver).until(lambda current: "/login" not in current.current_url)
        return
    _wait(driver).until(EC.url_contains(destination))
    if destination == "/dashboard":
        _wait(driver).until(EC.presence_of_element_located((By.XPATH, "//*[normalize-space()='Trading & Risk Overview']")))


def _refresh_cookie_present(driver: webdriver.Chrome) -> bool:
    return any(cookie.get("name") == "refresh_token" and cookie.get("value") for cookie in driver.get_cookies())


def _status_events(log_text: str) -> list[dict]:
    events = []
    for method, path, status in ACCESS_EVENT.findall(log_text):
        events.append({"method": method, "path": path.split("?", 1)[0], "status": int(status)})
    return events


def _log_from(path: Path, offset: int) -> str:
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        handle.seek(offset)
        return handle.read()


def _arm_expired_access_token(driver: webdriver.Chrome, engine, email: str) -> int:
    import jwt
    from sqlalchemy import text

    try:
        with engine.begin() as connection:
            database = connection.execute(text("SELECT current_database()")).scalar()
            if database != DISPOSABLE_DATABASE:
                pytest.fail("refusing to revoke refresh tokens outside the disposable browser database")
            user_id = connection.execute(
                text("SELECT id FROM users WHERE email = :email"),
                {"email": email},
            ).scalar()
            if user_id is None:
                pytest.fail("designated trader is missing from the disposable browser database")
            revoked = connection.execute(
                text(
                    """
                    UPDATE refresh_tokens
                    SET revoked_at = CURRENT_TIMESTAMP
                    WHERE revoked_at IS NULL
                      AND user_id = :user_id
                    """
                ),
                {"user_id": user_id},
            ).rowcount
    except Exception:
        pytest.fail("disposable refresh-token revoke failed")
    if not revoked:
        pytest.fail("no active refresh token was revoked on the disposable browser database")

    expired = jwt.encode(
        {"sub": str(user_id), "exp": int(time.time()) - 300},
        DISPOSABLE_JWT_SECRET,
        algorithm="HS256",
    )
    if isinstance(expired, bytes):
        expired = expired.decode("ascii")
    payload = jwt.decode(expired, DISPOSABLE_JWT_SECRET, algorithms=["HS256"], options={"verify_exp": False})
    if int(payload["exp"]) >= int(time.time()) - 60:
        pytest.fail("probe token is not expired")
    try:
        clicked = driver.execute_script(
            """
            const expiredToken = arguments[0];
            window.__p0bStay = 1;
            window.__p0bExpiredAuthorization = 0;
            const previous = XMLHttpRequest.prototype.setRequestHeader;
            XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
              if (String(name).toLowerCase() === "authorization") {
                const replacement = "Bearer " + expiredToken;
                if (String(value) !== replacement) { window.__p0bExpiredAuthorization += 1; }
                value = replacement;
              }
              return previous.call(this, name, value);
            };
            const link = Array.from(document.querySelectorAll("a")).find((node) => (node.textContent || "").trim() === "Trades");
            if (!link) { return "missing-trades-link"; }
            link.click();
            return "clicked";
            """,
            expired,
        )
    except Exception:
        pytest.fail("could not install the expired-access-token probe")
    if clicked != "clicked":
        pytest.fail("trades link was not available for the in-app navigation")
    replaced = driver.execute_script("return window.__p0bExpiredAuthorization || 0")
    return int(replaced)


def _wait_for_events(log_path: Path, offset: int) -> list[dict]:
    deadline = time.time() + 10
    events: list[dict] = []
    while time.time() < deadline:
        events = _status_events(_log_from(log_path, offset))
        protected = [event for event in events if event["status"] == 401 and not event["path"].startswith("/auth/")]
        refresh = [
            event for event in events
            if event["status"] == 401 and event["method"] == "POST" and event["path"].rstrip("/") == "/auth/refresh"
        ]
        if protected and refresh:
            return events
        time.sleep(0.25)
    return events


def _normalized_body(driver: webdriver.Chrome) -> str:
    try:
        return " ".join(driver.find_element(By.TAG_NAME, "body").text.split())
    except Exception:
        return ""


def _has_low_label(text: str) -> bool:
    return re.search(r"(?<![A-Za-z])Low(?![A-Za-z])", text) is not None


def _risk_gauge_present(driver: webdriver.Chrome) -> bool:
    return bool(driver.find_elements(By.CSS_SELECTOR, "[role='img'][aria-label^='Risk score ']"))


def _risk_empty_ready(driver: webdriver.Chrome) -> bool:
    text = _normalized_body(driver)
    return (
        "No trade assessments yet." in text
        and "No assessment alerts." in text
        and "Risk assessments could not be loaded" not in text
        and not _has_low_label(text)
        and not _risk_gauge_present(driver)
    )


def _risk_error_ready(driver: webdriver.Chrome) -> bool:
    text = _normalized_body(driver)
    return (
        "Risk assessments could not be loaded" in text
        and "No trade assessments yet." not in text
        and "No assessment alerts." not in text
        and not _has_low_label(text)
        and not _risk_gauge_present(driver)
    )


def _orders_shell_shows_details(driver: webdriver.Chrome, symbol: str) -> bool:
    result = driver.execute_script(
        """
        const symbol = arguments[0];
        const orders = Array.from(document.querySelectorAll("section")).find((section) =>
          Array.from(section.querySelectorAll("h2")).some((heading) => heading.textContent.trim() === "Recent Orders")
        );
        if (!orders) { return {pending: true}; }
        const shell = orders.querySelector(".table-shell");
        const root = document.documentElement;
        const main = document.querySelector("main");
        if (!shell || !main) { return {pending: true}; }
        const headerRow = orders.querySelector("thead tr")
          || Array.from(orders.querySelectorAll("tr")).find((candidate) => candidate.querySelector("th"));
        if (!headerRow) { return {pending: true}; }
        const headings = Array.from(headerRow.cells).map((cell) => cell.textContent.replace(/\\s+/g, " ").trim());
        const targets = [
          {label: "Remaining", expected: "1"},
          {label: "Status", expected: "open"},
          {label: "Limit", expected: "$100.00"},
        ];
        const indexes = targets.map((target) => headings.indexOf(target.label));
        if (indexes.some((index) => index < 0)) { return {pending: true}; }
        const dataRows = Array.from(orders.querySelectorAll("tbody tr"));
        const candidates = dataRows.length
          ? dataRows
          : Array.from(orders.querySelectorAll("tr")).filter((candidate) => candidate.querySelector("td"));
        const row = candidates.find((candidate) => {
          const cells = Array.from(candidate.cells);
          return cells.length === 6 && Array.from(cells[0].querySelectorAll("div")).some((node) =>
            node.textContent.replace(/\\s+/g, " ").trim() === symbol
          );
        });
        if (!row) { return {pending: true}; }
        const box = (rect) => ({
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          right: Math.round(rect.right),
          bottom: Math.round(rect.bottom),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
        const fullyInside = (rect, bounds) => rect.width > 0
          && rect.height > 0
          && rect.left >= bounds.left - 1
          && rect.right <= bounds.right + 1
          && rect.top >= bounds.top - 1
          && rect.bottom <= bounds.bottom + 1;
        for (let index = 0; index < targets.length; index += 1) {
          const target = targets[index];
          const cell = row.cells[indexes[index]];
          if (!cell) { return {pending: true}; }
          cell.scrollIntoView({block: "nearest", inline: "nearest", behavior: "instant"});
          const rect = cell.getBoundingClientRect();
          const shellRect = shell.getBoundingClientRect();
          const text = cell.textContent.replace(/\\s+/g, " ").trim();
          const textOk = target.label === "Status" ? text.toLowerCase() === target.expected : text === target.expected;
          if (!text) { return {pending: true}; }
          if (!textOk) { return {pending: false, ok: false, reason: "text"}; }
          const view = {left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight};
          const shellOk = fullyInside(rect, shellRect);
          const viewOk = fullyInside(rect, view);
          const overflowOk = root.scrollWidth <= root.clientWidth && main.scrollWidth <= main.clientWidth;
          if (!shellOk || !viewOk || !overflowOk) {
            return {
              pending: false,
              ok: false,
              reason: overflowOk ? "bounds" : "overflow",
              geometry: {
                column: target.label,
                shellOk: shellOk,
                viewOk: viewOk,
                overflowOk: overflowOk,
                cell: box(rect),
                shell: box(shellRect),
                viewport: {width: window.innerWidth, height: window.innerHeight},
                rootScrollWidth: root.scrollWidth,
                rootClientWidth: root.clientWidth,
                mainScrollWidth: main.scrollWidth,
                mainClientWidth: main.clientWidth,
              },
            };
          }
        }
        return {ok: true};
        """,
        symbol,
    )
    if not isinstance(result, dict) or result.get("pending"):
        return False
    if result.get("ok"):
        return True
    if result.get("reason") == "text":
        pytest.fail("orders mobile detail cell text did not match")
    message = (
        "orders mobile detail overflowed the page"
        if result.get("reason") == "overflow"
        else "orders mobile detail cell was not fully inside the shell"
    )
    geometry = result.get("geometry")
    if geometry:
        pytest.fail(message + " " + json.dumps(geometry, sort_keys=True))
    pytest.fail(message)


def _orders_shell_scroll_reset(driver: webdriver.Chrome) -> bool:
    try:
        return bool(driver.execute_script(
            """
            const orders = Array.from(document.querySelectorAll("section")).find((section) =>
              Array.from(section.querySelectorAll("h2")).some((heading) => heading.textContent.trim() === "Recent Orders")
            );
            const shell = orders && orders.querySelector(".table-shell");
            if (!shell) { return false; }
            shell.scrollLeft = 0;
            return shell.scrollLeft === 0;
            """
        ))
    except Exception:
        return False


def _owner_activity_counts(engine, email: str) -> dict[str, int]:
    """Owner-scoped row counts. Failures stay redacted to counts and statuses."""
    from sqlalchemy import text

    tables = ("orders", "trades", "holdings", "lots", "ledger_entries", "order_requests")
    database = None
    user_id = None
    raw: list[int] = []
    try:
        with engine.connect() as connection:
            database = connection.execute(text("SELECT current_database()")).scalar()
            if database != DISPOSABLE_DATABASE:
                user_id = None
            else:
                user_id = connection.execute(
                    text("SELECT id FROM users WHERE email = :email"),
                    {"email": email},
                ).scalar()
                if user_id is not None:
                    for table in tables:
                        raw.append(int(connection.execute(
                            text(f"SELECT COUNT(*) FROM {table} WHERE user_id = :user_id"),
                            {"user_id": user_id},
                        ).scalar() or 0))
    except Exception:
        pytest.fail("owner activity count failed")
    if database != DISPOSABLE_DATABASE:
        pytest.fail("refusing to read activity counts outside the disposable browser database")
    if user_id is None:
        pytest.fail("designated trader is missing from the disposable browser database")
    return dict(zip(tables, raw, strict=True))


def _preview_fields(driver: webdriver.Chrome) -> dict | None:
    """Preview dt/dd values. The label is the dt's own text, not a nested detail span."""
    found = driver.execute_script(
        """
        const heading = Array.from(document.querySelectorAll("h3")).find((node) => node.textContent.trim() === "Order preview");
        const root = heading && (heading.closest("section, form") || heading.parentElement);
        if (!root) { return null; }
        const own = (node) => Array.from(node.childNodes)
          .filter((child) => child.nodeType === Node.TEXT_NODE)
          .map((child) => child.textContent)
          .join(" ")
          .replace(/\\s+/g, " ")
          .trim();
        const values = {};
        for (const dt of root.querySelectorAll("dt")) {
          const label = own(dt);
          const dd = dt.nextElementSibling;
          if (!label || !dd || dd.tagName !== "DD") { continue; }
          values[label] = (dd.textContent || "").replace(/[$,\\s]/g, "");
        }
        return {ready: (root.innerText || "").includes("Preview ready"), values: values};
        """
    )
    if not isinstance(found, dict) or not isinstance(found.get("values"), dict):
        return None
    return {
        "ready": bool(found.get("ready")),
        "values": {str(label): str(value) for label, value in found["values"].items()},
    }


def _preview_has_values(driver: webdriver.Chrome, expected: dict[str, str]) -> bool:
    fields = _preview_fields(driver)
    if not fields or not fields["ready"]:
        return False
    return all(fields["values"].get(label) == value for label, value in expected.items())


def _order_preview_ready(driver: webdriver.Chrome) -> bool:
    return _preview_has_values(driver, {
        "Initial reservation": "100.00",
        "Estimated fill quantity": "0.000000",
        "Estimated fill notional": "0.00",
        "Unfilled quantity": "1.000000",
    })


def test_local_designated_trader_journey(disposable_api: _DisposableApi) -> None:
    from datetime import datetime, timezone
    from decimal import Decimal
    from sqlalchemy.orm import Session
    from app.models.market_quote_cache import MarketQuoteCache
    from app.models.market_symbol import MarketSymbol

    email = disposable_api.email
    password = os.environ.get("P0B_TRADER_PASSWORD", "")
    web = disposable_api.web_url
    if not password:
        pytest.fail("P0B_TRADER_PASSWORD is required")

    quoted_at = datetime.now(timezone.utc).replace(tzinfo=None)
    with Session(disposable_api.engine) as db:
        item = db.get(MarketSymbol, SYMBOL)
        if item is None:
            item = MarketSymbol(symbol=SYMBOL, company_name="Fixture company", exchange="NASDAQ")
            db.add(item)
        item.company_name = "Fixture company"
        item.exchange = "NASDAQ"
        item.sector = "Technology"
        item.is_active = True
        item.is_test = False
        item.is_etf = False
        item.refresh_tier = "hot"
        db.flush()
        quote = db.get(MarketQuoteCache, SYMBOL)
        if quote is None:
            quote = MarketQuoteCache(symbol=SYMBOL)
            db.add(quote)
        quote.price = Decimal(100)
        quote.change_amount = 0
        quote.change_percent = Decimal(0)
        quote.volume = 100
        quote.source = "fixture"
        quote.quote_at = quoted_at
        quote.fetched_at = quoted_at
        db.commit()

    driver = _driver()
    try:
        driver.get(web + "/")
        _wait(driver).until(EC.presence_of_element_located((By.XPATH, "//*[normalize-space()='Public dashboard']")))
        login = _wait(driver).until(EC.element_to_be_clickable((By.LINK_TEXT, "Log in")))
        assert login.get_attribute("href").endswith("/login")
        bundle = _bundle(driver)
        viewport = _viewport(driver)

        driver.get(web + "/dashboard")
        _wait(driver).until(EC.presence_of_element_located((By.XPATH, "//*[normalize-space()='Public dashboard']")))
        assert driver.current_url.rstrip("/").endswith("/dashboard")
        driver.find_element(By.LINK_TEXT, "Log in").click()
        _wait(driver).until(EC.url_contains("/login"))
        assert driver.find_element(By.CSS_SELECTOR, "button[aria-label='Sign in']").is_displayed()

        driver.get(web + "/market")
        _wait(driver).until(EC.presence_of_element_located((By.XPATH, "//*[normalize-space()='Market dashboard']")))
        assert "/market" in driver.current_url

        _sign_in(driver, web, email, password)
        _wait(driver).until(lambda current: _money_after(current, "Cash") == "$100,000")
        assert _money_after(driver, "Buying power") == "$100,000"

        driver.get(web + "/trades")
        _wait(driver).until(EC.presence_of_element_located((By.CSS_SELECTOR, "input[aria-label='Trade symbol']")))
        ticket_dir = REPO_ROOT / ".local-tools" / "p3b-ticket"
        ticket_dir.mkdir(parents=True, exist_ok=True)
        _wait(driver).until(EC.visibility_of_element_located((By.XPATH, "//*[normalize-space()='Order Management']")))
        _wait(driver).until(EC.visibility_of_element_located((By.XPATH, "//*[normalize-space()='Order Entry']")))
        driver.save_screenshot(str(ticket_dir / "ticket-initial-desktop.png"))
        driver.set_window_size(390, 844)
        _wait(driver).until(lambda current: _viewport(current)["width"] <= 390 and current.execute_script("""
            const input = document.querySelector("input[aria-label='Trade symbol']");
            if (!input) { return false; }
            const limit = () => Array.from(document.querySelectorAll("header, [class*='sticky']")).reduce((max, node) => {
              const style = getComputedStyle(node);
              const box = node.getBoundingClientRect();
              if ((style.position !== "sticky" && style.position !== "fixed") || box.bottom <= 0 || box.top > 0) { return max; }
              return Math.max(max, box.bottom);
            }, 0);
            const shown = () => {
              const box = input.getBoundingClientRect();
              return box.width > 0 && box.height > 0 && box.top >= limit() - 1 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth;
            };
            window.scrollTo(0, 0);
            if (shown()) { return true; }
            window.scrollTo(0, Math.max(0, input.getBoundingClientRect().top + window.scrollY - limit() - 8));
            return shown();
        """))
        widths = driver.execute_script("const root=document.documentElement,body=document.body,main=document.querySelector('main');return body&&main?{rootScroll:root.scrollWidth,rootClient:root.clientWidth,bodyScroll:body.scrollWidth,bodyClient:body.clientWidth,mainScroll:main.scrollWidth,mainClient:main.clientWidth}:null;")
        driver.save_screenshot(str(ticket_dir / "ticket-initial-mobile.png"))
        assert isinstance(widths, dict) and widths["rootScroll"] <= widths["rootClient"] and widths["bodyScroll"] <= widths["bodyClient"] and widths["mainScroll"] <= widths["mainClient"], widths
        driver.set_window_size(*VIEWPORT)
        driver.execute_script("window.scrollTo({top:0,left:0,behavior:'instant'});")
        _wait(driver).until(lambda current: _viewport(current)["width"] >= 1200 and EC.element_to_be_clickable((By.CSS_SELECTOR, "input[aria-label='Trade symbol']"))(current))
        _install_order_hook(driver, disposable_api.api_url)
        driver.find_element(By.CSS_SELECTOR, "input[aria-label='Trade symbol']").send_keys(SYMBOL)
        driver.find_element(By.CSS_SELECTOR, "input[aria-label='Trade quantity']").send_keys("1")
        driver.find_element(By.CSS_SELECTOR, "input[aria-label='Limit price']").send_keys("100")
        before_preview = _owner_activity_counts(disposable_api.engine, email)
        _click(driver, driver.find_element(By.CSS_SELECTOR, "button[aria-label='Preview order']"))
        try:
            _wait(driver).until(_order_preview_ready)
        except TimeoutException:
            captured = driver.execute_script(
                "return (window.__p0bOrders || []).map((item) => ({kind: item.kind, status: item.status}));"
            )
            pytest.fail(f"preview was not ready; statuses={captured}")
        created = _order_summary(driver)
        if created:
            pytest.fail("preview posted an order: " + json.dumps({
                "count": len(created),
                "statuses": [item["status"] for item in created],
            }))
        after_preview = _owner_activity_counts(disposable_api.engine, email)
        if after_preview != before_preview:
            pytest.fail("owner activity changed before an order: " + json.dumps({
                "before": before_preview,
                "after": after_preview,
            }))
        confirm = _wait(driver).until(EC.visibility_of_element_located((By.CSS_SELECTOR, "button[aria-label='Confirm paper order']")))
        driver.execute_script(
            """
            const node = arguments[0];
            const offset = Array.from(document.querySelectorAll("header, [class*='sticky']")).reduce((max, bar) => {
              const style = getComputedStyle(bar);
              const box = bar.getBoundingClientRect();
              if ((style.position !== "sticky" && style.position !== "fixed") || box.bottom <= 0 || box.top > 0) { return max; }
              return Math.max(max, box.bottom);
            }, 0);
            const box = node.getBoundingClientRect();
            if (box.top < offset || box.bottom > window.innerHeight) {
              window.scrollTo(0, Math.max(0, box.top + window.scrollY - offset - 8));
            }
            node.focus();
            """,
            confirm,
        )
        _wait(driver).until(lambda current: current.switch_to.active_element.get_attribute("aria-label") == "Confirm paper order")
        driver.switch_to.active_element.send_keys(Keys.ENTER)
        try:
            _wait(driver).until(EC.presence_of_element_located((By.XPATH, f"//button[starts-with(@aria-label, 'Cancel {SYMBOL} order ')]")))
        except TimeoutException:
            captured = driver.execute_script(
                "return (window.__p0bOrders || []).map((item) => ({kind: item.kind, status: item.status}));"
            )
            toasts = driver.execute_script(
                "return Array.from(document.querySelectorAll('.toast-item')).map((node) => node.innerText.slice(0, 180));"
            )
            pytest.fail(f"resting order was not opened; statuses={captured}; toasts={toasts}")
        summary = _order_summary(driver)
        redacted = {
            "count": len(summary),
            "statuses": [item["status"] for item in summary],
        }
        if len(summary) != 1 or summary[0]["status"] != 200 or summary[0]["orderStatus"] != "open":
            pytest.fail(f"order capture mismatch: {json.dumps(redacted)}")
        if not summary[0]["hasAuthorization"] or not summary[0]["hasIdempotencyKey"]:
            pytest.fail("captured order was missing authorization or idempotency metadata")
        order_id = summary[0]["orderId"]

        try:
            replay = driver.execute_async_script(
                """
                const done = arguments[0];
                if (!window.__p0bReplay) { done({status: 0, id: null}); return; }
                window.__p0bReplay(0).then(
                  (result) => done({status: result.status, id: result.id}),
                  () => done({status: 0, id: null})
                );
                """
            )
        except TimeoutException:
            pytest.fail("idempotency replay did not return a status")
        if replay["status"] != 200 or replay["id"] != order_id:
            pytest.fail(json.dumps({
                "replay_status": replay["status"],
                "same_order": replay["id"] == order_id,
            }))
        driver.refresh()
        _wait(driver).until(EC.presence_of_element_located((By.XPATH, f"//button[@aria-label='Cancel {SYMBOL} order {order_id}']")))
        rows = driver.find_elements(By.XPATH, f"//td[normalize-space()='{SYMBOL}']")
        assert len(rows) == 1

        driver.get(web + "/dashboard")
        _wait(driver).until(lambda current: _money_after(current, "Buying power") == "$99,900")
        assert _money_after(driver, "Cash") == "$100,000"
        # Orders load on their own query and must not wait on portfolio totals.
        _wait(driver).until(lambda current: current.execute_script(
            """
            const symbol = arguments[0];
            const orders = Array.from(document.querySelectorAll("section")).find((section) =>
              Array.from(section.querySelectorAll("h2")).some((heading) => heading.textContent.trim() === "Recent Orders")
            );
            if (!orders) { return false; }
            const headerRow = orders.querySelector("thead tr")
              || Array.from(orders.querySelectorAll("tr")).find((row) => row.querySelector("th"));
            if (!headerRow) { return false; }
            const headings = Array.from(headerRow.cells).map((cell) => cell.textContent.replace(/\\s+/g, " ").trim());
            if (headings.join("|") !== "Symbol|Side / type|Qty|Remaining|Status|Limit") { return false; }
            const link = Array.from(orders.querySelectorAll("a")).find((node) => node.textContent.trim() === "View orders");
            if (!link) { return false; }
            const href = link.getAttribute("href") || "";
            if (href !== "/trades" && !String(link.href || "").endsWith("/trades")) { return false; }
            const dataRows = Array.from(orders.querySelectorAll("tbody tr"));
            const candidates = dataRows.length
              ? dataRows
              : Array.from(orders.querySelectorAll("tr")).filter((candidate) => candidate.querySelector("td"));
            const row = candidates.find((candidate) => {
              const cells = Array.from(candidate.cells);
              if (cells.length !== 6) { return false; }
              return Array.from(cells[0].querySelectorAll("div")).some((node) => node.textContent.replace(/\\s+/g, " ").trim() === symbol);
            });
            if (!row) { return false; }
            const cells = Array.from(row.cells);
            const text = cells.map((cell) => cell.textContent.replace(/\\s+/g, " ").trim());
            return text[2] === "1"
              && text[3] === "1"
              && text[4].toLowerCase() === "open"
              && text[5] === "$100.00";
            """,
            SYMBOL,
        ))
        _wait(driver).until(lambda current: current.execute_script(
            """
            const section = Array.from(document.querySelectorAll("section")).find((node) =>
              Array.from(node.querySelectorAll("h2")).some((heading) => heading.textContent.trim() === "Portfolio Value")
            );
            if (!section) { return false; }
            const text = section.innerText || "";
            return text.includes("Valuation read") && text.includes("UTC") && !text.toLowerCase().includes("no date");
            """
        ))

        original_viewport = _viewport(driver)
        driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": True})
        _wait(driver).until(lambda current: _viewport(current)["width"] == 390 and current.execute_script(
            """
            const root = document.documentElement;
            const main = document.querySelector("main");
            return !!main
              && root.scrollWidth <= root.clientWidth
              && main.scrollWidth <= main.clientWidth;
            """
        ))
        assert _viewport(driver)["width"] == 390
        assert driver.execute_script(
            """
            const root = document.documentElement;
            const main = document.querySelector("main");
            return !!main
              && root.scrollWidth <= root.clientWidth
              && main.scrollWidth <= main.clientWidth;
            """
        )
        assert driver.execute_script(
            """
            const orders = Array.from(document.querySelectorAll("section")).find((section) =>
              Array.from(section.querySelectorAll("h2")).some((heading) => heading.textContent.trim() === "Recent Orders")
            );
            if (!orders) { return false; }
            orders.scrollIntoView({block: "center", inline: "nearest", behavior: "instant"});
            return true;
            """
        )
        _wait(driver).until(lambda current: current.execute_script(
            """
            const orders = Array.from(document.querySelectorAll("section")).find((section) =>
              Array.from(section.querySelectorAll("h2")).some((heading) => heading.textContent.trim() === "Recent Orders")
            );
            if (!orders) { return false; }
            const heading = Array.from(orders.querySelectorAll("h2")).find((node) => node.textContent.trim() === "Recent Orders");
            const row = orders.querySelector("tbody tr");
            if (!heading || !row) { return false; }
            const headingRect = heading.getBoundingClientRect();
            const rowRect = row.getBoundingClientRect();
            return headingRect.height > 0
              && rowRect.height > 0
              && headingRect.top >= 0
              && rowRect.bottom <= window.innerHeight;
            """
        ))
        orders_artifacts = REPO_ROOT / ".local-tools" / "p2-overview"
        orders_artifacts.mkdir(parents=True, exist_ok=True)
        driver.save_screenshot(str(orders_artifacts / "orders-mobile.png"))
        _wait(driver).until(lambda current: _orders_shell_shows_details(current, SYMBOL))
        driver.save_screenshot(str(orders_artifacts / "orders-mobile-details.png"))
        _wait(driver).until(_orders_shell_scroll_reset)
        driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {
            "width": int(original_viewport["width"]),
            "height": int(original_viewport["height"]),
            "deviceScaleFactor": 1,
            "mobile": False,
        })
        _wait(driver).until(lambda current: _viewport(current)["width"] == int(original_viewport["width"]))

        driver.get(web + "/trades")
        cancel = _wait(driver).until(EC.element_to_be_clickable((By.CSS_SELECTOR, f"button[aria-label='Cancel {SYMBOL} order {order_id}']")))
        _click(driver, cancel)
        _wait(driver).until(lambda current: current.execute_script(
            """
            const symbol = arguments[0];
            return Array.from(document.querySelectorAll("tr")).some((row) => {
              const cells = Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent.trim().toLowerCase());
              return cells.includes(symbol.toLowerCase()) && cells.includes("canceled");
            });
            """,
            SYMBOL,
        ))
        driver.get(web + "/dashboard")
        _wait(driver).until(lambda current: _money_after(current, "Buying power") == "$100,000")
        assert _money_after(driver, "Cash") == "$100,000"
        _wait(driver).until(lambda current: current.execute_script(
            """
            const symbol = arguments[0];
            const orders = Array.from(document.querySelectorAll("section")).find((section) =>
              Array.from(section.querySelectorAll("h2")).some((heading) => heading.textContent.trim() === "Recent Orders")
            );
            if (!orders) { return false; }
            const dataRows = Array.from(orders.querySelectorAll("tbody tr"));
            const candidates = dataRows.length
              ? dataRows
              : Array.from(orders.querySelectorAll("tr")).filter((candidate) => candidate.querySelector("td"));
            return candidates.some((candidate) => {
              const cells = Array.from(candidate.cells);
              if (cells.length !== 6) { return false; }
              const symbolDiv = Array.from(cells[0].querySelectorAll("div")).some(
                (node) => node.textContent.replace(/\\s+/g, " ").trim() === symbol
              );
              const status = cells[4].textContent.replace(/\\s+/g, " ").trim().toLowerCase();
              return symbolDiv && status === "canceled";
            });
            """,
            SYMBOL,
        ))

        driver.get(web + "/risk")
        try:
            WebDriverWait(driver, 40).until(_risk_empty_ready)
        except TimeoutException:
            pytest.fail("risk empty state did not finish")
        driver.save_screenshot(str(orders_artifacts / "risk-empty.png"))
        driver.execute_cdp_cmd("Network.enable", {})
        try:
            driver.execute_cdp_cmd("Network.setBlockedURLs", {"urls": ["*127.0.0.1:8000/risk/*"]})
            driver.get(web + "/risk")
            try:
                WebDriverWait(driver, 40).until(_risk_error_ready)
            except TimeoutException:
                pytest.fail("risk source error did not replace the empty state")
            driver.save_screenshot(str(orders_artifacts / "risk-error.png"))
            driver.execute_cdp_cmd("Network.setBlockedURLs", {"urls": []})
            retry = WebDriverWait(driver, 40).until(
                EC.element_to_be_clickable((By.XPATH, "//button[normalize-space()='Retry']"))
            )
            _click(driver, retry)
            try:
                WebDriverWait(driver, 40).until(_risk_empty_ready)
            except TimeoutException:
                pytest.fail("risk empty state did not recover after retry")
        finally:
            driver.execute_cdp_cmd("Network.setBlockedURLs", {"urls": []})

        _wait(driver).until(EC.element_to_be_clickable((By.LINK_TEXT, "Trades")))
        if not _refresh_cookie_present(driver):
            pytest.fail("refresh cookie was not present before the expired-token probe")
        log_offset = disposable_api.log_path.stat().st_size
        replaced = _arm_expired_access_token(driver, disposable_api.engine, email)
        if replaced < 1:
            pytest.fail("expired access token was not substituted on a protected request")
        _wait(driver).until(EC.url_contains("/login"))
        _wait(driver).until(EC.presence_of_element_located((By.CSS_SELECTOR, "input[aria-label='Email']")))
        stayed = driver.execute_script("return window.__p0bStay || 0")
        if stayed != 1:
            pytest.fail("expired-token navigation reloaded the document")
        page_text = driver.find_element(By.TAG_NAME, "body").text
        if "Trading & Risk Overview" in page_text or "$100,000" in page_text:
            pytest.fail("protected account data remained visible after the expired access token")
        events = _wait_for_events(disposable_api.log_path, log_offset)
        protected = [event for event in events if event["status"] == 401 and not event["path"].startswith("/auth/")]
        refresh_failed = [
            event for event in events
            if event["status"] == 401 and event["method"] == "POST" and event["path"].rstrip("/") == "/auth/refresh"
        ]
        if not protected or not refresh_failed:
            pytest.fail("expired-token statuses: " + json.dumps(events))

        _sign_in(driver, web, email, password, destination=None)
        if not _refresh_cookie_present(driver):
            pytest.fail("refresh cookie was not present before the missing-session navigation")
        driver.delete_all_cookies()
        driver.get(web + "/compliance")
        _wait(driver).until(EC.url_contains("/login"))
        _wait(driver).until(EC.presence_of_element_located((By.CSS_SELECTOR, "input[aria-label='Email']")))

        _sign_in(driver, web, email, password, destination="/compliance")
        driver.get(web + "/compliance")
        _wait(driver).until(EC.presence_of_element_located((
            By.XPATH,
            "//*[contains(., 'Compliance access is limited to compliance officers, admins, and auditors.')]",
        )))
        assert "/compliance" in driver.current_url
        compliance_events = [
            event for event in _status_events(disposable_api.log_path.read_text(encoding="utf-8", errors="replace"))
            if event["status"] == 403 and event["path"].startswith("/compliance")
        ]
        if not compliance_events:
            pytest.fail("trader compliance request did not return 403")

        print(json.dumps({
            "environment": "local",
            "web": web,
            "api": disposable_api.api_url,
            "bundle": bundle,
            "viewport": viewport,
            "viewport_source": "window.innerWidth/innerHeight",
            "account": email,
            "order_id": order_id,
            "replay_status": replay["status"],
            "replay_order_id": replay["id"],
            "cash_after_cancel": "$100,000",
            "buying_power_while_open": "$99,900",
            "risk_empty": "no_trade_assessments",
            "risk_source_error": "blocked_retry_recovered",
            "orders_mobile_details": "remaining_status_limit_in_shell",
            "expired_access_token": "login_required",
            "expired_authorization_replacements": replaced,
            "protected_401_count": len(protected),
            "refresh_401_count": len(refresh_failed),
            "missing_session": "/login",
            "compliance": "trader denied",
            "compliance_403_count": len(compliance_events),
        }, sort_keys=True))
    finally:
        driver.quit()


def test_cached_portfolio_incomplete_and_complete(disposable_api: _DisposableApi) -> None:
    """Exercise real nullable responses and their recovery on the isolated stack."""
    from datetime import datetime, timedelta, timezone
    from decimal import Decimal
    from uuid import uuid4

    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from app.models.asset import Asset
    from app.models.holding import Holding
    from app.models.market_quote_cache import MarketQuoteCache
    from app.models.market_symbol import MarketSymbol
    from app.models.user import User

    symbols = [f"P1A{uuid4().hex[:8].upper()}" for _ in range(2)]
    observed = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=1)
    with Session(disposable_api.engine) as db:
        user = db.execute(select(User).where(User.email == disposable_api.email)).scalar_one()
        assert user.cash_balance == Decimal("100000.00")
        for symbol in symbols:
            asset = Asset(symbol=symbol, asset_type="stock", name="P1-A browser fixture")
            db.add_all([asset, MarketSymbol(symbol=symbol, company_name="Fixture", exchange="NASDAQ")])
            db.flush()
            db.add(Holding(user_id=user.id, asset_id=asset.id, quantity=2, avg_cost=50))
        db.add(MarketQuoteCache(symbol=symbols[0], price=50, source="yahoo", quote_at=observed, fetched_at=observed))
        db.commit()

    driver = _driver()
    try:
        _sign_in(driver, disposable_api.web_url, disposable_api.email, os.environ["P0B_TRADER_PASSWORD"])
        _wait(driver).until(lambda current: "Valuation incomplete" in current.find_element(By.TAG_NAME, "body").text)
        value_card = driver.find_element(By.XPATH, "//section[.//h2[normalize-space()='Portfolio Value']]")
        value_text = " ".join(value_card.text.split())
        assert "Unavailable" in value_text
        assert "Valuation read" in value_text
        assert "UTC" in value_text
        assert "no date" not in value_text.casefold()
        assert "Real 1D" not in value_card.text
        assert not value_card.find_elements(By.CSS_SELECTOR, "svg[aria-label='Intraday portfolio value chart']")
        assert _money_after(driver, "Cash") == "$100,000"
        assert _money_after(driver, "Buying power") == "$100,000"
        assert "Unavailable" in _money_after(driver, "Total P&L")
        for symbol in symbols:
            row = driver.find_element(By.XPATH, f"//tr[.//*[normalize-space()='{symbol}']]")
            row_text = " ".join(row.text.split())
            assert "Low risk" not in row_text
            assert "Quote observed" in row_text
            if symbol == symbols[0]:
                assert "UTC" in row_text
        missing = driver.find_element(By.XPATH, f"//tr[.//*[normalize-space()='{symbols[1]}']]")
        missing_text = " ".join(missing.text.split())
        assert "Quote missing" in missing_text
        assert "Quote observed Unavailable" in missing_text

        driver.get(disposable_api.web_url + "/portfolio")
        _wait(driver).until(lambda current: "Valuation incomplete" in current.find_element(By.TAG_NAME, "body").text)
        assert "Unavailable" in _money_after(driver, "Portfolio value")
        assert "Unavailable" in _money_after(driver, "Total P&L")
        exposure = driver.find_element(By.XPATH, "//section[.//h2[normalize-space()='Exposure by asset']]")
        assert "%" not in exposure.text
        marked = driver.find_element(By.XPATH, f"//tr[.//*[normalize-space()='{symbols[0]}']]")
        assert "$50.00" in marked.text
        assert "$100.00" in marked.text

        with Session(disposable_api.engine) as db:
            db.add(MarketQuoteCache(symbol=symbols[1], price=50, source="yahoo", quote_at=observed, fetched_at=observed))
            db.commit()
        driver.refresh()
        _wait(driver).until(lambda current: _money_after(current, "Portfolio value") == "$100,200")
        assert "Valuation incomplete" not in driver.find_element(By.TAG_NAME, "body").text
        assert "$0.00" in _money_after(driver, "Total P&L")
        driver.get(disposable_api.web_url + "/dashboard")
        _wait(driver).until(lambda current: "$100,200" in current.find_element(By.TAG_NAME, "body").text)
        assert "Performance history unavailable" in driver.find_element(By.TAG_NAME, "body").text
        assert "Real 1D" not in driver.find_element(By.TAG_NAME, "body").text
        assert "Day P&L" not in driver.find_element(By.TAG_NAME, "body").text
        artifacts = REPO_ROOT / ".local-tools" / "p1a-browser"
        artifacts.mkdir(parents=True, exist_ok=True)
        driver.save_screenshot(str(artifacts / "dashboard-desktop.png"))
        driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": True})
        assert _viewport(driver)["width"] == 390
        _wait(driver).until(lambda current: current.execute_script(
            "const opener = document.querySelector('button[aria-label=\"Open navigation\"]'); return Boolean(opener && opener.getAttribute('aria-expanded') === 'false' && !document.querySelector('dialog[open]'));"
        ))
        driver.save_screenshot(str(artifacts / "dashboard-mobile.png"))
        assert driver.execute_script("return document.documentElement.scrollWidth <= document.documentElement.clientWidth")
        assert driver.execute_script("const main = document.querySelector('main'); return main.scrollWidth <= main.clientWidth")
        driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": 632, "height": 324, "deviceScaleFactor": 2, "mobile": False})
        assert _viewport(driver)["width"] == 632
        driver.save_screenshot(str(artifacts / "dashboard-reflow-200.png"))
        assert driver.execute_script("const main = document.querySelector('main'); return main.scrollWidth <= main.clientWidth")
        events = _status_events(disposable_api.log_path.read_text(encoding="utf-8", errors="replace"))
        assert not any(event["path"].rstrip("/") == "/portfolio/pnl" for event in events)
        print(json.dumps({"check": "P1-A real cached valuation", "incomplete": "passed", "recovered_complete": "passed", "viewport": _viewport(driver), "bundle": _bundle(driver)}))
    finally:
        driver.quit()


def test_public_cached_quotes_without_reference_fill(disposable_api: _DisposableApi) -> None:
    from datetime import datetime, timedelta, timezone
    from decimal import Decimal
    from sqlalchemy.orm import Session
    from app.models.market_quote_cache import MarketQuoteCache
    from app.models.market_symbol import MarketSymbol

    observed = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=1)
    with Session(disposable_api.engine) as db:
        for symbol, price, change, etf, age in (
            ("SPY", "123.45", "-1.5", True, 0),
            ("XLK", "100", "0", True, 0),
            ("P1PUBLIC", "10", "99", False, 10),
        ):
            item = db.get(MarketSymbol, symbol)
            if item is None:
                item = MarketSymbol(symbol=symbol, company_name="Browser fixture", exchange="NASDAQ")
                db.add(item)
            item.is_etf = etf
            item.sector = "Technology"
            if symbol == "P1PUBLIC":
                item.heatmap_size = "micro"
            db.flush()
            quote = db.get(MarketQuoteCache, symbol)
            if quote is None:
                quote = MarketQuoteCache(symbol=symbol)
                db.add(quote)
            quote.price = Decimal(price)
            quote.change_amount = 0
            quote.change_percent = Decimal(change)
            quote.volume = 100
            quote.source = "fixture"
            quote.quote_at = observed - timedelta(days=age)
            quote.fetched_at = observed
        db.commit()

    driver = _driver()
    try:
        driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": 1280, "height": 800, "deviceScaleFactor": 1, "mobile": False})
        _wait(driver).until(lambda current: _viewport(current)["width"] == 1280)
        driver.get(disposable_api.web_url + "/market")
        _wait(driver).until(lambda current: "$123.45" in current.find_element(By.TAG_NAME, "body").text)
        text = driver.find_element(By.TAG_NAME, "body").text
        assert "SPY" in text and "SPX" not in text
        assert "5,487.03" not in text
        assert "Provider change -1.50%" in text
        assert not driver.find_elements(By.CSS_SELECTOR, "svg[aria-label*='trend']")
        assert not driver.find_elements(By.CSS_SELECTOR, "button[aria-label*='market pulse trend']")
        stale = _wait(driver).until(EC.presence_of_element_located((By.XPATH, "//div[@title][.//*[normalize-space()='P1PUBLIC']]")))
        assert "Stale" in stale.text and "+99.00%" not in stale.text
        from selenium.common.exceptions import StaleElementReferenceException

        heatmap_artifacts = REPO_ROOT / ".local-tools" / "public-browser"
        heatmap_artifacts.mkdir(parents=True, exist_ok=True)
        tile_xpath = "//div[@title][.//*[normalize-space()='P1PUBLIC']]"

        def prove_heatmap_scales() -> None:
            for scale in ("compact", "standard", "expanded"):
                selector = f"button[aria-label='Set heatmap size to {scale}']"
                _wait(driver).until(EC.element_to_be_clickable((By.CSS_SELECTOR, selector)))
                driver.execute_script(
                    "document.querySelector(arguments[0]).scrollIntoView({block: 'center', inline: 'nearest', behavior: 'instant'});",
                    selector,
                )
                _click(driver, driver.find_element(By.CSS_SELECTOR, selector))
                driver.execute_script(
                    """
                    const tile = document.evaluate(
                      arguments[0], document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
                    ).singleNodeValue;
                    if (tile) { tile.scrollIntoView({block: "center", inline: "nearest", behavior: "instant"}); }
                    """,
                    tile_xpath,
                )

                def tile_visible(current) -> bool:
                    try:
                        found = current.find_elements(By.XPATH, tile_xpath)
                        if not found:
                            return False
                        visible = found[0].text
                    except StaleElementReferenceException:
                        return False
                    return "Stale" in visible and "+99" not in visible

                _wait(driver).until(tile_visible)
                visible = driver.find_element(By.XPATH, tile_xpath).text
                assert "Stale" in visible and "+99" not in visible
                assert driver.execute_script(
                    """
                    const tile = document.evaluate(
                      arguments[0], document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
                    ).singleNodeValue;
                    if (!tile) { return false; }
                    const nodes = Array.from(tile.querySelectorAll("*")).filter((node) => (node.innerText || "").trim());
                    const positive = nodes.length > 0 && nodes.every((node) => {
                      const rect = node.getBoundingClientRect();
                      return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0;
                    });
                    if (!positive) { return false; }
                    const status = tile.children[1];
                    if (!status || !(status.textContent || "").trim()) { return false; }
                    if (status.clientWidth < status.scrollWidth) { return false; }
                    const statusRect = status.getBoundingClientRect();
                    const tileRect = tile.getBoundingClientRect();
                    const tileStyle = window.getComputedStyle(tile);
                    const borderLeft = parseFloat(tileStyle.borderLeftWidth) || 0;
                    const borderRight = parseFloat(tileStyle.borderRightWidth) || 0;
                    const borderTop = parseFloat(tileStyle.borderTopWidth) || 0;
                    const borderBottom = parseFloat(tileStyle.borderBottomWidth) || 0;
                    const withinPadding = statusRect.width > 0
                      && statusRect.height > 0
                      && statusRect.left >= tileRect.left + borderLeft
                      && statusRect.right <= tileRect.right - borderRight
                      && statusRect.top >= tileRect.top + borderTop
                      && statusRect.bottom <= tileRect.bottom - borderBottom;
                    const withinViewport = statusRect.top >= 0
                      && statusRect.left >= 0
                      && statusRect.bottom <= window.innerHeight
                      && statusRect.right <= window.innerWidth;
                    return withinPadding && withinViewport;
                    """,
                    tile_xpath,
                )
                assert driver.execute_script(
                    "return document.documentElement.scrollWidth <= document.documentElement.clientWidth"
                )

        def scroll_heatmap_tile_into_view() -> None:
            driver.execute_script(
                """
                const tile = document.evaluate(
                  arguments[0], document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
                ).singleNodeValue;
                if (tile) { tile.scrollIntoView({block: "center", inline: "nearest", behavior: "instant"}); }
                """,
                tile_xpath,
            )
            _wait(driver).until(lambda current: current.execute_script(
                """
                const tile = document.evaluate(
                  arguments[0], document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
                ).singleNodeValue;
                if (!tile) { return false; }
                const rect = tile.getBoundingClientRect();
                return rect.width > 0
                  && rect.height > 0
                  && rect.top >= 0
                  && rect.left >= 0
                  && rect.bottom <= window.innerHeight
                  && rect.right <= window.innerWidth;
                """,
                tile_xpath,
            ))

        prove_heatmap_scales()
        scroll_heatmap_tile_into_view()
        driver.save_screenshot(str(heatmap_artifacts / "heatmap-desktop.png"))
        driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": True})
        _wait(driver).until(lambda current: _viewport(current)["width"] == 390)
        prove_heatmap_scales()
        scroll_heatmap_tile_into_view()
        driver.save_screenshot(str(heatmap_artifacts / "heatmap-mobile.png"))
        driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": 1280, "height": 800, "deviceScaleFactor": 1, "mobile": False})
        _wait(driver).until(lambda current: _viewport(current)["width"] == 1280)
        field = driver.find_element(By.ID, "research-symbol")
        field.clear()
        field.send_keys("P1NOFACTS")
        _click(driver, driver.find_element(By.XPATH, "//button[normalize-space()='Research']"))
        _wait(driver).until(lambda current: "P1NOFACTS" in current.find_element(By.TAG_NAME, "body").text)
        _wait(driver).until(lambda current: "research assessment unavailable" in current.find_element(By.TAG_NAME, "body").text.lower())
        _wait(driver).until(lambda _current: any(
            event["path"] == "/market/research/P1NOFACTS" and event["status"] == 200
            for event in _status_events(disposable_api.log_path.read_text(encoding="utf-8", errors="replace"))
        ))
        artifacts = REPO_ROOT / ".local-tools" / "public-browser"
        artifacts.mkdir(parents=True, exist_ok=True)
        driver.save_screenshot(str(artifacts / "cached-desktop.png"))
        driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": True})
        assert _viewport(driver)["width"] == 390
        assert driver.execute_script("return document.documentElement.scrollWidth <= document.documentElement.clientWidth")
        driver.save_screenshot(str(artifacts / "cached-mobile.png"))
        print(json.dumps({"check": "public cached quotes", "provider_http": "blocked", "reference_fill": "absent", "viewport": _viewport(driver), "bundle": _bundle(driver)}))
    finally:
        driver.quit()


def test_mobile_shell_keyboard_and_resize(disposable_api: _DisposableApi) -> None:
    from selenium.webdriver.common.keys import Keys

    artifacts = REPO_ROOT / ".local-tools" / "p2-shell"
    artifacts.mkdir(parents=True, exist_ok=True)
    driver = _driver()
    try:
        def viewport(width, height):
            driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {
                "width": width, "height": height, "deviceScaleFactor": 1, "mobile": False,
            })

        def modal_open():
            return driver.execute_script("return Boolean(document.querySelector('dialog[open]'))")

        def focus_inside():
            return driver.execute_script(
                "const dialog = document.querySelector('dialog[open]'); return Boolean(dialog && dialog.contains(document.activeElement));"
            )

        viewport(390, 844)
        _sign_in(driver, disposable_api.web_url, disposable_api.email, os.environ["P0B_TRADER_PASSWORD"])
        opener = driver.find_element(By.CSS_SELECTOR, "button[aria-label='Open navigation']")
        assert opener.get_attribute("aria-expanded") == "false"
        assert not modal_open()
        for _ in range(12):
            driver.switch_to.active_element.send_keys(Keys.TAB)
            assert not driver.execute_script("return Boolean(document.activeElement.closest('dialog, aside'))")
        opener.send_keys(Keys.ENTER)
        _wait(driver).until(lambda _: modal_open() and focus_inside())
        assert opener.get_attribute("aria-expanded") == "true"
        for _ in range(12):
            driver.switch_to.active_element.send_keys(Keys.TAB)
            assert focus_inside(), driver.execute_script("return {tag: document.activeElement.tagName, document_has_focus: document.hasFocus()}")
        for _ in range(12):
            driver.switch_to.active_element.send_keys(Keys.SHIFT, Keys.TAB)
            assert focus_inside()
        driver.execute_script("const target = document.querySelector('main input, main button, main a'); if (target) target.focus();")
        assert focus_inside()
        assert driver.execute_script("return document.body.style.overflow") == "hidden"
        assert driver.execute_script("return document.documentElement.scrollWidth <= document.documentElement.clientWidth")
        driver.save_screenshot(str(artifacts / "mobile-open.png"))

        driver.switch_to.active_element.send_keys(Keys.ESCAPE)
        _wait(driver).until(lambda _: not modal_open())
        assert driver.execute_script("return document.activeElement === arguments[0]", opener)
        assert driver.execute_script("return document.body.style.overflow") != "hidden"
        opener.click()
        driver.find_element(By.CSS_SELECTOR, "dialog button[aria-label='Close navigation']").click()
        _wait(driver).until(lambda _: not modal_open())
        assert driver.execute_script("return document.activeElement === arguments[0]", opener)
        driver.save_screenshot(str(artifacts / "mobile-closed.png"))

        opener.click()
        for kind in ("mousePressed", "mouseReleased"):
            driver.execute_cdp_cmd("Input.dispatchMouseEvent", {
                "type": kind, "x": 370, "y": 120, "button": "left", "clickCount": 1,
            })
        _wait(driver).until(lambda _: not modal_open())
        assert driver.execute_script("return document.activeElement === arguments[0]", opener)

        opener.click()
        driver.find_element(By.CSS_SELECTOR, "dialog a[href='/portfolio']").click()
        _wait(driver).until(EC.url_contains("/portfolio"))
        _wait(driver).until(EC.staleness_of(opener))
        _wait(driver).until(lambda _: not modal_open())
        assert driver.execute_script("return document.body.style.overflow") != "hidden"
        _wait(driver).until(EC.element_to_be_clickable((By.CSS_SELECTOR, "button[aria-label='Open navigation']"))).click()
        _wait(driver).until(lambda _: modal_open())
        viewport(1280, 800)
        _wait(driver).until(lambda _: not modal_open() and bool(driver.find_elements(By.CSS_SELECTOR, "aside[aria-label='Sidebar']")))
        assert driver.find_element(By.CSS_SELECTOR, "aside a[href='/portfolio']").is_displayed()
        assert not driver.find_elements(By.CSS_SELECTOR, "button[aria-label='Open navigation']")
        assert driver.execute_script("return document.body.style.overflow") != "hidden"
        assert driver.execute_script("return document.documentElement.scrollWidth <= document.documentElement.clientWidth")
        driver.execute_script("window.scrollTo(0, document.body.scrollHeight)")
        assert driver.execute_script("const rect = document.querySelector('aside a').getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight")
        driver.save_screenshot(str(artifacts / "desktop.png"))

        viewport(390, 844)
        _wait(driver).until(EC.element_to_be_clickable((By.CSS_SELECTOR, "button[aria-label='Open navigation']"))).click()
        _wait(driver).until(lambda _: modal_open())
        driver.find_element(By.XPATH, "//dialog//button[normalize-space()='Sign out']").click()
        _wait(driver).until(EC.url_contains("/login"))
        assert not modal_open()
        assert driver.execute_script("return document.body.style.overflow") != "hidden"
        print(json.dumps({"check": "P2 native mobile navigation", "keyboard": "passed", "resize": "passed", "logout_cleanup": "passed", "viewport": _viewport(driver), "bundle": _bundle(driver)}))
    finally:
        driver.quit()


def test_hosted_frontend_is_recorded_separately() -> None:
    driver = _driver()
    try:
        driver.get(HOSTED + "/")
        _wait(driver).until(EC.presence_of_element_located((By.CSS_SELECTOR, "script[src*='/assets/index-']")))
        bundle = _bundle(driver)
        title = driver.title
        viewport = _viewport(driver)
        page = driver.page_source
        print(json.dumps({
            "environment": "hosted",
            "url": HOSTED + "/",
            "title": title,
            "bundle": bundle,
            "viewport": viewport,
            "viewport_source": "window.innerWidth/innerHeight",
            "has_public_dashboard_label": "Public dashboard" in page,
            "authenticated": False,
        }, sort_keys=True))
        assert bundle != ""
        assert "Public dashboard" not in page
    finally:
        driver.quit()
