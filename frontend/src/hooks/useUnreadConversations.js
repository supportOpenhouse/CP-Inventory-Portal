import { useEffect, useState } from 'react';
import { CometChat } from '@cometchat/chat-sdk-javascript';
import { loginCometChat } from '../cometchat';

/**
 * List of CP conversations that have unread messages, most-recent first — the
 * richer sibling of useUnreadChat (which only returns a count). Each entry:
 *   { uid, name, unread, text }
 *
 * Non-admins are scoped to their city via the `city:<city>` tag (same rule as
 * the Chat page). Refreshes on login, a live message listener, a 15s visible
 * poll, focus, and `chat:changed`. Silent no-op when chat isn't configured.
 */
export function useUnreadConversations({ city = '', isAdmin = false, enabled = true } = {}) {
  const [list, setList] = useState([]);

  useEffect(() => {
    if (!enabled) { setList([]); return undefined; }
    let alive = true;
    let interval;

    const refresh = () => {
      const req = new CometChat.ConversationsRequestBuilder().setLimit(50).setConversationType('user');
      if (!isAdmin && city) req.withTags(true).setTags([`city:${city}`]);
      req.build().fetchNext()
        .then((convos) => {
          if (!alive) return;
          const unread = (convos || [])
            .filter((c) => c.getUnreadMessageCount() > 0)
            .map((c) => {
              const u = c.getConversationWith();
              const last = c.getLastMessage();
              return {
                uid: u?.getUid?.() || '',
                name: u?.getName?.() || 'CP',
                unread: c.getUnreadMessageCount(),
                text: last?.getText?.() || last?.text || '',
              };
            });
          setList(unread);
        })
        .catch(() => {});
    };
    const onFocus = () => { if (!document.hidden) refresh(); };

    loginCometChat()
      .then(() => {
        if (!alive) return;
        refresh();
        CometChat.addMessageListener('oh-unread-convos', new CometChat.MessageListener({
          onTextMessageReceived: refresh,
          onMediaMessageReceived: refresh,
        }));
        interval = setInterval(() => { if (!document.hidden) refresh(); }, 15000);
        window.addEventListener('focus', onFocus);
        window.addEventListener('chat:changed', refresh);
      })
      .catch(() => { /* chat not enabled — no card */ });

    return () => {
      alive = false;
      if (interval) clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('chat:changed', refresh);
      try { CometChat.removeMessageListener('oh-unread-convos'); } catch { /* not added */ }
    };
  }, [city, isAdmin, enabled]);

  return list;
}
