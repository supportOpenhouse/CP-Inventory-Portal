"""Guard the frozen contract: only Tickets added, only WhatsApp removed."""
from app import create_app

# The 61 frontend-facing + external endpoints that MUST remain, sampled at the
# blueprint level (full list in the design spec §11). We assert presence of a
# representative, high-risk subset plus the external-integration routes.
MUST_KEEP = {
    "/api/health", "/api/auth/send-otp", "/api/auth/verify-otp", "/api/auth/logout", "/api/me",
    "/api/my-rm", "/api/rm-contacts", "/api/societies", "/api/media/upload",
    "/api/submissions", "/api/check-duplicate", "/api/admin/submissions",
    "/api/admin/activity-log", "/api/admin/staff-users",
    "/api/sync/collated-data", "/api/sync/channel-partners", "/api/sync/submissions",
}
MUST_ADD = {
    "/api/tickets", "/api/tickets/pending-count", "/api/tickets/<int:ticket_id>",
    "/api/tickets/<int:ticket_id>/reply", "/api/tickets/<int:ticket_id>/close",
    "/api/tickets/<int:ticket_id>/reopen",
}
MUST_REMOVE = {
    "/api/webhooks/interakt", "/api/cron/send-cp-reminders",
    "/api/admin/whatsapp/threads", "/api/admin/submissions/<int:sid>/whatsapp",
}


def test_contract():
    rules = {str(r) for r in create_app().url_map.iter_rules()}
    assert MUST_KEEP <= rules, f"missing frozen endpoints: {MUST_KEEP - rules}"
    assert MUST_ADD <= rules, f"missing new tickets endpoints: {MUST_ADD - rules}"
    assert not (MUST_REMOVE & rules), f"whatsapp endpoints still present: {MUST_REMOVE & rules}"
