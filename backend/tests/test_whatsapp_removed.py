"""WhatsApp must be gone: no module, no routes; unrelated routes still registered."""
from app import create_app


def _rules():
    app = create_app()
    return {str(r) for r in app.url_map.iter_rules()}


def test_no_whatsapp_routes():
    rules = _rules()
    banned = [
        "/api/webhooks/interakt",
        "/api/cron/send-cp-reminders",
        "/api/admin/whatsapp/threads",
        "/api/admin/whatsapp/threads/<phone>",
        "/api/admin/whatsapp/threads/<phone>/send",
        "/api/admin/submissions/<int:sid>/whatsapp",
    ]
    assert not any(b in rules for b in banned), f"whatsapp route still present: {rules & set(banned)}"


def test_core_routes_survive():
    rules = _rules()
    for keep in ["/api/health", "/api/me", "/api/admin/submissions", "/api/societies"]:
        assert keep in rules, f"missing expected route {keep}"


def test_no_services_whatsapp_import():
    import importlib, pathlib
    backend = pathlib.Path(__file__).resolve().parent.parent
    hits = [p.name for p in backend.rglob("*.py")
            if "services_whatsapp" in p.read_text() and p.name != "test_whatsapp_removed.py"]
    assert hits == [], f"stray services_whatsapp import in {hits}"
