import { useEffect, useRef, useState } from 'react';

import { api, ApiError } from '../../api';
import { formatDateTime } from '../../format';

/**
 * WhatsApp thread for one CP. Two modes:
 *   - submissionId given → fetch via /admin/submissions/<id>/whatsapp
 *     (server resolves the CP's phone and returns the full thread)
 *   - phone given        → fetch via /admin/whatsapp/threads/<phone>
 *
 * Send box renders when `canSend` is true AND we know the phone (either
 * given directly, or resolved from the per-submission fetch).
 *
 * Outbound rows render with the rendered template body (we expand the saved
 * body_params into the static template text on the client) so admins see
 * what the CP saw, not "cp_visit_reminder | [Foo, Bar, 6]".
 */
const TEMPLATES = {
  cp_visit_reminder: ({ params }) => {
    const [name = '{{1}}', unit = '{{2}}', days = '{{3}}'] = params || [];
    return (
      `Hi ${name},\n\n` +
      `Greetings from Openhouse! Your submitted unit ${unit} has been approved. ` +
      `Please schedule the visit within next ${days} days to ensure a smooth process. Thank you.\n\n` +
      `Team Openhouse`
    );
  },
  cp_sellermeeting_reminder: ({ params }) => {
    const [name = '{{1}}', unit = '{{2}}', days = '{{3}}'] = params || [];
    return (
      `Hi ${name},\n\n` +
      `The visit for ${unit} has been completed. Please arrange the seller meeting within next ${days} days to keep the process on track. Thank you.\n\n` +
      `Team Openhouse`
    );
  },
};

function renderBody(msg) {
  if (msg.direction === 'outbound') {
    if (msg.template_name) {
      const tpl = TEMPLATES[msg.template_name];
      if (tpl) return tpl({ params: msg.body_params || [] });
    }
    return msg.body || msg.template_name || '(message)';
  }
  return msg.body || '(empty)';
}

export default function WhatsAppThread({
  submissionId,
  phone,
  hideEmpty = false,
  canSend = true,
}) {
  const [state, setState] = useState({ loading: true, messages: [], error: null });
  const [resolvedPhone, setResolvedPhone] = useState(phone || null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const endRef = useRef(null);

  const reload = () => {
    setState((st) => ({ ...st, loading: true }));
    const p = submissionId
      ? api.adminGetSubmissionWhatsApp(submissionId)
      : api.adminGetWhatsAppThread(phone);
    return p.then((data) => {
      setState({ loading: false, messages: data.messages || [], error: null });
      if (data.phone) setResolvedPhone(data.phone);
    }).catch((err) => {
      setState({
        loading: false, messages: [],
        error: err instanceof ApiError ? err.message : 'Failed to load WhatsApp thread',
      });
    });
  };

  useEffect(() => {
    let alive = true;
    setState({ loading: true, messages: [], error: null });
    setResolvedPhone(phone || null);
    const p = submissionId
      ? api.adminGetSubmissionWhatsApp(submissionId)
      : api.adminGetWhatsAppThread(phone);
    p.then((data) => {
      if (!alive) return;
      setState({ loading: false, messages: data.messages || [], error: null });
      if (data.phone) setResolvedPhone(data.phone);
    }).catch((err) => {
      if (!alive) return;
      setState({
        loading: false, messages: [],
        error: err instanceof ApiError ? err.message : 'Failed to load WhatsApp thread',
      });
    });
    return () => { alive = false; };
  }, [submissionId, phone]);

  // Auto-scroll to the bottom whenever the message list grows so new
  // replies (or the message we just sent) land in view.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [state.messages.length]);

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || sending || !resolvedPhone) return;
    setSending(true);
    setSendError(null);
    try {
      await api.adminSendWhatsAppMessage(resolvedPhone, text);
      setDraft('');
      await reload();
    } catch (err) {
      // Surface Interakt's error verbatim — most likely cause is the
      // 24h-window rule. Operator can decide whether to retry or send
      // a template instead.
      const msg = err instanceof ApiError
        ? (err.data?.interakt_body || err.message)
        : 'Send failed';
      setSendError(msg);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="wa-thread-wrap">
      {state.loading ? (
        <div className="wa-thread-empty">Loading…</div>
      ) : state.error ? (
        <div className="wa-thread-empty" style={{ color: '#B91C1C' }}>{state.error}</div>
      ) : state.messages.length === 0 ? (
        hideEmpty ? null : (
          <div className="wa-thread-empty">No WhatsApp messages exchanged yet.</div>
        )
      ) : (
        <div className="wa-thread">
          {state.messages.map((m) => (
            <div
              key={m.id}
              className={`wa-bubble ${m.direction === 'outbound' ? 'wa-out' : 'wa-in'}`}
            >
              <div className="wa-bubble-body">{renderBody(m)}</div>
              <div className="wa-bubble-time">
                {formatDateTime(m.received_at)}
                {m.template_name && <span className="wa-tpl"> · {m.template_name}</span>}
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}

      {canSend && resolvedPhone && (
        <div className="wa-composer">
          {sendError && (
            <div className="wa-composer-error" title={sendError}>
              {sendError.length > 200 ? sendError.slice(0, 200) + '…' : sendError}
            </div>
          )}
          <div className="wa-composer-row">
            <textarea
              className="wa-composer-input"
              placeholder="Type a message…"
              value={draft}
              rows={1}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              disabled={sending}
            />
            <button
              className="wa-composer-send"
              onClick={handleSend}
              disabled={sending || !draft.trim()}
              title="Send (Enter)"
            >
              {sending ? '…' : 'Send'}
            </button>
          </div>
          <div className="wa-composer-hint">
            Free-text replies only work within 24 hours of the CP's last message.
            Outside that, only template messages are allowed (sent via the daily reminder cron).
          </div>
        </div>
      )}
    </div>
  );
}
