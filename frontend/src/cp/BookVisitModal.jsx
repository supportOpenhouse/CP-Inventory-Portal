import { useState } from 'react';

import { api, ApiError } from '../api';
import { todayInIST, nowTimeIST } from '../format';

/**
 * CP "Book visit slot" popup — pick a date (no past dates) and a time-of-day
 * slot. Submitting records a visit REQUEST (it does not change the listing's
 * stage). The RM is assigned by staff later, not chosen by the CP.
 *
 * Props: open, submissionId, onClose, onBooked (fires after a successful request)
 */
// `end` = 24-hour end of each window; a slot is unbookable once that time has
// passed, which only matters when the chosen date is today.
const SLOTS = [
  { key: 'morning', label: 'Morning', time: '10 AM - 1 PM', end: '13:00' },
  { key: 'afternoon', label: 'Afternoon', time: '1 PM - 4 PM', end: '16:00' },
  { key: 'evening', label: 'Evening', time: '4 PM - 7 PM', end: '19:00' },
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
    if (date < todayInIST()) { setError('Choose today or a future date'); return; }
    if (!slot) { setError('Choose a time slot'); return; }
    if (date === todayInIST() && nowTimeIST() >= (SLOTS.find((x) => x.key === slot)?.end || '')) {
      setError('That slot has already passed today — pick a later one');
      return;
    }
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

  const isToday = date === todayInIST();
  const now = nowTimeIST();
  const slotPast = (sl) => isToday && now >= sl.end;

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
          min={todayInIST()}
          onChange={(e) => {
            const d = e.target.value;
            setDate(d);
            // Deselect a slot that's already past once the date becomes today.
            if (slot && d === todayInIST() && nowTimeIST() >= (SLOTS.find((x) => x.key === slot)?.end || '')) {
              setSlot('');
            }
          }}
        />

        <div className="input-label" style={{ marginTop: 14 }}>Time slot</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {SLOTS.map((sl) => {
            const past = slotPast(sl);
            return (
            <button
              key={sl.key} type="button"
              onClick={() => { if (!past) setSlot(sl.key); }}
              disabled={past}
              style={{
                flex: 1, padding: '8px 6px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                cursor: past ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                opacity: past ? 0.4 : 1,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, lineHeight: 1.2,
                border: `1.5px solid ${slot === sl.key ? 'var(--oh-orange)' : 'var(--oh-border)'}`,
                background: slot === sl.key ? 'var(--oh-orange)' : '#fff',
                color: slot === sl.key ? '#fff' : 'var(--oh-charcoal)',
              }}
            >
              <span>{sl.label}</span>
              <span style={{ fontSize: 9.5, fontWeight: 500, opacity: 0.85, whiteSpace: 'nowrap' }}>
                {sl.time}
              </span>
            </button>
            );
          })}
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
