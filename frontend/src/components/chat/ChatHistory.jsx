import { useEffect, useState } from 'react';
import { api } from '../../api';

/**
 * Read-only attributed history for one CP, fetched on demand from chat_messages
 * (NOT the live CometChat stream) so the admin can see WHICH staff member sent
 * each message behind the shared "openhouse" identity. Ported to our tokens.
 */
export default function ChatHistory({ cpId }) {
  const [msgs, setMsgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!cpId) { setLoading(false); return undefined; }
    let alive = true;
    setLoading(true);
    setErr('');
    api.cometHistory(cpId)
      .then((d) => { if (alive) setMsgs(d?.messages || []); })
      .catch(() => { if (alive) setErr('Could not load history.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [cpId]);

  if (!cpId) return <div className="empty-state"><p>No CP selected.</p></div>;
  if (loading) return <div className="empty-state"><p>Loading history…</p></div>;
  if (err) return <div className="empty-state"><p>{err}</p></div>;
  if (!msgs.length) {
    return (
      <div className="empty-state">
        <p>No logged messages yet.<br />Sender attribution is captured for messages sent from this app going forward.</p>
      </div>
    );
  }

  return (
    <div className="chat-history">
      {msgs.map((m) => {
        const out = m.direction === 'outbound';
        return (
          <div key={m.id} className={`chat-msg ${out ? 'chat-msg-out' : 'chat-msg-in'}`}>
            <div className="chat-msg-meta">
              <strong>{m.sender}</strong>
              {m.sent_at ? ` · ${new Date(m.sent_at).toLocaleString()}` : ''}
            </div>
            <div className="chat-msg-bubble">{m.body}</div>
          </div>
        );
      })}
    </div>
  );
}
