import { useState } from 'react';

/**
 * Minimal text composer that replaces CometChat's built-in composer so every
 * message is proxied through our backend (api.cometSend) and logged in
 * chat_messages with the real sender. Enter sends, Shift+Enter is a newline.
 * Re-skinned to our design tokens (see .chat-composer in styles.css).
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
    <div className="chat-composer">
      {err && <div className="chat-composer-err">{err}</div>}
      <div className="chat-composer-row">
        <input
          className="chat-composer-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled || busy}
        />
        <button type="button" className="btn-primary chat-composer-send" onClick={send} disabled={!canSend}>
          {busy ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
