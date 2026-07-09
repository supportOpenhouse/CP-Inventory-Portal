import { useEffect, useState } from 'react';

import { api } from '../../api';

/**
 * Read-only attributed history for one CP, fetched on demand from
 * chat_messages (NOT the live CometChat stream) so the admin can see WHICH
 * staff member sent each message behind the shared "openhouse" identity.
 * One request per open — no per-live-message backend load.
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
    <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {msgs.map((m) => {
        const out = m.direction === 'outbound';
        return (
          <div key={m.id} style={{ alignSelf: out ? 'flex-end' : 'flex-start', maxWidth: '72%' }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 3, textAlign: out ? 'right' : 'left' }}>
              <strong style={{ color: out ? '#c2410c' : '#555' }}>{m.sender}</strong>
              {m.sent_at ? ` · ${new Date(m.sent_at).toLocaleString()}` : ''}
            </div>
            <div style={{
              padding: '8px 12px', borderRadius: 12, fontSize: 14, lineHeight: 1.35,
              background: out ? 'var(--oh-orange, #FF6B2B)' : '#efeef1',
              color: out ? '#fff' : '#222', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>{m.body}</div>
          </div>
        );
      })}
    </div>
  );
}
