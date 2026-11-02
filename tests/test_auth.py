import jwt

from app.core.config import settings
from app.core.security import create_access_token


def test_register_login_and_me(client):
    register = client.post(
        "/auth/register",
        json={"email": "alice@example.com", "password": "password123"},
    )
    assert register.status_code == 200
    assert register.json()["email"] == "alice@example.com"

    login = client.post(
        "/auth/login",
        data={"username": "alice@example.com", "password": "password123"},
    )
    assert login.status_code == 200
    token = login.json()["access_token"]

    me = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["email"] == "alice@example.com"


def test_refresh_rotates_cookie_and_issues_new_access_token(client):
    register = client.post(
        "/auth/register",
        json={"email": "refresh@example.com", "password": "password123"},
    )
    assert register.status_code == 200

    login = client.post(
        "/auth/login",
        data={"username": "refresh@example.com", "password": "password123"},
    )
    assert login.status_code == 200
    first_cookie = client.cookies.get("refresh_token")
    assert first_cookie

    refresh = client.post("/auth/refresh")
    assert refresh.status_code == 200
    assert refresh.json()["access_token"]
    assert client.cookies.get("refresh_token") != first_cookie


def test_logout_revokes_refresh_cookie(client):
    client.post(
        "/auth/register",
        json={"email": "logout@example.com", "password": "password123"},
    )
    login = client.post(
        "/auth/login",
        data={"username": "logout@example.com", "password": "password123"},
    )
    assert login.status_code == 200

    logout = client.post("/auth/logout")
    assert logout.status_code == 200

    refresh = client.post("/auth/refresh")
    assert refresh.status_code == 401


def test_weak_password_returns_422(client):
    response = client.post(
        "/auth/register",
        json={"email": "weak@example.com", "password": "aaaaaaaa"},
    )

    assert response.status_code == 422


def test_duplicate_email_returns_400(client, make_user):
    make_user("dupe@example.com")

    response = client.post(
        "/auth/register",
        json={"email": "dupe@example.com", "password": "password123"},
    )

    assert response.status_code == 400


def test_wrong_password_returns_401(client, make_user):
    make_user("wrong@example.com", "password123")

    response = client.post(
        "/auth/login",
        data={"username": "wrong@example.com", "password": "bad-password"},
    )

    assert response.status_code == 401


def test_garbage_token_returns_401(client):
    response = client.get("/auth/me", headers={"Authorization": "Bearer not-a-token"})

    assert response.status_code == 401


def test_expired_token_returns_401(client, make_user):
    make_user("expired@example.com")
    login = client.post(
        "/auth/login",
        data={"username": "expired@example.com", "password": "password123"},
    )
    assert login.status_code == 200

    expired = create_access_token(user_id=1, minutes=-1)
    response = client.get("/auth/me", headers={"Authorization": f"Bearer {expired}"})

    assert response.status_code == 401


def test_token_without_expiry_returns_401(client, make_user):
    make_user("unbounded@example.com")
    token = jwt.encode({"sub": "1"}, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    response = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401
