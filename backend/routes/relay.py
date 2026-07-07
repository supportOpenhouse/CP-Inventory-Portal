"""Partner relay endpoints — server-to-server from Open House mobile relay."""

import logging

from flask import Blueprint, g, request

from auth import require_relay_on_behalf
from on_behalf_submission import execute_on_behalf_submission

log = logging.getLogger(__name__)

bp = Blueprint("relay", __name__, url_prefix="/api/relay")


@bp.post("/submissions/on-behalf")
@require_relay_on_behalf
def relay_create_submission_on_behalf():
    """Create a submission on behalf of a CP (sales manager via OH relay).

    Auth: relay API key + X-Broker-Id (target CP phone) + X-Sales-Id (+ optional X-Sales-Name).
    Body: same fields as POST /api/admin/submissions/on-behalf except target_cp_id
    (resolved from X-Broker-Id phone).
    """
    data = request.get_json(silent=True) or {}
    log.info(
        "[relay/on-behalf] sales=%r target_cp_id=%s society=%r",
        g.relay_submitted_by_name,
        g.relay_target_cp_id,
        data.get("society") or data.get("society_name"),
    )
    return execute_on_behalf_submission(
        data,
        target_cp_id=g.relay_target_cp_id,
        target_cp_name=g.relay_target_cp_name,
        submitted_by_name=g.relay_submitted_by_name,
        acting_rm_id=None,
        activity_action="submission_created_relay_sales",
    )
