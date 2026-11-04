"""Run the in-process tabletop on a private sqlite database and write the exercise note.

This does not use DATABASE_URL and does not call the public demo.
"""

import json
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import app
from app.models import *  # noqa: F403 - register models before create_all
from app.models.trading_halt import TradingHaltState
from app.services.tabletop import run_scenarios


OUT = Path(__file__).resolve().parents[2] / "grc" / "tabletop" / "2026-11-04-exercise.md"


def main() -> None:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    Base.metadata.create_all(bind=engine)
    session_factory = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)
    session = session_factory()
    session.add(TradingHaltState(id=1, halted=False, reason="Tabletop"))
    session.commit()

    def override_get_db():
        try:
            yield session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as client:
            results = run_scenarios(client, session)
    finally:
        app.dependency_overrides.clear()
        session.close()
        engine.dispose()

    lines = [
        "# Tabletop exercise — 2026-11-04",
        "",
        "**Status:** Recorded from `python -m app.scripts.run_tabletop`. Pending exercise owner review.",
        "",
        "The exercise uses an in-process client and a private sqlite database. It does not call the public demo and it does not send orders to a market.",
        "",
        "| Scenario | MITRE | Caught | Note |",
        "| --- | --- | --- | --- |",
    ]
    for item in results:
        caught = "yes" if item["caught"] else "no"
        note = str(item["note"]).replace("|", "/")
        lines.append(f"| {item['title']} | {item['mitre']} | {caught} | {note} |")
    lines.extend([
        "",
        "Credential stuffing maps to T1110.004. Reuse of a rotated refresh token maps to T1550.004. "
        "The other-account cash check maps to T1078 because ATT&CK has no IDOR technique. "
        "Selling without holdings, wash trading, spoofing, and structuring have no ATT&CK technique. "
        "The sell check uses the order book's holdings test. Wash trading, spoofing, and structuring run the existing detectors on one labeled scenario each. None of them is a live bot.",
        "",
        "No customer-notice clock starts from this exercise. The scenarios are control checks, not a declared incident.",
        "",
    ])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    print(json.dumps([{"id": item["id"], "caught": item["caught"]} for item in results]))
    if any(not item["caught"] for item in results):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
