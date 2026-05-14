import { useEffect, useState } from 'react';

import { api, ApiError } from '../../api';
import { formatDateTime } from '../../format';

/**
 * Read-only WhatsApp thread for one CP, scoped via a submission id (the
 * detail panel's context) or a raw phone (the inbox view).
 *
 * Outbound rows render as the rendered template body (we expand the saved
 * body_params into the static template text on the client so the admin
 * sees what the CP saw, not "cp_visit_reminder | [Foo, Bar, 6]").
 *
 * Sending replies from the app isn't supported yet — Interakt requires a
 * separate session-message API + opt-in handling. For now this is a
 * visibility surface only.
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
    const tpl = TEMPLATES[msg.template_name];
    if (tpl) return tpl({ params: msg.body_params || [] });
    return msg.body || msg.template_name || '(message)';
  }
  return msg.body || '(empty)';
}

export default function WhatsAppThread({ submissionId, phone, hideEmpty = false }) {
  const [state, setState] = useState({ loading: true, messages: [], error: null });

  useEffect(() => {
    let alive = true;
    setState({ loading: true, messages: [], error: null });
    const p = submissionId
      ? api.adminGetSubmissionWhatsApp(submissionId)
      : api.adminGetWhatsAppThread(phone);
    p.then((data) => {
      if (!alive) return;
      setState({ loading: false, messages: data.messages || [], error: null });
    }).catch((err) => {
      if (!alive) return;
      setState({
        loading: false, messages: [],
        error: err instanceof ApiError ? err.message : 'Failed to load WhatsApp thread',
      });
    });
    return () => { alive = false; };
  }, [submissionId, phone]);

  if (state.loading) {
    return <div style={{ fontSize: 12, color: '#999', padding: '8px 0' }}>Loading WhatsApp thread…</div>;
  }
  if (state.error) {
    return <div style={{ fontSize: 12, color: '#B91C1C', padding: '8px 0' }}>{state.error}</div>;
  }
  if (state.messages.length === 0) {
    if (hideEmpty) return null;
    return (
      <div style={{ fontSize: 12, color: '#999', padding: '8px 0', fontStyle: 'italic' }}>
        No WhatsApp messages exchanged yet.
      </div>
    );
  }

  return (
    <div className="wa-thread">
      {state.messages.map((m) => (
        <div
          key={m.id}
          className={`wa-bubble ${m.direction === 'outbound' ? 'wa-out' : 'wa-in'}`}
        >
          <div className="wa-bubble-meta">
            {m.direction === 'outbound' ? 'Openhouse' : 'CP reply'}
            {' · '}
            {formatDateTime(m.received_at)}
            {m.template_name && <span className="wa-tpl">· {m.template_name}</span>}
          </div>
          <div className="wa-bubble-body">{renderBody(m)}</div>
        </div>
      ))}
    </div>
  );
}
