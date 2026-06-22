"""POST /api/media/upload — proxy media uploads to Cloudinary.

The browser POSTs the raw file here (multipart/form-data); we forward it to
Cloudinary using the UNSIGNED upload preset and return the new asset's
public_id + secure_url.

Why proxy at all: the unsigned preset used to live in the JS bundle, so anyone
could read it and dump files into the Cloudinary account. Moving the upload
behind this auth-gated endpoint keeps the preset name server-side and limits
uploads to logged-in CPs/staff. An unsigned preset needs no api_secret.
"""

import logging

import requests
from flask import Blueprint, jsonify, request

from auth import require_auth
from config import Config

log = logging.getLogger(__name__)

bp = Blueprint("media", __name__, url_prefix="/api/media")

# Mirror the client-side limits — the server is the real boundary, never trust
# the browser to enforce size/type.
_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
_VIDEO_TYPES = {"video/mp4", "video/quicktime", "video/webm"}
_MAX_IMAGE_BYTES = 5 * 1024 * 1024     # 5 MB
_MAX_VIDEO_BYTES = 100 * 1024 * 1024   # 100 MB


@bp.post("/upload")
@require_auth
def upload():
    if not (Config.CLOUDINARY_CLOUD_NAME and Config.CLOUDINARY_UPLOAD_PRESET):
        return jsonify({"error": "Cloudinary not configured"}), 503

    file = request.files.get("file")
    if file is None or not file.filename:
        return jsonify({"error": "No file provided"}), 400

    resource_type = "video" if request.form.get("resource_type") == "video" else "image"
    allowed = _VIDEO_TYPES if resource_type == "video" else _IMAGE_TYPES
    max_bytes = _MAX_VIDEO_BYTES if resource_type == "video" else _MAX_IMAGE_BYTES

    if file.mimetype not in allowed:
        return jsonify({"error": f"Unsupported file type: {file.mimetype or 'unknown'}"}), 400

    # Measure the stream, then rewind so the full file is still sent upstream.
    file.stream.seek(0, 2)
    size = file.stream.tell()
    file.stream.seek(0)
    if size > max_bytes:
        return jsonify({"error": f"File too large (max {max_bytes // (1024 * 1024)} MB)"}), 400

    try:
        resp = requests.post(
            f"https://api.cloudinary.com/v1_1/{Config.CLOUDINARY_CLOUD_NAME}/{resource_type}/upload",
            data={"upload_preset": Config.CLOUDINARY_UPLOAD_PRESET},
            files={"file": (file.filename, file.stream, file.mimetype)},
            timeout=120,
        )
    except requests.RequestException as e:
        log.exception("[media] cloudinary upload failed: %s", e)
        return jsonify({"error": "Upload failed"}), 502

    if resp.status_code >= 300:
        log.error("[media] cloudinary %s: %s", resp.status_code, resp.text[:500])
        return jsonify({"error": "Upload rejected by Cloudinary"}), 502

    j = resp.json()
    return jsonify({"publicId": j["public_id"], "secureUrl": j["secure_url"]}), 200
