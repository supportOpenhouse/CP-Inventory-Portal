/**
 * Schedule Visit — pushes a listing to the external Forms app. Ported from
 * CP DetailPanel.jsx (nested `ScheduleVisitSection` component + `to24h`
 * helper).
 *
 * Two states:
 *   1. Not yet scheduled (no forms_uid): a button opens a modal collecting
 *      schedule_date / schedule_time / field_exec_id. A pre-flight lookup
 *      (adminListPropertiesBySociety) warns the admin if Openhouse already
 *      has units in this society before pushing to Forms; a slot conflict
 *      surfaces the Forms app's suggested_times as tappable chips.
 *   2. Already scheduled (forms_uid set): a read-only info pill with the
 *      UID / date / time / field exec.
 *
 * Visible on Submitted / Visit Requested / Visit Scheduled rows, and only
 * when the row already has a forms_uid OR the caller can act (`canAct`).
 */
import { useEffect, useState } from 'react';
import { IconCalendar } from '../../icons.jsx';
import { api, ApiError } from '../../../api';
import {
  formatDateOnly, formatTime12, todayInIST, nowTimeIST, VISIT_TIME_SLOTS,
} from '../../../format';
import { getUser } from '../../../auth';

// Forms-app suggested_times come back 12-hour ("1:00 PM"); <input type="time">
// needs 24-hour "HH:MM". Returns null if the string isn't a time we recognise.
function to24h(t) {
  const str = String(t).trim();
  const ampm = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(str);
  if (ampm) {
    const h = (Number(ampm[1]) % 12) + (/PM/i.test(ampm[3]) ? 12 : 0);
    return `${String(h).padStart(2, '0')}:${ampm[2]}`;
  }
  const h24 = /^(\d{1,2}):(\d{2})$/.exec(str);
  if (h24) return `${String(Number(h24[1])).padStart(2, '0')}:${h24[2]}`;
  return null;
}

