/**
 * Counter Offer — negotiation tally, current offer/response state, and the
 * "send a counter offer" composer. Ported from CP DetailPanel.jsx
 * ("Counter Offer" block + handleSendCounterOffer), price is sent in lakhs
 * (adminSendCounterOffer converts server-side).
 *
 * Visible when in 'Visit Completed' (first counter) or once a
 * counter_offer_status already exists on the row. The composer itself only
 * shows for the first counter ('Visit Completed') or a follow-up once the
 * broker has countered back ('Offer' + 'broker_countered') — hidden while a
 * counter is still 'pending'. Gated on `canAct` so viewers can't send one.
 */
import { useState } from 'react';
import { api } from '../../../api';
import { formatPrice, formatDateTime } from '../../../format';

function tone(status) {
  if (status === 'pending') return { bg: 'var(--amber-bg)', border: 'var(--amber)' };
  if (status === 'accepted') return { bg: 'var(--green-bg)', border: 'var(--green)' };
  return { bg: 'var(--red-bg)', border: 'var(--red)' }; // rejected / broker_countered / other
}

export default function CounterOfferSection({ submission, canAct, onChanged }) {
  const [lakhs, setLakhs] = useState('');
  const [sending, setSending] = useState(false);

  if (!submission) return null;
  const s = submission;
  if (!(s.status === 'Visit Completed' || s.counter_offer_status)) return null;

  const handleSend = async () => {
    const val = parseFloat(lakhs);
    if (!isFinite(val) || val <= 0) {
      alert('Enter a valid counter offer in lakhs');
      return;
    }
    if (!window.confirm(
      `Send counter offer of ₹${val} lakhs to the CP?\n\nThis moves the listing to 'Offer Given'. The CP can accept, reject (moves to 'Price Rejected'), or counter back.`
    )) return;
    setSending(true);
    try {
      await api.adminSendCounterOffer(s.id, val);
      setLakhs('');
      const fresh = await api.adminGetSubmission(s.id);
      onChanged?.({ ...fresh.submission, events: fresh.events });
    } catch (err) {
      alert(err.message || 'Failed to send counter offer');
    } finally {
      setSending(false);
    }
  };

  const t = tone(s.counter_offer_status);
  const showInput = canAct && s.counter_offer_status !== 'pending'
    && (s.status === 'Visit Completed' || (s.status === 'Offer' && s.counter_offer_status === 'broker_countered'));

  return (
    <div className="card-block">
      <h3>Counter Offer</h3>

      {(s.counter_offers_sent > 0 || s.cp_counter_offers > 0) && (
        <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
          <strong style={{ color: 'var(--text)' }}>{s.counter_offers_sent || 0}</strong> sent
          {' · '}
          <strong style={{ color: 'var(--text)' }}>{s.cp_counter_offers || 0}</strong> countered by CP
        </div>
      )}

      {s.counter_offer_status && (
        <div style={{
          padding: '10px 12px',
          background: t.bg,
          border: `1px solid ${t.border}`,
          borderRadius: 'var(--r-sm)',
          marginBottom: 10,
          fontSize: 13,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>
            {formatPrice(s.counter_offer_price)} · {s.counter_offer_status.toUpperCase()}
          </div>
          <div className="muted" style={{ fontSize: 11 }}>
            Sent {s.counter_offer_at ? formatDateTime(s.counter_offer_at) : '—'}
          </div>
          {s.counter_offer_status === 'broker_countered' && s.broker_counter_price != null && (
            <div style={{ fontWeight: 600, marginTop: 6 }}>
              Broker countered: {formatPrice(s.broker_counter_price)}
              {s.broker_counter_at && (
                <span className="muted" style={{ fontWeight: 400, fontSize: 11, marginLeft: 6 }}>
                  {formatDateTime(s.broker_counter_at)}
                </span>
              )}
            </div>
          )}
          {s.counter_offer_response_text && (
            <div style={{
              marginTop: 8,
              padding: '8px 10px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-sm)',
              fontSize: 12,
              color: 'var(--text)',
            }}>
              <div className="field-lbl" style={{ marginBottom: 2 }}>CP note</div>
              "{s.counter_offer_response_text}"
            </div>
          )}
        </div>
      )}

      {showInput && (
        <>
          <div className="field-lbl">Send counter offer (in lakhs)</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <input
              type="text"
              inputMode="decimal"
              placeholder="e.g. 92"
              value={lakhs}
              onChange={(e) => setLakhs(e.target.value.replace(/[^0-9.]/g, ''))}
              disabled={sending}
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || !lakhs}
              className="btn-primary"
              style={{ flex: '0 0 auto' }}
            >
              {sending ? 'Sending…' : 'Send offer'}
            </button>
          </div>
          {lakhs && parseFloat(lakhs) > 0 && (
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              = {formatPrice(parseFloat(lakhs) * 100000)}
            </div>
          )}
          <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
            CP will accept/reject from their dashboard. Status auto-updates on response.
          </div>
        </>
      )}
    </div>
  );
}
