import { useState } from 'react';

/**
 * Minimal text composer that replaces CometChat's built-in composer so every
 * message is proxied through our backend (api.cometSend) and logged in
 * chat_messages with the real sender. Enter sends, Shift+Enter is a newline.
 *
 * Props:
 *   onSend(text) => Promise   — resolves when sent; rejects to keep the draft.
 *   disabled?                 — greys out the input.
 *   placeholder?
 */
export default function ChatComposer({ onSend, disabled = false, placeholder = 'Type a message…' }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const send = async () => {
    const t = text.trim();
    if (!t || busy || disabled) return;
    setBusy(true);
    setErr('');
    try {
      await onSend(t);
      setText('');            // clear only on success — a failure keeps the draft
    } catch {
      setErr('Couldn’t send — try again.');
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const canSend = !!text.trim() && !busy && !disabled;
  return (
    <div style={{ borderTop: '1px solid var(--oh-border, #eee)', background: '#fff' }}>
      {err && (
        <div style={{ padding: '6px 14px 0', color: '#991b1b', fontSize: 12 }}>{err}</div>
      )}
      <div style={{ display: 'flex', gap: 8, padding: 12, alignItems: 'center' }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled || busy}
          style={{
            flex: 1, padding: '10px 14px', border: '1px solid var(--oh-border, #ddd)',
            borderRadius: 20, fontSize: 14, fontFamily: 'inherit', outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={send}
          disabled={!canSend}
          style={{
            padding: '0 20px', height: 40, borderRadius: 20, border: 0,
            background: 'var(--oh-orange, #FF6B2B)', color: '#fff', fontWeight: 600,
            fontSize: 14, cursor: canSend ? 'pointer' : 'default', opacity: canSend ? 1 : 0.5,
          }}
        >
          {busy ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
