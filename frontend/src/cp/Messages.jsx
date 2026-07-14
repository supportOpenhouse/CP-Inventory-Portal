/**
 * CP Messages screen — the CP's 1:1 conversation with the shared "openhouse"
 * staff identity, opened from the bottom-strip Messages slot. Ported from CP's
 * screens/CpChat.jsx into our CP shell + design tokens. The message pane itself
 * is CometChat UIKit (header + list); the composer + all chrome are ours.
 */
import { useEffect, useState } from 'react';
import {
  CometChatMessageHeader, CometChatMessageList, CometChatProvider,
} from '@cometchat/chat-uikit-react';
import { CometChat } from '@cometchat/chat-sdk-javascript';
import { loginCometChat } from '../cometchat';
import { useTheme } from '../contexts/ThemeContext.jsx';
import { api } from '../api';
import ChatErrorBoundary from '../components/ChatErrorBoundary';
import ChatComposer from '../components/ChatComposer';
import { IconChevron } from '../components/icons.jsx';

const STAFF_UID = 'openhouse';

export default function Messages({ onBack }) {
  const { theme } = useTheme();
  const [state, setState] = useState({ ready: false, error: '', peer: null, notEnabled: false, requestPending: false });
  const [requested, setRequested] = useState(false);
  const [reqBusy, setReqBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    loginCometChat()
      .then(() => CometChat.getUser(STAFF_UID))
      .then((peer) => alive && setState({ ready: true, error: '', peer, notEnabled: false }))
      .catch((e) => {
        if (!alive) return;
        const notEnabled = e?.status === 403 && e?.data?.error === 'chat_not_enabled';
        setState({
          ready: false,
          error: notEnabled ? '' : (e?.message || 'Chat unavailable'),
          peer: null,
          notEnabled,
          requestPending: notEnabled ? !!e?.data?.request_pending : false,
        });
      });
    // On unmount, the CP has viewed the thread (CometChat marks it read) —
    // nudge the unread badge to re-count so the dot clears promptly.
    return () => { alive = false; window.dispatchEvent(new Event('chat:changed')); };
  }, []);

  const handleRequest = async () => {
    if (requested || reqBusy) return;      // guard against double-fire
    setRequested(true);                    // optimistic: show confirmation, hide button
    setReqBusy(true);
    // Server dedupes (ON CONFLICT DO NOTHING); a reload after a true failure
    // finds no pending request and re-shows the button so the CP can retry.
    try { await api.cometRequestChat(); }
    catch { /* keep the confirmation shown */ }
    finally { setReqBusy(false); }
  };

  return (
    <div className="cp-shell">
      <div className="header" style={{ gap: 12 }}>
        <button className="back-btn" onClick={onBack} aria-label="Back">
          <span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}><IconChevron size={20} /></span>
        </button>
        <div>Chat with Openhouse</div>
      </div>

      {state.notEnabled ? (
        <div className="empty-state">
          <div className="empty-state-icon">💬</div>
          <p>Chat isn’t enabled for your account yet.</p>
          {requested || state.requestPending ? (
            <p style={{ color: 'var(--green-fg)', fontWeight: 600 }}>Request sent — an admin will enable your chat.</p>
          ) : (
            <button className="primary-btn" style={{ maxWidth: 300 }} onClick={handleRequest} disabled={reqBusy}>
              {reqBusy ? 'Sending…' : 'Request admin to start chat'}
            </button>
          )}
        </div>
      ) : state.error ? (
        <div className="empty-state"><div className="empty-state-icon">⚠️</div><p>{state.error}</p></div>
      ) : !state.ready ? (
        <div className="empty-state"><p>Loading chat…</p></div>
      ) : (
        <ChatErrorBoundary>
          <CometChatProvider theme={theme}>
            <div className="cp-chat-pane">
              <CometChatMessageHeader user={state.peer} />
              <CometChatMessageList user={state.peer} />
              <ChatComposer onSend={(t) => api.cometSend({ text: t })} />
            </div>
          </CometChatProvider>
        </ChatErrorBoundary>
      )}
    </div>
  );
}
