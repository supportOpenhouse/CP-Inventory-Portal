import { useState } from 'react';

import { api, ApiError } from '../api';
import { todayInIST } from '../format';

/**
 * CP "Book visit slot" popup — pick a date (no past dates) and a time-of-day
 * slot. Submitting records a visit REQUEST (it does not change the listing's
 * stage). The RM is assigned by staff later, not chosen by the CP.
 *
 * Props: open, submissionId, onClose, onBooked (fires after a successful request)
 */
const SLOTS = [
  { key: 'morning', label: 'Morning' },
  { key: 'afternoon', label: 'Afternoon' },
  { key: 'evening', label: 'Evening' },
];

export default function BookVisitModal({ open, submissionId, onClose, onBooked }) {
  const [date, setDate] = useState('');
  const [slot, setSlot] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const submit = async () => {
    setError('');
    if (!date) { setError('Choose a date'); return; }
    if (!slot) { setError('Choose a time slot'); return; }
    setBusy(true);
    try {
      await api.bookVisit(submissionId, { date, slot });
      onBooked?.();
      onClose?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not book the visit');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onClick={busy ? undefined : onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
        zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20, backdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 16, padding: 22, maxWidth: 380, width: '100%',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ fontFamily: 'Fraunces, serif', fontSize: 20, fontWeight: 700, color: 'var(--oh-charcoal)', marginBottom: 14 }}>
          Book visit slot
        </div>

        <div className="input-label">Date</div>
        <input
          type="date" className="input-field" value={date}
          min={todayInIST()} onChange={(e) => setDate(e.target.value)}
        />

        <div className="input-label" style={{ marginTop: 14 }}>Time slot</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {SLOTS.map((sl) => (
            <button
              key={sl.key} type="button"
              onClick={() => setSlot(sl.key)}
              style={{
                flex: 1, padding: '10px 8px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
                border: `1.5px solid ${slot === sl.key ? 'var(--oh-orange)' : 'var(--oh-border)'}`,
                background: slot === sl.key ? 'var(--oh-orange)' : '#fff',
                color: slot === sl.key ? '#fff' : 'var(--oh-charcoal)',
              }}
            >
              {sl.label}
            </button>
          ))}
        </div>

        {error && <div className="error-text" style={{ marginTop: 12 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button
            type="button" onClick={onClose} disabled={busy}
            style={{
              flex: 1, padding: 12, borderRadius: 10, border: '1.5px solid var(--oh-border)',
              background: '#fff', fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
            }}
          >
            Cancel
          </button>
          <button
            type="button" className="primary-btn" style={{ flex: 1 }}
            onClick={submit} disabled={busy}
          >
            {busy ? 'Booking…' : 'Request visit'}
          </button>
        </div>
      </div>
    </div>
  );
}
