/**
 * Reusable confirmation modal for destructive actions.
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

  const confirmBg = destructive ? '#DC2626' : 'var(--oh-orange)';
  const confirmBorder = destructive ? '#DC2626' : 'var(--oh-orange)';

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(15,23,42,0.55)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 16,
          padding: '24px 22px',
          maxWidth: 360,
          width: '100%',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{
          fontFamily: 'Fraunces, serif',
          fontSize: 20,
          fontWeight: 700,
          color: 'var(--oh-charcoal)',
          marginBottom: 8,
        }}>
          {title}
        </div>
        {message && (
          <div style={{
            fontSize: 14,
            color: 'var(--oh-gray)',
            lineHeight: 1.5,
            marginBottom: 20,
          }}>
            {message}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={{
              flex: 1,
              padding: '12px 14px',
              borderRadius: 10,
              border: '1.5px solid var(--oh-border)',
              background: '#fff',
              color: 'var(--oh-charcoal)',
              fontSize: 14,
              fontWeight: 600,
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.5 : 1,
              fontFamily: 'inherit',
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            style={{
              flex: 1,
              padding: '12px 14px',
              borderRadius: 10,
              border: `1.5px solid ${confirmBorder}`,
              background: confirmBg,
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.6 : 1,
              fontFamily: 'inherit',
            }}
          >
            {busy ? 'Please wait…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
