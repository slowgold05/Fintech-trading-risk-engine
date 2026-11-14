"""Password hashing must stay compatible with hashes already stored in the database.

LEGACY_HASHES were produced by the previous stack (passlib 1.7.4 + bcrypt 3.2.2)
and must keep verifying after any change to the hashing code or its dependency.
"""

import pytest

from app.core.security import (
    BCRYPT_MAX_PASSWORD_BYTES,
    hash_password,
    verify_password,
    verify_password_or_dummy,
)
from app.models.user import User

EURO = "€"
E_ACUTE = "é"

# (label, plaintext, hash written by passlib 1.7.4 + bcrypt 3.2.2)
LEGACY_HASHES = [
    ("ascii", "password123", "$2b$12$YbD0GhoH4YLWjPpKFNQoJeoQbKP9IBN0Hp8Ik4tdiNpoNG5dqN/WG"),
    (
        "unicode_short",
        f"pässwörd-{EURO}uro-1",
        "$2b$12$avHu62hWDEbIMHWO3aOn3eGwZk6SL7HyVcuqWLASGEUXW0dI1dGHS",
    ),
    ("ascii_72_bytes", "a1B2" * 18, "$2b$12$giKCHyFwSPwfegrdKHt.nuDG65Z0ETemOmGhtIi7JEXMT7Qvnqjlm"),
    # The API allows 72 characters, which can be more than 72 bytes.
    ("multibyte_144_bytes", E_ACUTE * 72, "$2b$12$7MwIXqX8xHYp6KvjqVSE1uNnxr2XbMJywN5eZKy.ZY/OtTn5D4Fse"),
    ("mixed_90_bytes", "x" * 60 + EURO * 10, "$2b$12$.rSrC3uG.5FF7zSPi2hSy.1Mcl1GL/1RsZ.aYD/mrQmY4suKQ6ujO"),
    ("ascii_100_bytes", "z" * 100, "$2b$12$yvZYt6WVYOVN8M0h62ifU.cA9ELC5ciLtVlAtXIsFc9LHoWZcZrNC"),
]
LEGACY_IDS = [case[0] for case in LEGACY_HASHES]


@pytest.mark.parametrize("label, plaintext, legacy_hash", LEGACY_HASHES, ids=LEGACY_IDS)
def test_legacy_hash_still_verifies(label, plaintext, legacy_hash):
    assert verify_password(plaintext, legacy_hash) is True


@pytest.mark.parametrize("label, plaintext, legacy_hash", LEGACY_HASHES, ids=LEGACY_IDS)
def test_legacy_hash_rejects_wrong_password(label, plaintext, legacy_hash):
    assert verify_password("wrong-" + plaintext[:40], legacy_hash) is False


def test_new_hash_keeps_stored_format_and_cost():
    hashed = hash_password("password123")
    assert hashed.startswith("$2b$12$")
    assert len(hashed) == 60
    assert hashed != hash_password("password123")
    assert verify_password("password123", hashed) is True
    assert verify_password("password124", hashed) is False


def test_only_first_72_bytes_are_significant():
    base = "k" * BCRYPT_MAX_PASSWORD_BYTES
    hashed = hash_password(base + "tail-one")
    assert verify_password(base + "tail-two", hashed) is True
    assert verify_password("j" + base[1:] + "tail-one", hashed) is False


def test_missing_user_path_runs_a_real_comparison():
    assert verify_password_or_dummy("password123", None) is False
    assert verify_password_or_dummy("password123", hash_password("password123")) is True


def test_user_with_legacy_hash_can_log_in(client, db_session):
    label, plaintext, legacy_hash = LEGACY_HASHES[3]
    db_session.add(User(email="legacy@example.com", password_hash=legacy_hash))
    db_session.commit()

    ok = client.post("/auth/login", data={"username": "legacy@example.com", "password": plaintext})
    assert ok.status_code == 200
    assert ok.json()["access_token"]

    bad = client.post("/auth/login", data={"username": "legacy@example.com", "password": "not-the-password"})
    assert bad.status_code == 401


@pytest.mark.parametrize("candidate", ["q" * 500, E_ACUTE * 200, "abc\x00defgh"], ids=["long", "multibyte", "nul"])
def test_unusual_login_password_is_rejected_not_an_error(client, make_user, candidate):
    make_user("edge@example.com", "password123")
    response = client.post("/auth/login", data={"username": "edge@example.com", "password": candidate})
    assert response.status_code == 401
