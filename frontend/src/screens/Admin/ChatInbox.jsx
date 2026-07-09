import { useEffect, useMemo, useState } from 'react';
import {
  CometChatConversations,
  CometChatUsers,
  CometChatMessageHeader,
  CometChatMessageList,
  CometChatProvider,
} from '@cometchat/chat-uikit-react';
import { CometChat } from '@cometchat/chat-sdk-javascript';
import { loginCometChat } from '../../cometchat';
import { api } from '../../api';
import { useAuth } from '../../contexts/AuthContext';
import ChatErrorBoundary from '../../components/ChatErrorBoundary';
import ChatComposer from '../../components/ChatComposer';
import BroadcastModal from './BroadcastModal';
import ChatUserManager from './ChatUserManager';
import ChatHistory from './ChatHistory';

// CometChat user uid 'cp_<id>' -> numeric cp_id (null for the shared staff uid).
function peerCpId(peer) {
  const uid = peer?.getUid?.() || '';
  return uid.startsWith('cp_') ? parseInt(uid.slice(3), 10) : null;
}

// Reusable in-app chat logo for headers + topbar. A neutral speech bubble
// (NOT the old WhatsApp glyph) — we chat via CometChat now. Color inherits
// from currentColor so each surface can recolor it.
function ChatIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 3C6.486 3 2 6.578 2 11c0 2.06.98 3.94 2.593 5.36-.152 1.147-.58 2.19-1.235 3.056a.6.6 0 0 0 .53.958c1.457-.096 2.79-.567 3.92-1.343A11.6 11.6 0 0 0 12 19c5.514 0 10-3.578 10-8s-4.486-8-10-8Zm-4 9.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Zm4 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Zm4 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Z"/>
    </svg>
  );
}

export { ChatIcon };

/**
 * Full-screen admin chat inbox: CometChat conversation list on the left
 * (role-scoped — admins see every CP, manager/rm see only their cities' CPs
 * via the `city:<name>` tag), full message pane on the right when a
 * conversation is selected.
 */
