/**
 * Reusable confirmation modal for destructive actions. Ported from CP
 * verbatim (same props/behavior); retokened to Direct's .modal-* classes
 * and .btn-danger/.btn-primary instead of CP's inline-styled markup.
 *
 * Props:
 *   open        — boolean; controls visibility
 *   title       — heading text (e.g. "Log out?")
 *   message     — body copy explaining the action
 *   confirmLabel— button label (default "Confirm")
 *   cancelLabel — cancel button label (default "Cancel")
 *   destructive — if true, confirm button is red; if false, orange primary
 *   busy        — disables buttons while the async action is in flight
 *   onConfirm   — fires when user taps confirm
 *   onCancel    — fires when user taps cancel or backdrop
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = true,
  busy = false,
  onConfirm,
  onCancel,
}) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {message && <p className="modal-sub">{message}</p>}
        <div className="modal-actions">
          <span style={{ flex: 1 }} />
          <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={destructive ? 'btn-danger' : 'btn-primary'}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Please wait…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
