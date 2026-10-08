/**
 * Embedded CometChat thread for one CP — the submission's chat, shown inside
 * the detail popup / table-expand. Ensures the CP's CometChat user exists (they
 * may never have opened chat themselves) before opening the thread. Ported from
 * CP's screens/Admin/CpThread.jsx, but sends through our logging ChatComposer.
 */
import { useEffect, useState } from 'react';
import {
  CometChatMessageHeader, CometChatMessageList, CometChatProvider,
} from '@cometchat/chat-uikit-react';
import { CometChat } from '@cometchat/chat-sdk-javascript';
import { loginCometChat, ensureCpUser } from '../../cometchat';
import { useTheme } from '../../contexts/ThemeContext.jsx';
import { api } from '../../api';
import ChatErrorBoundary from '../ChatErrorBoundary';
import ChatComposer from '../ChatComposer';

export default function CpThread({ cpId }) {
  const { theme } = useTheme();
  const [peer, setPeer] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setPeer(null);
    setError(false);
    if (!cpId) return undefined;
    (async () => {
      // The CP may never have logged into chat → their CometChat user won't
      // exist yet and getUser would reject. Provision it first (staff-only).
      await ensureCpUser(cpId);
      await loginCometChat();
      return CometChat.getUser(`cp_${cpId}`);
    })()
      .then((u) => { if (alive) setPeer(u); })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [cpId]);

  if (error) return <div className="muted" style={{ fontSize: 12 }}>Chat unavailable.</div>;
  if (!peer) return <div className="muted" style={{ fontSize: 12 }}>Loading chat…</div>;

  return (
    <ChatErrorBoundary>
      <CometChatProvider theme={theme}>
        <div className="cp-thread">
          <CometChatMessageHeader user={peer} />
          <CometChatMessageList user={peer} />
          <ChatComposer onSend={(t) => api.cometSend({ cp_id: cpId, text: t })} />
        </div>
      </CometChatProvider>
    </ChatErrorBoundary>
  );
}
