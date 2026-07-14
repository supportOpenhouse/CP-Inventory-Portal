/**
 * Admin Chat page — CP conversation inbox. Left: CometChat conversation/user
 * list (role-scoped — admins see every CP, manager/rm only their city's CPs
 * via a `city:<name>` tag). Right: live message pane (CometChat UIKit) or the
 * attributed DB history. Ported from CP's screens/Admin/ChatInbox.jsx into a
 * routed page inside our Layout (which supplies the sidebar + topbar chrome).
 */
import { useEffect, useMemo, useState } from 'react';
import {
  CometChatConversations, CometChatUsers,
  CometChatMessageHeader, CometChatMessageList, CometChatProvider,
} from '@cometchat/chat-uikit-react';
import { CometChat } from '@cometchat/chat-sdk-javascript';
import { loginCometChat } from '../cometchat';
import { useTheme } from '../contexts/ThemeContext.jsx';
import { api } from '../api';
import { useAuth } from '../contexts/AuthContext.jsx';
import ChatErrorBoundary from '../components/ChatErrorBoundary';
import ChatComposer from '../components/ChatComposer';
import BroadcastModal from '../components/chat/BroadcastModal';
import ChatUserManager from '../components/chat/ChatUserManager';
import ChatHistory from '../components/chat/ChatHistory';

// CometChat user uid 'cp_<id>' -> numeric cp_id (null for the shared staff uid).
function peerCpId(peer) {
  const uid = peer?.getUid?.() || '';
  return uid.startsWith('cp_') ? parseInt(uid.slice(3), 10) : null;
}

export default function Chat() {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [peer, setPeer] = useState(null);
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

  // Broadcast / Manage-users live on the Layout topbar (admin only); they reach
  // us via window events, same pattern as Submissions' Add-Inventory button.
  useEffect(() => {
    const openB = () => setBroadcastOpen(true);
    const openM = () => setManageOpen(true);
    window.addEventListener('chat:broadcast', openB);
    window.addEventListener('chat:manage', openM);
    return () => {
      window.removeEventListener('chat:broadcast', openB);
      window.removeEventListener('chat:manage', openM);
    };
  }, []);

  const isAdmin = user?.role === 'admin';
  // admin sees all CP conversations; manager/rm limited to their (single) city.
  let conversationsRequestBuilder;
  if (!isAdmin && user?.city) {
    conversationsRequestBuilder = new CometChat.ConversationsRequestBuilder()
      .setLimit(50).withTags(true).setTags(['city:' + user.city]);
  }
  // FAIL CLOSED: a non-admin with no city scope must not see the all-CPs list.
  const scopeBlocked = !isAdmin && !user?.city;

  const handleStartChat = (cpId) => {
    setManageOpen(false);
    CometChat.getUser(`cp_${cpId}`).then((u) => setPeer(u)).catch(() => {});
  };

  const usersRequestBuilder = useMemo(
    () => new CometChat.UsersRequestBuilder().setLimit(50).withTags(true).setTags(['cp']),
    [],
  );

  return (
    <div className="chat-page">
      {error ? (
        <div className="empty-state"><p>{error}</p></div>
      ) : !ready ? (
        <div className="empty-state"><p>Loading chat…</p></div>
      ) : (
        // theme={theme} feeds CometChat our app theme so its bundled dark palette
        // responds (default is 'light'). .chat-inbox's brand-accent vars sit inside
        // its themed wrapper, so our accent still wins over CometChat's purple.
        <CometChatProvider theme={theme}>
          <div className="chat-inbox">
            <div className="chat-list">
              {isAdmin && (
                <div className="chat-seg">
                  <button type="button" className={`chat-seg-btn${leftTab === 'chats' ? ' active' : ''}`} onClick={() => setLeftTab('chats')}>Chats</button>
                  <button type="button" className={`chat-seg-btn${leftTab === 'users' ? ' active' : ''}`} onClick={() => setLeftTab('users')}>Users</button>
                </div>
              )}
              <div className="oh-chatlist">
                {scopeBlocked ? (
                  <div className="empty-state"><p>No cities in your scope.</p></div>
                ) : (isAdmin && leftTab === 'users') ? (
                  <CometChatUsers usersRequestBuilder={usersRequestBuilder} onItemClick={(u) => setPeer(u)} />
                ) : (
                  <CometChatConversations
                    {...(conversationsRequestBuilder ? { conversationsRequestBuilder } : {})}
                    onItemClick={(conv) => setPeer(conv?.getConversationWith?.())}
                  />
                )}
              </div>
            </div>

            <div className="chat-pane">
              {peer ? (
                <>
                  <div className="chat-seg chat-seg-end">
                    <button type="button" className={`chat-seg-btn${paneTab === 'live' ? ' active' : ''}`} onClick={() => setPaneTab('live')}>Live</button>
                    <button type="button" className={`chat-seg-btn${paneTab === 'history' ? ' active' : ''}`} onClick={() => setPaneTab('history')} title="See who sent each message">History</button>
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

      {broadcastOpen && <BroadcastModal onClose={() => setBroadcastOpen(false)} />}
      {manageOpen && <ChatUserManager onClose={() => setManageOpen(false)} onStartChat={handleStartChat} />}
    </div>
  );
}
