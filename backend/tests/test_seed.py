from app.models.monitor import Monitor
from app.models.user import User
from app.seed import DEMO_EMAIL, DEMO_MONITORS, seed_demo_data


class TestSeed:
    def test_seeds_user_and_monitors(self, db_session):
        user, monitors, password = seed_demo_data(db_session, password="demo-pass-123")
        assert user.email == DEMO_EMAIL
        assert len(monitors) == len(DEMO_MONITORS)
        assert password == "demo-pass-123"  # explicit password is kept private-ish
        types = {m.type for m in monitors}
        assert {"http", "api_json"} <= types
        assert any(m.keyword for m in monitors)
        assert any(m.json_path for m in monitors)

    def test_seed_is_idempotent(self, db_session):
        seed_demo_data(db_session, password="demo-pass-123")
        seed_demo_data(db_session, password="demo-pass-123")
        assert db_session.query(User).filter_by(email=DEMO_EMAIL).count() == 1
        assert db_session.query(Monitor).count() == len(DEMO_MONITORS)

    def test_seed_uses_env_password(self, db_session, monkeypatch):
        from app.config import get_settings

        monkeypatch.setattr(get_settings(), "demo_password", "from-env-123")
        _, _, password = seed_demo_data(db_session)
        assert password == ""  # env-configured password is not echoed