export default function ChatInbox({ onClose }) {
  const { user } = useAuth();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [peer, setPeer] = useState(null); // CometChat.User of the picked CP
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [leftTab, setLeftTab] = useState('chats'); // 'chats' | 'users'
  const [paneTab, setPaneTab] = useState('live');  // 'live' | 'history'

  useEffect(() => {
    let alive = true;
    loginCometChat()
      .then(() => alive && setReady(true))
      .catch((e) => alive && setError(e?.message || 'Chat unavailable'));
    return () => { alive = false; };
  }, []);

  // admin sees all CP conversations; manager/rm are limited to their (singular)
  // city. The backend user object exposes `user.city` (a single string), NOT
  // `user.cities` — there is no multi-city scope today.
  const isAdmin = user?.role === 'admin';
  let conversationsRequestBuilder;
  if (!isAdmin && user?.city) {
    // NOTE: city-tag scoping must be validated against live CometChat — setTags
    // filters CONVERSATION tags; if CometChat does not filter as intended here,
    // manager/rm scoping needs a server-mediated conversation list. Verify with
    // live keys.
    conversationsRequestBuilder = new CometChat.ConversationsRequestBuilder()
      .setLimit(50)
      .withTags(true)
      .setTags(['city:' + user.city]);
  }
  // FAIL CLOSED: a non-admin with no city scope must not see the unfiltered
  // (all-CPs) conversation list.
  const scopeBlocked = !isAdmin && !user?.city;

  // Start a 1:1 chat with a CP from the manager: open their thread in the pane.
  // The manager enables (provisions) the CP first, so getUser resolves.
  const handleStartChat = (cpId) => {
    setManageOpen(false);
    CometChat.getUser(`cp_${cpId}`).then((u) => setPeer(u)).catch(() => {});
  };

  // All CP users (tagged 'cp') for the "Users" tab — lets openhouse start a chat
  // with any active CP, not just those with an existing conversation.
  const usersRequestBuilder = useMemo(
    () => new CometChat.UsersRequestBuilder().setLimit(50).withTags(true).setTags(['cp']),
    [],
  );
  const tabBtn = (active) => ({
    flex: 1, padding: '6px 10px', borderRadius: 6, fontSize: 13, fontWeight: 600,
    cursor: 'pointer',
    border: active ? '1.5px solid #FF6B2B' : '1px solid var(--oh-border, #ddd)',
    background: active ? '#FFF5EE' : '#fff', color: active ? '#FF6B2B' : '#333',
  });
  const paneBtn = (active) => ({
    padding: '5px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
    border: active ? '1.5px solid #FF6B2B' : '1px solid var(--oh-border, #ddd)',
    background: active ? '#FFF5EE' : '#fff', color: active ? '#FF6B2B' : '#555',
  });

  return (
    <div className="admin-root">
      <div className="admin-topbar">
        <div className="admin-topbar-left">
          <button className="back-btn" onClick={onClose} title="Back to Board">←</button>
          <span className="wa-topbar-title">
            <span className="wa-topbar-icon"><ChatIcon size={20} /></span>
            Chat Inbox
          </span>
        </div>
        {isAdmin && (
          <div className="admin-topbar-right">
            <button
              className="logout-btn"
              onClick={() => setBroadcastOpen(true)}
              title="Broadcast — mass message CPs"
            >
              📢
            </button>
            <button
              className="logout-btn"
              onClick={() => setManageOpen(true)}
              title="Manage chat users"
            >
              👥
            </button>
          </div>
        )}
      </div>

      {error ? (
        <div className="empty-state"><p>{error}</p></div>
      ) : !ready ? (
        <div className="empty-state"><p>Loading chat…</p></div>
      ) : (
        <CometChatProvider>
        <div style={{ display: 'flex', height: 'calc(100vh - 53px)' }}>
          <div style={{ width: 320, borderRight: '1px solid var(--oh-border)', display: 'flex', flexDirection: 'column' }}>
            {isAdmin && (
              <div style={{ display: 'flex', gap: 6, padding: 8, borderBottom: '1px solid var(--oh-border)' }}>
                <button type="button" style={tabBtn(leftTab === 'chats')} onClick={() => setLeftTab('chats')}>Chats</button>
                <button type="button" style={tabBtn(leftTab === 'users')} onClick={() => setLeftTab('users')}>Users</button>
              </div>
            )}
            <div className="oh-chatlist" style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
              {scopeBlocked ? (
                <div className="empty-state"><p>No cities in your scope.</p></div>
              ) : (isAdmin && leftTab === 'users') ? (
                <CometChatUsers
                  usersRequestBuilder={usersRequestBuilder}
                  onItemClick={(u) => setPeer(u)}
                />
              ) : (
                <CometChatConversations
                  {...(conversationsRequestBuilder ? { conversationsRequestBuilder } : {})}
                  onItemClick={(conv) => setPeer(conv?.getConversationWith?.())}
                />
              )}
            </div>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            {peer ? (
              <>
                <div style={{ display: 'flex', gap: 6, padding: 8, borderBottom: '1px solid var(--oh-border)', justifyContent: 'flex-end' }}>
                  <button type="button" style={paneBtn(paneTab === 'live')} onClick={() => setPaneTab('live')}>Live</button>
                  <button type="button" style={paneBtn(paneTab === 'history')} onClick={() => setPaneTab('history')} title="See who sent each message">History</button>
                </div>
                <ChatErrorBoundary key={paneTab}>
                  {paneTab === 'history' ? (
                    <ChatHistory cpId={peerCpId(peer)} />
                  ) : (
                    <>
                      <CometChatMessageHeader user={peer} />
                      <CometChatMessageList user={peer} />
                      <ChatComposer onSend={(t) => api.cometSend({ cp_id: peerCpId(peer), text: t })} />
                    </>
                  )}
                </ChatErrorBoundary>
              </>
            ) : (
              <div className="empty-state"><p>Select a conversation</p></div>
            )}
          </div>
        </div>
        </CometChatProvider>
      )}
      {broadcastOpen && (
        <BroadcastModal onClose={() => setBroadcastOpen(false)} />
      )}
      {manageOpen && (
        <ChatUserManager onClose={() => setManageOpen(false)} onStartChat={handleStartChat} />
      )}
    </div>
  );
}
