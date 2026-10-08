# CometChat — disabled 2026-10-08

The in-app chat feature was retired. These files are the **backend** half.
`app.py` no longer imports or registers either blueprint, so none of this
loads and no `/api/comet/*` or `/api/webhooks/cometchat` route is mounted
(verified: 11 blueprints register, 0 comet routes).

## Files here

| File | Was at | What it was |
|---|---|---|
| `comet.py` | `backend/routes/comet.py` | `/api/comet` blueprint |
| `webhooks.py` | `backend/routes/webhooks.py` | `/api/webhooks/cometchat` — its only route |
| `services_cometchat.py` | `backend/services_cometchat.py` | REST calls, user provisioning, auth tokens |
| `tests_comet_send.py` | `backend/` | standalone script |
| `tests_comet_webhook.py` | `backend/` | standalone script |
| `tests_cometchat_uid.py` | `backend/` | standalone script |
| `tests_chat_access.py` | `backend/` | standalone script |

Their imports assume the original locations — fix on restore.

## Deliberately left alone

- **The tables.** `chat_messages`, `cp_chat_access` and `chat_requests` still
  exist with their data. Nothing reads or writes them; no migration was added.
  Drop them separately if you ever want the history gone.
- **The migrations.** `2026-07-09-chat-messages.sql` and
  `-chat-user-management.sql` stay in `migrations/` — they are history, and a
  fresh DB still needs to replay in order.
- **The env vars.** `COMET_*` on Render are harmless now; nothing reads them.
  `config.py` has them commented out, not deleted.

## To re-enable

1. `git mv` these back to the paths in the table.
2. Uncomment the `CHAT REMOVED 2026-10-08` blocks in `app.py` and `config.py`.
3. Frontend: see `frontend/src/_disabled/chat/README.md`.
