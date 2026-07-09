import { useEffect, useState } from 'react';
import {
  CometChatMessageHeader, CometChatMessageList, CometChatMessageComposer,
  CometChatProvider,
} from '@cometchat/chat-uikit-react';
import { CometChat } from '@cometchat/chat-sdk-javascript';
import { loginCometChat } from '../../cometchat';
import { api } from '../../api';
import ChatErrorBoundary from '../../components/ChatErrorBoundary';

export default function CpThread({ cpId }) {
  const [peer, setPeer] = useState(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    setPeer(null);
    setError(false);
    if (!cpId) return;
    (async () => {
      // The CP may have never logged into chat themselves, in which case
      // their CometChat user doesn't exist yet and getUser() below would
      // reject, leaving the panel stuck on "Loading chat…" forever. Ensure
      // it exists first (staff-only endpoint).
      await api.cometEnsureCpUser(cpId);
      await loginCometChat();
      return CometChat.getUser(`cp_${cpId}`);
    })()
      .then((u) => alive && setPeer(u))
      .catch(() => alive && setError(true));
    return () => { alive = false; };
  }, [cpId]);
  if (error) return <div style={{ fontSize: 12, color: '#999' }}>Chat unavailable</div>;
  if (!peer) return <div style={{ fontSize: 12, color: '#999' }}>Loading chat…</div>;
  return (
    <ChatErrorBoundary>
      <CometChatProvider>
        <div style={{ height: 360, display: 'flex', flexDirection: 'column' }}>
          <CometChatMessageHeader user={peer} />
          <CometChatMessageList user={peer} />
          <CometChatMessageComposer user={peer} />
        </div>
      </CometChatProvider>
    </ChatErrorBoundary>
  );
}
