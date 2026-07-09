import { useEffect, useState } from 'react';
import {
  CometChatMessageHeader, CometChatMessageList,
  CometChatProvider,
} from '@cometchat/chat-uikit-react';
import { CometChat } from '@cometchat/chat-sdk-javascript';
import { loginCometChat } from '../cometchat';
import { api } from '../api';
import ChatErrorBoundary from '../components/ChatErrorBoundary';
import ChatComposer from '../components/ChatComposer';

const STAFF_UID = 'openhouse';

/**
 * Full-screen CP chat widget: the CP's conversation with the shared
 * "openhouse" staff identity. Mirrors the app-shell/header/back-btn pattern
 * used by other full-screen CP views (see AddUnit/index.jsx) and the
 * message-pane composition used by Admin/ChatInbox.jsx.
 */
export default function CpChat({ onClose }) {
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
    return () => { alive = false; };
  }, []);

  const handleRequest = async () => {
    if (requested || reqBusy) return;      // guard against double-fire
    setRequested(true);                    // optimistic: show confirmation + hide button on press
    setReqBusy(true);
    // Server dedupes (ON CONFLICT DO NOTHING); if the POST truly failed, a reload
    // finds no pending request and re-shows the button so the CP can retry.
    try { await api.cometRequestChat(); }
    catch { /* keep the confirmation shown */ }
    finally { setReqBusy(false); }
  };

  return (
    <div className="app-shell">
      <div className="header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="back-btn" onClick={onClose}>←</button>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Chat with Openhouse</span>
        </div>
      </div>

      {state.notEnabled ? (
        <div className="empty-state">
          <p>Admin has not created chat account for you.</p>
          {requested || state.requestPending ? (
            <p style={{ color: '#166534' }}>Request sent — an admin will enable your chat.</p>
          ) : (
            <button className="primary-btn" onClick={handleRequest} disabled={reqBusy}>
              {reqBusy ? 'Sending…' : 'Request admin to start chat'}
            </button>
          )}
        </div>
      ) : state.error ? (
        <div className="empty-state"><p>{state.error}</p></div>
      ) : !state.ready ? (
        <div className="empty-state"><p>Loading chat…</p></div>
      ) : (
        <ChatErrorBoundary>
          <CometChatProvider>
            <div style={{ height: 'calc(100vh - 140px)', display: 'flex', flexDirection: 'column' }}>
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
