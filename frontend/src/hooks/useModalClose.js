/**
 * Shared dismiss behaviour for every popup: an exit animation that drops the
 * panel toward the bottom, and Escape-to-close.
 *
 * Usage — replace direct `onClose` calls with the returned `close`, and put the
 * returned `closing` flag on the scrim + panel:
 *
 *   const { closing, close } = useModalClose(onClose);
 *   <div className={`modal-backdrop${closing ? ' is-closing-scrim' : ''}`} onClick={close}>
 *     <div className={`modal${closing ? ' is-closing-panel' : ''}`} onClick={stop}>
 *
 * `close` is idempotent — a second call while the exit is playing is ignored,
 * so a backdrop click during the animation can't fire onClose twice.
 *
 * Escape and modal stacking: a single document-level listener drives a stack of
 * mounted popups and only dismisses the TOP one. Per-modal listeners would all
 * fire on the same keypress and collapse the whole stack at once — e.g. Escape
 * in the match-details popup would also close the submission card underneath it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

// Keep in sync with the .is-closing-panel / .is-closing-scrim animation
// durations in styles.css. If the JS unmounts first the exit is never seen; if
// it waits too long the popup sits frozen at the end of its animation.
export const MODAL_EXIT_MS = 220;

// Mounted popups, oldest first. Only the last entry answers Escape.
const stack = [];
let listening = false;

function handleKeyDown(e) {
  if (e.key !== 'Escape') return;
  const top = stack[stack.length - 1];
  if (!top) return;
  // Stop the key reaching other handlers so one press dismisses one layer.
  e.stopPropagation();
  top.current();
}

function pushEntry(entry) {
  stack.push(entry);
  if (!listening) {
    document.addEventListener('keydown', handleKeyDown);
    listening = true;
  }
}

function removeEntry(entry) {
  const i = stack.indexOf(entry);
  if (i >= 0) stack.splice(i, 1);
  if (stack.length === 0 && listening) {
    document.removeEventListener('keydown', handleKeyDown);
    listening = false;
  }
}

/**
 * @param onClose  called once the exit animation has played.
 * @param options.disabled  when true, close() and Escape do nothing, but the
 *   popup STAYS on the stack so the key is swallowed rather than falling
 *   through to the layer beneath. Use for in-flight submits, so a stray Escape
 *   can't abandon a request mid-write or dismiss the parent instead.
 * @param options.enabled  whether the popup is currently rendered. Components
 *   that early-return on a closed prop must pass it (hooks can't be called
 *   conditionally), otherwise a hidden popup would sit on the stack and eat the
 *   Escape meant for whatever is actually on screen.
 * @returns {{ closing: boolean, close: () => void }}
 */
export function useModalClose(onClose, { disabled = false, enabled = true } = {}) {
  const [closing, setClosing] = useState(false);
  // Held in refs so the Escape entry never goes stale without re-subscribing.
  const onCloseRef = useRef(onClose);
  const disabledRef = useRef(disabled);
  const closingRef = useRef(false);
  onCloseRef.current = onClose;
  disabledRef.current = disabled;

  const close = useCallback(() => {
    if (closingRef.current || disabledRef.current) return;
    closingRef.current = true;
    setClosing(true);
    setTimeout(() => onCloseRef.current?.(), MODAL_EXIT_MS);
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const entry = { current: close };
    pushEntry(entry);
    return () => removeEntry(entry);
  }, [close, enabled]);

  // Reset when the popup is reopened through the same mounted component, so the
  // second open isn't stuck holding the previous exit's end frame.
  useEffect(() => {
    if (!enabled) { closingRef.current = false; setClosing(false); }
  }, [enabled]);

  return { closing, close };
}