export default function ScheduleVisitSection({ submission, canAct, onChanged }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [fieldExecs, setFieldExecs] = useState([]);
  const [loadingExecs, setLoadingExecs] = useState(false);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [fieldExecId, setFieldExecId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [missingFields, setMissingFields] = useState([]);
  const [suggestedTimes, setSuggestedTimes] = useState([]); // Forms-app free slots on conflict (12-hour labels)
  const [toast, setToast] = useState(null); // { kind: 'success' | 'error', text }
  // Existing-units warning: when properties-DB has rows for this society, we
  // pause submission and show a confirmation popup before pushing to Forms.
  const [existingUnits, setExistingUnits] = useState(null); // null = not checked; [] = none; [...] = matches

  // Auto-dismiss toast. Declared before any conditional early-return — React
  // requires hook order to stay identical on every render.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  if (!submission) return null;
  const s = submission;
  if (!(s.status === 'Submitted' || s.status === 'Visit Requested' || s.status === 'Visit Scheduled')) return null;
  if (!s.forms_uid && !canAct) return null;

  // Already scheduled — show the info pill instead of the button.
  if (s.forms_uid) {
    return (
      <div className="card-block">
        <h3>Visit Schedule</h3>
        <div style={{
          padding: '12px 14px',
          background: 'var(--green-bg)',
          border: '1.5px solid var(--green)',
          borderRadius: 'var(--r)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--green-fg)' }}>
            ✓ Visit scheduled
          </div>
          <div style={{ fontSize: 12, color: 'var(--green-fg)', fontFamily: 'monospace', fontWeight: 600 }}>
            UID: {s.forms_uid}
          </div>
          <div style={{ fontSize: 13, color: 'var(--green-fg)' }}>
            {formatDateOnly(s.scheduled_date) || '—'}{s.scheduled_time ? ` at ${formatTime12(s.scheduled_time)}` : ''}
            {s.field_exec_name ? ` · ${s.field_exec_name}` : ''}
          </div>
        </div>
      </div>
    );
  }

  const openModal = async () => {
    setError('');
    setMissingFields([]);
    setSuggestedTimes([]);
    setDate('');
    setTime('');
    setFieldExecId('');
    setModalOpen(true);
    if (fieldExecs.length === 0) {
      setLoadingExecs(true);
      try {
        const data = await api.adminListFieldExecs();
        setFieldExecs(data?.field_execs || []);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Failed to load field execs');
      } finally {
        setLoadingExecs(false);
      }
    }
  };

  const closeModal = () => {
    if (submitting) return;
    setModalOpen(false);
  };

  const sendScheduleRequest = async () => {
    setSubmitting(true);
    setSuggestedTimes([]);
    try {
      const result = await api.adminScheduleVisit(s.id, {
        schedule_date: date,
        schedule_time: time,
        field_exec_id: Number(fieldExecId),
      });
      setModalOpen(false);
      setExistingUnits(null);
      const successMsg = result.already_existed
        ? `Visit was already scheduled — UID: ${result.uid}`
        : `Visit scheduled — UID: ${result.uid}`;
      setToast({ kind: 'success', text: successMsg });
      // Patch the fields the server returned directly onto the submission —
      // same shape CP's DetailPanel patched locally — so the section flips
      // to "Already scheduled" without a full refetch. Server auto-promotes
      // Submitted → Visit Scheduled.
      onChanged?.({
        ...s,
        forms_uid: result.uid,
        scheduled_date: result.scheduled_date,
        scheduled_time: result.scheduled_time,
        field_exec_name: result.field_exec_name,
        status: result.status_promoted ? 'Visit Scheduled' : s.status,
        status_reason: result.status_promoted ? null : s.status_reason,
      });
    } catch (e) {
      // The backend forwards the Forms app's body under `details`, so a slot
      // conflict arrives as e.data.details.{message, suggested_times}.
      const details = e instanceof ApiError ? e.data?.details : null;
      const suggested = details?.suggested_times || (e instanceof ApiError ? e.data?.suggested_times : null);
      if (e instanceof ApiError && e.data?.missing_fields) {
        setMissingFields(e.data.missing_fields);
        setError(e.message || 'Listing is missing required fields.');
      } else if (Array.isArray(suggested) && suggested.length > 0) {
        setSuggestedTimes(suggested);
        setError(details?.message || e.message || 'That slot is taken — pick a suggested time.');
      } else {
        setError(e instanceof ApiError ? e.message : 'Failed to schedule visit');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    setError('');
    setMissingFields([]);
    if (!date || !time || !fieldExecId) {
      setError('Please fill in all fields.');
      return;
    }
    if (date < todayInIST()) {
      setError('Pick today or a future date.');
      return;
    }
    if (date === todayInIST() && time < nowTimeIST()) {
      setError('That time has already passed today — pick a later time.');
      return;
    }
    // Pre-flight: warn the admin if Openhouse already has units in this
    // society. On lookup failure we don't block — fall through to schedule.
    setSubmitting(true);
    try {
      const data = await api.adminListPropertiesBySociety(s.society_name || '');
      const units = Array.isArray(data?.units) ? data.units : [];
      if (units.length > 0) {
        setExistingUnits(units);
        setSubmitting(false);
        return; // wait for explicit confirm
      }
    } catch (_) {
      // ignore pre-flight failures — proceed to schedule
    }
    await sendScheduleRequest();
  };

  const confirmExistingAndSchedule = async () => {
    setExistingUnits(null);
    await sendScheduleRequest();
  };

  const cancelExistingWarning = () => {
    if (submitting) return;
    setExistingUnits(null);
  };

  return (
    <div className="card-block">
      <h3>Visit Schedule</h3>
      <button
        type="button"
        onClick={openModal}
        className="btn-primary"
        style={{ width: '100%', justifyContent: 'center', padding: '12px 16px' }}
      >
        <IconCalendar size={15} /> Schedule Visit
      </button>

      {toast && (
        <div style={{
          marginTop: 10,
          padding: '10px 12px',
          borderRadius: 'var(--r-sm)',
          fontSize: 12,
          fontWeight: 600,
          background: toast.kind === 'success' ? 'var(--green-bg)' : 'var(--red-bg)',
          color: toast.kind === 'success' ? 'var(--green-fg)' : 'var(--red-fg)',
          border: `1px solid ${toast.kind === 'success' ? 'var(--green)' : 'var(--red)'}`,
        }}>
          {toast.text}
        </div>
      )}

      {modalOpen && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head-row">
              <h3 style={{ marginBottom: 0 }}>Schedule Visit</h3>
              <button type="button" className="modal-close" onClick={closeModal} aria-label="Close">×</button>
            </div>
            <div className="modal-sub">{s.public_id} · {s.society_name}</div>

            {error && (
              <div className="modal-error">
                {error}
                {missingFields.length > 0 && (
                  <ul style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 12 }}>
                    {missingFields.map((mf, i) => (
                      <li key={i}>{mf.label || mf.field}</li>
                    ))}
                  </ul>
                )}
                {suggestedTimes.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                      Suggested free times — tap to fill:
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {suggestedTimes.map((t) => (
                        <button
                          key={t}
                          type="button"
                          className="pill"
                          onClick={() => {
                            const v = to24h(t);
                            if (v) { setTime(v); setError(''); setSuggestedTimes([]); }
                          }}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label>Date <span className="req">*</span></label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} min={todayInIST()} />
              </div>

              <div>
                <label>Time <span className="req">*</span></label>
                <select value={time} onChange={(e) => setTime(e.target.value)}>
                  <option value="">Select a time…</option>
                  {VISIT_TIME_SLOTS.map((sl) => (
                    <option key={sl.value} value={sl.value} disabled={date === todayInIST() && sl.value < nowTimeIST()}>
                      {sl.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label>Field Exec <span className="req">*</span></label>
                {loadingExecs ? (
                  <div style={{ padding: '8px 0' }}><span className="inv-skel" style={{ display: 'inline-block', width: 140, height: 12 }} /></div>
                ) : fieldExecs.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--red-fg)' }}>
                    No field execs available. Add users with can_visit=true in the properties DB.
                  </div>
                ) : (
                  <select value={fieldExecId} onChange={(e) => setFieldExecId(e.target.value)}>
                    <option value="">Select…</option>
                    {fieldExecs.map((fe) => (
                      <option key={fe.id} value={fe.id}>
                        {fe.name}{fe.email ? ` (${fe.email})` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                Assigned by: <strong>{getUser()?.name || getUser()?.phone || 'admin'}</strong>
              </div>
            </div>

            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={closeModal} disabled={submitting} style={{ flex: 1, justifyContent: 'center' }}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleSubmit}
                disabled={submitting || loadingExecs || fieldExecs.length === 0}
                style={{ flex: 1, justifyContent: 'center' }}
              >
                {submitting ? 'Checking…' : 'Schedule'}
              </button>
            </div>
          </div>
        </div>
      )}

      {existingUnits && existingUnits.length > 0 && (
        <div className="modal-backdrop" onClick={cancelExistingWarning}>
          <div
            className="modal modal-wide"
            onClick={(e) => e.stopPropagation()}
            style={{ display: 'flex', flexDirection: 'column', maxHeight: '85vh' }}
          >
            <h3 style={{ color: 'var(--amber-fg)' }}>⚠ Units already with Openhouse</h3>
            <div className="modal-sub">
              {existingUnits.length} unit{existingUnits.length === 1 ? '' : 's'} already with Openhouse in <strong>{s.society_name}</strong>.
            </div>
            <div style={{ overflow: 'auto', flex: 1, border: '1px solid var(--border)', borderRadius: 'var(--r-sm)' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>UID</th>
                    <th>Tower</th>
                    <th>Unit</th>
                    <th>Floor</th>
                    <th>Config</th>
                    <th>Area (sqft)</th>
                  </tr>
                </thead>
                <tbody>
                  {existingUnits.map((u, i) => (
                    <tr key={u.uid || i}>
                      <td style={{ fontFamily: 'monospace' }}>{u.uid || '—'}</td>
                      <td>{u.tower_no || '—'}</td>
                      <td>{u.unit_no || '—'}</td>
                      <td>{u.floor || '—'}</td>
                      <td>{u.configuration || '—'}</td>
                      <td>{u.area_sqft ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={cancelExistingWarning} disabled={submitting} style={{ flex: 1, justifyContent: 'center' }}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={confirmExistingAndSchedule} disabled={submitting} style={{ flex: 1, justifyContent: 'center' }}>
                {submitting ? 'Scheduling…' : 'Schedule anyway'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
