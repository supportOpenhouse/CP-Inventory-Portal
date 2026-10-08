import { useEffect, useState } from 'react';
import { CometChat } from '@cometchat/chat-sdk-javascript';
import { loginCometChat } from '../cometchat';

const STAFF_UID = 'openhouse';

/**
 * Unread chat count from the CometChat SDK (there is no backend endpoint for
 * it). Two modes drive two badges:
 *   - default (CP):   total unread MESSAGES from the shared "openhouse" thread.
 *   - people (admin): number of distinct CPs (people) that have any unread.
 *
 * Refreshes: initial fetch after login, a real-time message listener, a 15s
 * poll while visible, and on focus / a `chat:changed` event. Silent no-op when
 * chat isn't enabled/configured (login rejects) or `enabled` is false.
 */
export function useUnreadChat({ people = false, enabled = true } = {}) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) { setCount(0); return undefined; }
    let alive = true;
    let interval;
    const listenerId = `oh-unread-chat-${people ? 'people' : 'msgs'}`;

    const refresh = () => {
      const p = people
        ? CometChat.getUnreadMessageCountForAllUsers().then((res) => Object.values(res || {}).filter((n) => Number(n) > 0).length)
        : CometChat.getUnreadMessageCountForUser(STAFF_UID).then((res) => Number(res?.[STAFF_UID]) || 0);
      p.then((n) => { if (alive) setCount(n); }).catch(() => {});
    };
    const onFocus = () => { if (!document.hidden) refresh(); };

    loginCometChat()
      .then(() => {
        if (!alive) return;
        refresh();
        CometChat.addMessageListener(listenerId, new CometChat.MessageListener({
          onTextMessageReceived: refresh,
          onMediaMessageReceived: refresh,
        }));
        interval = setInterval(() => { if (!document.hidden) refresh(); }, 15000);
        window.addEventListener('focus', onFocus);
        window.addEventListener('chat:changed', refresh);
      })
      .catch(() => { /* chat not enabled — no badge */ });

    return () => {
      alive = false;
      if (interval) clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('chat:changed', refresh);
      try { CometChat.removeMessageListener(listenerId); } catch { /* not added */ }
    };
  }, [people, enabled]);

  return count;
}
