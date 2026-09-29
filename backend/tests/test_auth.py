from datetime import timedelta

from app.services import auth_service
from tests.utils import DEFAULT_PASSWORD, register_and_login


class TestRegister:
    def test_register_success(self, client):
        resp = client.post(
            "/api/auth/register", json={"email": "a@example.com", "password": "password123"}
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["email"] == "a@example.com"
        assert "id" in body
        assert "password" not in body and "password_hash" not in body

    def test_register_normalizes_email_case(self, client):
        client.post("/api/auth/register", json={"email": "Mixed@Example.COM", "password": "password123"})
        resp = client.post(
            "/api/auth/register", json={"email": "mixed@example.com", "password": "password123"}
        )
        assert resp.status_code == 409

    def test_register_duplicate_email_conflict(self, client):
        register_and_login(client, email="dup@example.com")
        resp = client.post(
            "/api/auth/register", json={"email": "dup@example.com", "password": "password123"}
        )
        assert resp.status_code == 409
        assert resp.json()["error"]["code"] == "email_taken"

    def test_register_invalid_email(self, client):
        resp = client.post(
            "/api/auth/register", json={"email": "not-an-email", "password": "password123"}
        )
        assert resp.status_code == 422
        assert resp.json()["error"]["code"] == "validation_error"

    def test_register_password_too_short(self, client):
        resp = client.post(
            "/api/auth/register", json={"email": "x@example.com", "password": "short"}
        )
        assert resp.status_code == 422

    def test_register_missing_fields(self, client):
        resp = client.post("/api/auth/register", json={"email": "only-email@example.com"})
        assert resp.status_code == 422


class TestPasswordHashing:
    def test_password_never_stored_plaintext(self, client, db_session):
        from app.models.user import User

        client.post(
            "/api/auth/register", json={"email": "hash@example.com", "password": "password123"}
        )
        user = db_session.query(User).filter_by(email="hash@example.com").one()
        assert user.password_hash != "password123"
        assert user.password_hash.startswith("$2b$")

    def test_hash_is_salted(self):
        h1 = auth_service.hash_password("same-password")
        h2 = auth_service.hash_password("same-password")
        assert h1 != h2

    def test_verify_password_roundtrip(self):
        h = auth_service.hash_password("s3cret-password")
        assert auth_service.verify_password("s3cret-password", h) is True
        assert auth_service.verify_password("wrong", h) is False


class TestLogin:
    def test_login_success(self, client):
        register_and_login(client, email="login@example.com")
        resp = client.post(
            "/api/auth/login", json={"email": "login@example.com", "password": DEFAULT_PASSWORD}
        )
        assert resp.status_code == 200
        assert resp.json()["token_type"] == "bearer"
        assert resp.json()["access_token"]

    def test_login_case_insensitive_email(self, client):
        register_and_login(client, email="case@example.com")
        resp = client.post(
            "/api/auth/login", json={"email": "CASE@example.com", "password": DEFAULT_PASSWORD}
        )
        assert resp.status_code == 200

    def test_login_wrong_password(self, client):
        register_and_login(client, email="wrongpw@example.com")
        resp = client.post(
            "/api/auth/login", json={"email": "wrongpw@example.com", "password": "wrong-password"}
        )
        assert resp.status_code == 401
        assert resp.json()["error"]["code"] == "invalid_credentials"

    def test_login_unknown_email(self, client):
        resp = client.post(
            "/api/auth/login", json={"email": "ghost@example.com", "password": "whatever123"}
        )
        assert resp.status_code == 401


class TestTokenAuth:
    def test_me_with_valid_token(self, client):
        headers = register_and_login(client, email="me@example.com")
        resp = client.get("/api/auth/me", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["email"] == "me@example.com"

    def test_me_without_token(self, client):
        resp = client.get("/api/auth/me")
        assert resp.status_code == 401

    def test_me_with_garbage_token(self, client):
        resp = client.get("/api/auth/me", headers={"Authorization": "Bearer garbage"})
        assert resp.status_code == 401

    def test_me_with_expired_token(self, client):
        client.post(
            "/api/auth/register", json={"email": "exp@example.com", "password": "password123"}
        )
        expired = auth_service.create_access_token(1, expires_delta=timedelta(seconds=-60))
        resp = client.get("/api/auth/me", headers={"Authorization": f"Bearer {expired}"})
        assert resp.status_code == 401

    def test_token_signed_with_secret_rejected_when_different(self):
        token = auth_service.create_access_token(1, secret_key="key-a-0123456789abcdef-0123456789")
        assert auth_service.decode_access_token(token, secret_key="key-b-0123456789abcdef-0123456789") is None

    def test_decode_token_returns_user_id(self):
        token = auth_service.create_access_token(42)
        assert auth_service.decode_access_token(token) == 42
