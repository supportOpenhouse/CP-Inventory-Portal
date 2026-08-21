/**
 * Schedule Visit — pushes a listing to the external Forms app, and manages an
 * existing visit (reschedule / reassign / cancel / re-book after cancel).
 *
 * States (all gated on the row's status + forms_uid):
 *   1. Submitted / Visit Requested, no forms_uid → "Schedule Visit" button.
 *   2. Visit Scheduled (forms_uid set) → green info pill + Reschedule/Reassign
 *      + Cancel actions.
 *   3. Visit Cancelled (forms_uid set) → cancelled pill + "Schedule Revisit"
 *      (re-runs the schedule flow; the backend allows re-booking a cancelled
 *      lead by overwriting the stale forms_uid).
 *
 * Reschedule proxies to Forms /api/external/reschedule (optional reassign);
 * Cancel to /api/external/cancel; both send source_app "CP Inventory App".
 */
import { useEffect, useState } from 'react';
import { IconCalendar, IconWarning, IconCheck, IconClose } from '../../icons.jsx';
import { api, ApiError } from '../../../api';
import {
  formatDateOnly, formatTime12, todayInIST, nowTimeIST, VISIT_TIME_SLOTS,
} from '../../../format';
import { getUser } from '../../../auth';
import { useModalClose } from '../../../hooks/useModalClose';

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
  // Schedule flow (also reused verbatim for "Schedule Revisit").
  const [modalOpen, setModalOpen] = useState(false);
  const [fieldExecs, setFieldExecs] = useState([]);
  const [loadingExecs, setLoadingExecs] = useState(false);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [fieldExecId, setFieldExecId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [missingFields, setMissingFields] = useState([]);
  const [suggestedTimes, setSuggestedTimes] = useState([]); // Forms free slots on conflict (12h labels)
  const [toast, setToast] = useState(null); // { kind: 'success' | 'error', text }
  const [existingUnits, setExistingUnits] = useState(null); // null = unchecked; [] none; [...] matches

  // Reschedule / reassign flow.
  const [reOpen, setReOpen] = useState(false);
  const [reDate, setReDate] = useState('');
  const [reTime, setReTime] = useState('');
  const [reExecId, setReExecId] = useState('');
  const [reBusy, setReBusy] = useState(false);
  const [reError, setReError] = useState('');

  // Cancel flow.
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState('');

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  // All useModalClose hooks live above the early returns — a hook reached on
  // only some renders is React error #310. The arrows defer reading the close
  // handlers (defined below) until invoked, always after render.
  const warningOpen = !!existingUnits && existingUnits.length > 0;
  const { closing: modalClosing, close: closeScheduleModal } = useModalClose(
    () => closeModal(), { enabled: modalOpen, disabled: submitting },
  );
  const { closing: warnClosing, close: closeWarning } = useModalClose(
    () => cancelExistingWarning(), { enabled: warningOpen, disabled: submitting },
  );
  const { closing: reClosing, close: closeReschedule } = useModalClose(
    () => { if (!reBusy) setReOpen(false); }, { enabled: reOpen, disabled: reBusy },
  );
  const { closing: cancelClosing, close: closeCancel } = useModalClose(
    () => { if (!cancelBusy) setCancelOpen(false); }, { enabled: cancelOpen, disabled: cancelBusy },
  );

  if (!submission) return null;
  const s = submission;
  const ALLOWED = ['Submitted', 'Visit Requested', 'Visit Scheduled', 'Visit Cancelled'];
  if (!ALLOWED.includes(s.status)) return null;
  if (!s.forms_uid && !canAct) return null;

  const loadFieldExecs = async (setErr) => {
    if (fieldExecs.length > 0) return fieldExecs;
    setLoadingExecs(true);
    try {
      const data = await api.adminListFieldExecs();
      const list = data?.field_execs || [];
      setFieldExecs(list);
      return list;
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed to load field execs');
      return [];
    } finally {
      setLoadingExecs(false);
    }
  };

  // ── Schedule (and Revisit) ────────────────────────────────────────────────
  const openModal = async () => {
    setError(''); setMissingFields([]); setSuggestedTimes([]);
    setDate(''); setTime(''); setFieldExecId('');
    setModalOpen(true);
    await loadFieldExecs(setError);
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
      setToast({ kind: 'success', text: result.already_existed
        ? `Visit was already scheduled — UID: ${result.uid}`
        : `Visit scheduled — UID: ${result.uid}` });
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
    setError(''); setMissingFields([]);
    if (!date || !time || !fieldExecId) { setError('Please fill in all fields.'); return; }
    if (date < todayInIST()) { setError('Pick today or a future date.'); return; }
    if (date === todayInIST() && time < nowTimeIST()) {
      setError('That time has already passed today — pick a later time.'); return;
    }
    // Pre-flight: warn if Openhouse already has units in this society.
    setSubmitting(true);
    try {
      const data = await api.adminListPropertiesBySociety(s.society_name || '');
      const units = Array.isArray(data?.units) ? data.units : [];
      if (units.length > 0) { setExistingUnits(units); setSubmitting(false); return; }
    } catch (_) { /* ignore pre-flight failures — proceed */ }
    await sendScheduleRequest();
  };

  const confirmExistingAndSchedule = async () => { setExistingUnits(null); await sendScheduleRequest(); };
  const cancelExistingWarning = () => { if (!submitting) setExistingUnits(null); };

  // ── Reschedule / reassign ─────────────────────────────────────────────────
  const openReschedule = async () => {
    setReError('');
    setReDate((s.scheduled_date || '').slice(0, 10));
    setReTime((s.scheduled_time || '').slice(0, 5));
    setReOpen(true);
    const list = await loadFieldExecs(setReError);
    // Preselect the current field exec by name (we only store the name).
    const match = list.find((fe) => fe.name === s.field_exec_name);
    setReExecId(match ? String(match.id) : '');
  };

  const submitReschedule = async () => {
    setReError('');
    if (!reDate || !reTime) { setReError('Pick a date and time.'); return; }
    if (reDate < todayInIST()) { setReError('Pick today or a future date.'); return; }
    if (reDate === todayInIST() && reTime < nowTimeIST()) {
      setReError('That time has already passed today — pick a later time.'); return;
    }
    setReBusy(true);
    try {
      const payload = { schedule_date: reDate, schedule_time: reTime };
      if (reExecId) payload.field_exec_id = Number(reExecId);
      const result = await api.adminRescheduleVisit(s.id, payload);
      setReOpen(false);
      setToast({ kind: 'success', text: 'Visit rescheduled.' });
      onChanged?.({
        ...s,
        scheduled_date: result.scheduled_date,
        scheduled_time: result.scheduled_time,
        field_exec_name: result.field_exec_name,
      });
    } catch (e) {
      setReError(e instanceof ApiError ? e.message : 'Failed to reschedule visit');
    } finally {
      setReBusy(false);
    }
  };

  // ── Cancel ────────────────────────────────────────────────────────────────
  const openCancel = () => { setCancelError(''); setCancelReason(''); setCancelOpen(true); };

  const submitCancel = async () => {
    setCancelError('');
    setCancelBusy(true);
    try {
      await api.adminCancelVisit(s.id, cancelReason.trim() ? { reason: cancelReason.trim() } : {});
      setCancelOpen(false);
      setToast({ kind: 'success', text: 'Visit cancelled.' });
      onChanged?.({ ...s, status: 'Visit Cancelled' });
    } catch (e) {
      setCancelError(e instanceof ApiError ? e.message : 'Failed to cancel visit');
    } finally {
      setCancelBusy(false);
    }
  };

  // ── Shared modal bits ─────────────────────────────────────────────────────
  const execSelect = (value, onChange) => (
    loadingExecs ? (
      <div style={{ padding: '8px 0' }}><span className="inv-skel" style={{ display: 'inline-block', width: 140, height: 12 }} /></div>
    ) : fieldExecs.length === 0 ? (
      <div style={{ fontSize: 13, color: 'var(--red-fg)' }}>
        No field execs available. Add users with can_visit=true in the properties DB.
      </div>
    ) : (
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select…</option>
        {fieldExecs.map((fe) => (
          <option key={fe.id} value={fe.id}>{fe.name}{fe.email ? ` (${fe.email})` : ''}</option>
        ))}
      </select>
    )
  );

  const toastEl = toast && (
    <div style={{
      marginTop: 10, padding: '10px 12px', borderRadius: 'var(--r-sm)', fontSize: 12, fontWeight: 600,
      background: toast.kind === 'success' ? 'var(--green-bg)' : 'var(--red-bg)',
      color: toast.kind === 'success' ? 'var(--green-fg)' : 'var(--red-fg)',
      border: `1px solid ${toast.kind === 'success' ? 'var(--green)' : 'var(--red)'}`,
    }}>{toast.text}</div>
  );

  // ── State 2: scheduled → pill + reschedule/reassign + cancel ───────────────
  if (s.forms_uid && s.status === 'Visit Scheduled') {
    return (
      <div className="card-block">
        <h3>Visit Schedule</h3>
        <div style={{
          padding: '12px 14px', background: 'var(--green-bg)', border: '1.5px solid var(--green)',
          borderRadius: 'var(--r)', display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--green-fg)' }}><IconCheck size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />Visit scheduled</div>
          <div style={{ fontSize: 12, color: 'var(--green-fg)', fontFamily: 'monospace', fontWeight: 600 }}>UID: {s.forms_uid}</div>
          <div style={{ fontSize: 13, color: 'var(--green-fg)' }}>
            {formatDateOnly(s.scheduled_date) || '—'}{s.scheduled_time ? ` at ${formatTime12(s.scheduled_time)}` : ''}
            {s.field_exec_name ? ` · ${s.field_exec_name}` : ''}
          </div>
        </div>

        {canAct && (
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn-ghost" onClick={openReschedule} style={{ flex: '1 1 auto', justifyContent: 'center' }}>
              <IconCalendar size={14} /> Reschedule / Reassign
            </button>
            <button type="button" className="btn-ghost" onClick={openCancel} style={{ flex: '1 1 auto', justifyContent: 'center', color: 'var(--red-fg)' }}>
              <IconClose size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />Cancel visit
            </button>
          </div>
        )}
        {toastEl}

        {reOpen && (
          <div className={`modal-backdrop${reClosing ? ' is-closing-scrim' : ''}`} onClick={closeReschedule}>
            <div className={`modal${reClosing ? ' is-closing-panel' : ''}`} onClick={(e) => e.stopPropagation()}>
              <div className="modal-head-row">
                <h3 style={{ marginBottom: 0 }}>Reschedule / Reassign</h3>
                <button type="button" className="modal-close" onClick={closeReschedule} aria-label="Close">×</button>
              </div>
              <div className="modal-sub">{s.public_id} · {s.society_name}</div>
              {reError && <div className="modal-error">{reError}</div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label>Date <span className="req">*</span></label>
                  <input type="date" value={reDate} onChange={(e) => setReDate(e.target.value)} min={todayInIST()} />
                </div>
                <div>
                  <label>Time <span className="req">*</span></label>
                  <select value={reTime} onChange={(e) => setReTime(e.target.value)}>
                    <option value="">Select a time…</option>
                    {VISIT_TIME_SLOTS.map((sl) => (
                      <option key={sl.value} value={sl.value} disabled={reDate === todayInIST() && sl.value < nowTimeIST()}>{sl.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label>Field Exec <span className="muted" style={{ fontWeight: 400 }}>(reassign — optional)</span></label>
                  {execSelect(reExecId, setReExecId)}
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-ghost" onClick={closeReschedule} disabled={reBusy} style={{ flex: 1, justifyContent: 'center' }}>Cancel</button>
                <button type="button" className="btn-primary" onClick={submitReschedule} disabled={reBusy || loadingExecs} style={{ flex: 1, justifyContent: 'center' }}>
                  {reBusy ? 'Saving…' : 'Reschedule'}
                </button>
              </div>
            </div>
          </div>
        )}

        {cancelOpen && (
          <div className={`modal-backdrop${cancelClosing ? ' is-closing-scrim' : ''}`} onClick={closeCancel}>
            <div className={`modal${cancelClosing ? ' is-closing-panel' : ''}`} onClick={(e) => e.stopPropagation()}>
              <div className="modal-head-row">
                <h3 style={{ marginBottom: 0, color: 'var(--red-fg)' }}>Cancel visit</h3>
                <button type="button" className="modal-close" onClick={closeCancel} aria-label="Close">×</button>
              </div>
              <div className="modal-sub">{s.public_id} · {s.society_name}</div>
              {cancelError && <div className="modal-error">{cancelError}</div>}
              <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                This cancels the visit in the Forms app (deletes the calendar event, notifies the assignee) and moves the lead to <strong>Visit Cancelled</strong>.
              </div>
              <div>
                <label>Reason <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></label>
                <input type="text" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="e.g. buyer backed out" maxLength={200} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-ghost" onClick={closeCancel} disabled={cancelBusy} style={{ flex: 1, justifyContent: 'center' }}>Keep visit</button>
                <button type="button" className="btn-primary" onClick={submitCancel} disabled={cancelBusy} style={{ flex: 1, justifyContent: 'center', background: 'var(--red)' }}>
                  {cancelBusy ? 'Cancelling…' : 'Cancel visit'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── State 3: cancelled → pill + Schedule Revisit (reuses the schedule flow) ─
  if (s.status === 'Visit Cancelled') {
    return (
      <div className="card-block">
        <h3>Visit Schedule</h3>
        <div style={{
          padding: '12px 14px', background: '#FBEAE2', border: '1.5px solid #C2410C',
          borderRadius: 'var(--r)', display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#C2410C' }}><IconClose size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />Visit cancelled</div>
          {s.forms_uid && <div style={{ fontSize: 12, color: '#C2410C', fontFamily: 'monospace', fontWeight: 600 }}>UID: {s.forms_uid}</div>}
        </div>
        {canAct && (
          <button type="button" onClick={openModal} className="btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '12px 16px', marginTop: 10 }}>
            <IconCalendar size={15} /> Schedule Revisit
          </button>
        )}
        {toastEl}
        {renderScheduleModal()}
        {renderExistingWarning()}
      </div>
    );
  }

  // ── State 1: not yet scheduled → Schedule Visit ────────────────────────────
  return (
    <div className="card-block">
      <h3>Visit Schedule</h3>
      <button type="button" onClick={openModal} className="btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '12px 16px' }}>
        <IconCalendar size={15} /> Schedule Visit
      </button>
      {toastEl}
      {renderScheduleModal()}
      {renderExistingWarning()}
    </div>
  );

  // Schedule modal + existing-units warning, shared by "Schedule Visit" and
  // "Schedule Revisit". Declared as closures after the returns that don't use
  // them so the JSX above stays readable; hooks they depend on are all above.
  function renderScheduleModal() {
    if (!modalOpen) return null;
    return (
      <div className={`modal-backdrop${modalClosing ? ' is-closing-scrim' : ''}`} onClick={closeScheduleModal}>
        <div className={`modal${modalClosing ? ' is-closing-panel' : ''}`} onClick={(e) => e.stopPropagation()}>
          <div className="modal-head-row">
            <h3 style={{ marginBottom: 0 }}>Schedule Visit</h3>
            <button type="button" className="modal-close" onClick={closeScheduleModal} aria-label="Close">×</button>
          </div>
          <div className="modal-sub">{s.public_id} · {s.society_name}</div>
          {error && (
            <div className="modal-error">
              {error}
              {missingFields.length > 0 && (
                <ul style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 12 }}>
                  {missingFields.map((mf, i) => (<li key={i}>{mf.label || mf.field}</li>))}
                </ul>
              )}
              {suggestedTimes.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Suggested free times — tap to fill:</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {suggestedTimes.map((t) => (
                      <button key={t} type="button" className="pill" onClick={() => {
                        const v = to24h(t);
                        if (v) { setTime(v); setError(''); setSuggestedTimes([]); }
                      }}>{t}</button>
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
                  <option key={sl.value} value={sl.value} disabled={date === todayInIST() && sl.value < nowTimeIST()}>{sl.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label>Field Exec <span className="req">*</span></label>
              {execSelect(fieldExecId, setFieldExecId)}
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Assigned by: <strong>{getUser()?.name || getUser()?.phone || 'admin'}</strong>
            </div>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={closeScheduleModal} disabled={submitting} style={{ flex: 1, justifyContent: 'center' }}>Cancel</button>
            <button type="button" className="btn-primary" onClick={handleSubmit} disabled={submitting || loadingExecs || fieldExecs.length === 0} style={{ flex: 1, justifyContent: 'center' }}>
              {submitting ? 'Checking…' : 'Schedule'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderExistingWarning() {
    if (!existingUnits || existingUnits.length === 0) return null;
    return (
      <div className={`modal-backdrop${warnClosing ? ' is-closing-scrim' : ''}`} onClick={closeWarning}>
        <div className={`modal modal-wide${warnClosing ? ' is-closing-panel' : ''}`} onClick={(e) => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', maxHeight: '85vh' }}>
          <h3 style={{ color: 'var(--amber-fg)' }}><IconWarning size={15} style={{ verticalAlign: '-2px', marginRight: 5 }} />Units already with Openhouse</h3>
          <div className="modal-sub">
            {existingUnits.length} unit{existingUnits.length === 1 ? '' : 's'} already with Openhouse in <strong>{s.society_name}</strong>.
          </div>
          <div style={{ overflow: 'auto', flex: 1, border: '1px solid var(--border)', borderRadius: 'var(--r-sm)' }}>
            <table className="data-table">
              <thead><tr><th>UID</th><th>Tower</th><th>Unit</th><th>Floor</th><th>Config</th><th>Area (sqft)</th></tr></thead>
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
            <button type="button" className="btn-ghost" onClick={closeWarning} disabled={submitting} style={{ flex: 1, justifyContent: 'center' }}>Cancel</button>
            <button type="button" className="btn-primary" onClick={confirmExistingAndSchedule} disabled={submitting} style={{ flex: 1, justifyContent: 'center' }}>
              {submitting ? 'Scheduling…' : 'Schedule anyway'}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
