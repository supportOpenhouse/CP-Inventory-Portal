import { useEffect, useState } from 'react';
import { CometChat } from '@cometchat/chat-sdk-javascript';

import { loginCometChat } from '../cometchat';

/**
 * Total unread chat count for the logged-in portal user, read from CometChat's
 * OWN read tracking — no backend load. Live-updates via a message listener;
 * call refresh() after the user views a chat to re-sync the badge.
 *
 * ponytail: logs into CometChat on mount just to read the count. Fine while
 * chat is admin-gated (few enabled users); if chat goes universal, cache the
 * auth token so every dashboard load doesn't re-issue one.
 */
export function useUnreadChat() {
  const [count, setCount] = useState(0);

  const refresh = async () => {
    try {
      await loginCometChat();
      const res = await CometChat.getUnreadMessageCount();
      // Shape: { users: { uid: n }, groups: { guid: n } } — sum every leaf.
      let total = 0;
      for (const bucket of Object.values(res || {})) {
        for (const n of Object.values(bucket || {})) total += Number(n) || 0;
      }
      setCount(total);
    } catch {
      setCount(0); // not enabled / not logged in → no badge
    }
  };

  useEffect(() => {
    let alive = true;
    const listenerId = 'unread-badge';
    (async () => {
      await refresh();
      if (!alive) return;
      try {
        CometChat.addMessageListener(
          listenerId,
          new CometChat.MessageListener({
            onTextMessageReceived: () => { if (alive) refresh(); },
            onMediaMessageReceived: () => { if (alive) refresh(); },
          }),
        );
      } catch { /* SDK not ready — badge just won't live-update */ }
    })();
    return () => {
      alive = false;
      try { CometChat.removeMessageListener(listenerId); } catch { /* ignore */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { count, refresh };
}
