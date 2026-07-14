/**
 * Modal for scheduling visits for multiple submissions at once. Ported from
 * CP's `screens/Admin/BulkScheduleVisitModal.jsx` — logic (field-exec
 * dropdown, per-row time picker, existing-units pre-flight warning, 20-item
 * cap enforced by the caller before this opens) kept verbatim; chrome
 * retokened onto this app's `.modal`/`.btn-*`/`.inv-table` classes and CSS
 * custom properties instead of CP's inline hex-color styles.
 *
 * Props:
 *   selectedSubmissions: array of submission objects (subset of the admin list).
 *                       Used for the per-row table; each row's id and chosen
 *                       field_exec_id are sent to /admin/submissions/bulk-schedule-visit.
 *   onClose: () => void
 *   onSuccess: () => void   // called after a successful (or partially successful) submit;
 *                           // parent should clear selection + reload.
 *
 * Backend contract:
 *   POST /admin/submissions/bulk-schedule-visit
 *     body: { schedule_date, items: [{id, field_exec_id, schedule_time}] }
 *     (schedule_time is per-item now; date is shared.) Hard cap of 20 items.
 *   Pre-flight failure → 400 + { preflight_errors: [{id, errors: [{field?, label}]}] }
 *   Phase-2 result      → 200 + { ok, results: [{id, ok, uid?, error?}], summary }
 */
import { useEffect, useMemo, useState } from 'react';

import { ApiError, api } from '../../api';
import { todayInIST, nowTimeIST, VISIT_TIME_SLOTS } from '../../format';
import { IconClose } from '../icons.jsx';

export default function BulkScheduleVisitModal({ selectedSubmissions, onClose, onSuccess }) {
  const [fieldExecs, setFieldExecs] = useState([]);
  const [loadingExecs, setLoadingExecs] = useState(true);
  const [date, setDate] = useState('');
  // Per-row maps. Time and exec are now both per-row; the picker fields at the
  // top are convenience "apply to all" actions, not stored values.
  const [execBySid, setExecBySid] = useState({});
  const [timeBySid, setTimeBySid] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [preflightErrors, setPreflightErrors] = useState([]); // [{id, errors: [{field, label}]}]
  const [resultsBySid, setResultsBySid] = useState(null); // null = not yet submitted
  // Existing-units warning shown before pushing the bulk request to Forms.
  // Shape: { [societyName]: [{uid, tower_no, unit_no, area_sqft, configuration, floor}, ...] }
  // null = not yet checked / dismissed; populated object = popup visible.
  const [existingBySociety, setExistingBySociety] = useState(null);

  // Load field execs on mount
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await api.adminListFieldExecs();
        if (alive) setFieldExecs(data?.field_execs || []);
      } catch (e) {
        if (alive) setError(e instanceof ApiError ? e.message : 'Failed to load field execs');
      } finally {
        if (alive) setLoadingExecs(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Initialize per-row exec + time maps whenever the selection changes
  useEffect(() => {
    const sync = (prev) => {
      const next = { ...prev };
      for (const sid of Object.keys(next)) {
        if (!selectedSubmissions.some((s) => String(s.id) === String(sid))) {
          delete next[sid];
        }
      }
      for (const s of selectedSubmissions) {
        if (next[s.id] === undefined) next[s.id] = '';
      }
      return next;
    };
    setExecBySid(sync);
    setTimeBySid(sync);
  }, [selectedSubmissions]);

  // Sort by status: Submitted (will be promoted) first, then Visit Scheduled
  // (reschedules), then anything else; ties broken by public_id.
  const sortedSubs = useMemo(() => {
    const prio = (s) => (s.status === 'Submitted' ? 0 : s.status === 'Visit Scheduled' ? 1 : 2);
    return [...selectedSubmissions].sort((a, b) => {
      const d = prio(a) - prio(b);
      if (d !== 0) return d;
      return (a.public_id || '').localeCompare(b.public_id || '');
    });
  }, [selectedSubmissions]);

  // Validation summary up-front for UX (the same checks happen server-side too)
  const clientWarnings = useMemo(() => {
    const warnings = [];
    // Visits are normally scheduled from 'Submitted' (auto-promotes to
    // 'Visit Scheduled') or 'Visit Scheduled' (reschedule). Anything else
    // is unusual — flag it but don't block, the server is the authority.
    const wrongStatus = sortedSubs.filter(
      (s) => s.status !== 'Submitted' && s.status !== 'Visit Scheduled'
    );
    if (wrongStatus.length > 0) {
      warnings.push(
        `${wrongStatus.length} listing(s) are not in 'Submitted' or 'Visit Scheduled' status. ` +
        `The Forms app may still accept them, but normally visits are scheduled from those columns.`
      );
    }
    const alreadyScheduled = sortedSubs.filter((s) => s.forms_uid);
    if (alreadyScheduled.length > 0) {
      warnings.push(
        `${alreadyScheduled.length} listing(s) already have a Forms UID and will be skipped (idempotent).`
      );
    }
    return warnings;
  }, [sortedSubs]);

  const allExecsChosen = sortedSubs.every((s) => Boolean(execBySid[s.id]));
  const allTimesChosen = sortedSubs.every((s) => Boolean(timeBySid[s.id]));
  const canSubmit = (
    sortedSubs.length > 0 &&
    Boolean(date) &&
    allExecsChosen && allTimesChosen &&
    !submitting && !loadingExecs
  );

  const setExecForSid = (sid, execId) => {
    setExecBySid((prev) => ({ ...prev, [sid]: execId }));
    // Clear any preflight error for this row when the user changes input
    setPreflightErrors((prev) => prev.filter((e) => String(e.id) !== String(sid)));
  };

  const setTimeForSid = (sid, time) => {
    setTimeBySid((prev) => ({ ...prev, [sid]: time }));
    setPreflightErrors((prev) => prev.filter((e) => String(e.id) !== String(sid)));
  };

  const applyExecToAll = (execId) => {
    if (!execId) return;
    setExecBySid((prev) => {
      const next = { ...prev };
      for (const s of sortedSubs) next[s.id] = execId;
      return next;
    });
  };

  const applyTimeToAll = (time) => {
    if (!time) return;
    setTimeBySid((prev) => {
      const next = { ...prev };
      for (const s of sortedSubs) next[s.id] = time;
      return next;
    });
  };

  const sendBulkRequest = async () => {
    setSubmitting(true);
    try {
      const items = sortedSubs.map((s) => ({
        id: s.id,
        field_exec_id: Number(execBySid[s.id]),
        schedule_time: timeBySid[s.id],
      }));
      const result = await api.adminBulkScheduleVisit({
        schedule_date: date,
        items,
      });
      // Map results by id for easy per-row rendering
      const map = {};
      for (const r of result.results || []) map[r.id] = r;
      setResultsBySid(map);
      // Caller should reload the admin list — but only after the user dismisses,
      // so they have time to read the results.
    } catch (e) {
      if (e instanceof ApiError && e.data && Array.isArray(e.data.preflight_errors)) {
        setPreflightErrors(e.data.preflight_errors);
      } else {
        setError(e?.message || 'Bulk schedule failed');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    setError('');
    setPreflightErrors([]);
    setResultsBySid(null);
    if (!canSubmit) return;
    if (date < todayInIST()) {
      setError('Pick today or a future date.');
      return;
    }
    if (date === todayInIST()) {
      const now = nowTimeIST();
      // Only the rows we're about to schedule (already-scheduled rows keep
      // their existing, possibly-past, time in a disabled input).
      const past = sortedSubs.filter(
        (s) => !s.forms_uid && (timeBySid[s.id] || '') && timeBySid[s.id] < now,
      );
      if (past.length > 0) {
        setError(`${past.length} row(s) have a time earlier than now — pick a later time for today.`);
        return;
      }
    }
    // Pre-flight existing-units check per unique society_name. If anything
    // matches we show the warning popup and wait for an explicit confirm
    // before calling /bulk-schedule-visit.
    setSubmitting(true);
    try {
      const eligible = sortedSubs.filter((s) => !s.forms_uid);
      const uniqueSocieties = Array.from(new Set(
        eligible.map((s) => (s.society_name || '').trim()).filter(Boolean)
      ));
      const lookups = await Promise.all(uniqueSocieties.map(async (name) => {
        try {
          const data = await api.adminListPropertiesBySociety(name);
          return [name, Array.isArray(data?.units) ? data.units : []];
        } catch (_) {
          return [name, []];
        }
      }));
      const grouped = {};
      for (const [name, units] of lookups) {
        if (units.length > 0) grouped[name] = units;
      }
      if (Object.keys(grouped).length > 0) {
        setExistingBySociety(grouped);
        setSubmitting(false);
        return; // wait for confirm
      }
    } catch (_) {
      // ignore — fall through to send the bulk request
    }
    await sendBulkRequest();
  };

  const confirmExistingAndBulkSchedule = async () => {
    setExistingBySociety(null);
    await sendBulkRequest();
  };

  const cancelExistingWarning = () => {
    if (submitting) return;
    setExistingBySociety(null);
  };

  const handleCloseAfterSuccess = () => {
    onSuccess();
    onClose();
  };

  const submitted = resultsBySid !== null;

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}>
      <div className="modal modal-wide" style={{ maxWidth: 880, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head-row">
          <h3 style={{ marginBottom: 0, flex: 1 }}>
            {submitted ? 'Bulk schedule — results' : `Schedule visits for ${sortedSubs.length} listing${sortedSubs.length === 1 ? '' : 's'}`}
          </h3>
          <button
            type="button"
            className="modal-close"
            onClick={() => (submitting ? null : onClose())}
            disabled={submitting}
            aria-label="Close"
          ><IconClose /></button>
        </div>

        <div style={{ overflow: 'auto', flex: 1 }}>
          {/* Errors / warnings */}
          {error && <div className="modal-error">{error}</div>}
          {clientWarnings.length > 0 && !submitted && (
            <div style={{ background: 'var(--amber-bg)', color: 'var(--amber-fg)', padding: 12, borderRadius: 'var(--r-sm)', marginBottom: 12, fontSize: 13 }}>
              {clientWarnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}
          {preflightErrors.length > 0 && (
            <div className="modal-error">
              <div style={{ fontWeight: 600, marginBottom: 6 }}>
                Pre-validation failed for {preflightErrors.length} listing{preflightErrors.length === 1 ? '' : 's'}.
                No requests were sent to the Forms app. Fix and retry.
              </div>
            </div>
          )}

          {!submitted && (
            <>
              {/* Shared date + 'apply Field Executive to all' helper. Time
                  is per-row only (set in the table below). */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16, alignItems: 'end' }}>
                <div>
                  <label className="field-lbl" style={{ marginBottom: 4, display: 'block' }}>Date</label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    disabled={submitting}
                    min={todayInIST()}
                  />
                </div>
                <div>
                  <label className="field-lbl" style={{ marginBottom: 4, display: 'block' }}>Apply Field Executive to all rows</label>
                  <select
                    value=""
                    onChange={(e) => applyExecToAll(e.target.value)}
                    disabled={submitting || loadingExecs}
                  >
                    <option value="">— pick to fill all rows —</option>
                    {fieldExecs.map((fe) => (
                      <option key={fe.id} value={fe.id}>{fe.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Per-row table */}
              <div className="inv-table-wrap" style={{ marginTop: 16, boxShadow: 'none' }}>
                <table className="inv-table">
                  <thead>
                    <tr>
                      <th className="inv-th">Listing</th>
                      <th className="inv-th">Society / City</th>
                      <th className="inv-th">Status</th>
                      <th className="inv-th">Time</th>
                      <th className="inv-th">Field Executive</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedSubs.map((s) => {
                      const rowError = preflightErrors.find((pe) => String(pe.id) === String(s.id));
                      const alreadyScheduled = Boolean(s.forms_uid);
                      const rowStyle = rowError
                        ? { background: 'var(--red-bg)' }
                        : (alreadyScheduled ? { background: 'var(--green-bg)' } : undefined);
                      return (
                        <tr key={s.id} style={{ ...rowStyle, borderBottom: '1px solid var(--hairline)' }}>
                          <td style={{ padding: '9px 10px', verticalAlign: 'top' }}>
                            <div style={{ fontFamily: 'monospace', fontSize: 12 }}>{s.public_id || `#${s.id}`}</div>
                            {alreadyScheduled && (
                              <div style={{ fontSize: 11, color: 'var(--green-fg)' }}>✓ already scheduled (will skip)</div>
                            )}
                            {rowError && (
                              <div style={{ fontSize: 11, color: 'var(--red-fg)', marginTop: 4 }}>
                                {rowError.errors.map((e, i) => (
                                  <div key={i}>• {e.label}</div>
                                ))}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '9px 10px', verticalAlign: 'top' }}>
                            <div>{s.society_name || '—'}</div>
                            <div className="muted" style={{ fontSize: 11 }}>{s.city || '—'}</div>
                          </td>
                          <td style={{ padding: '9px 10px', verticalAlign: 'top' }}>
                            <span className="muted" style={{ fontSize: 11 }}>{s.status}</span>
                          </td>
                          <td style={{ padding: '9px 10px', verticalAlign: 'top' }}>
                            <select
                              value={timeBySid[s.id] || ''}
                              onChange={(e) => setTimeForSid(s.id, e.target.value)}
                              disabled={submitting || alreadyScheduled}
                              style={{ minWidth: 110 }}
                            >
                              <option value="">— time —</option>
                              {VISIT_TIME_SLOTS.map((sl) => (
                                <option
                                  key={sl.value}
                                  value={sl.value}
                                  disabled={date === todayInIST() && sl.value < nowTimeIST()}
                                >
                                  {sl.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td style={{ padding: '9px 10px', verticalAlign: 'top' }}>
                            <select
                              value={execBySid[s.id] || ''}
                              onChange={(e) => setExecForSid(s.id, e.target.value)}
                              disabled={submitting || loadingExecs || alreadyScheduled}
                            >
                              <option value="">— select Field Executive —</option>
                              {fieldExecs.map((fe) => (
                                <option key={fe.id} value={fe.id}>{fe.name}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Results view (after submit) */}
          {submitted && (
            <div className="inv-table-wrap" style={{ boxShadow: 'none' }}>
              <table className="inv-table">
                <thead>
                  <tr>
                    <th className="inv-th">Listing</th>
                    <th className="inv-th">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedSubs.map((s) => {
                    const r = resultsBySid[s.id];
                    if (!r) {
                      return (
                        <tr key={s.id} style={{ borderBottom: '1px solid var(--hairline)' }}>
                          <td style={{ padding: '9px 10px' }}>{s.public_id || `#${s.id}`}</td>
                          <td style={{ padding: '9px 10px' }}><span className="muted">(no result returned)</span></td>
                        </tr>
                      );
                    }
                    if (r.ok) {
                      return (
                        <tr key={s.id} style={{ background: 'var(--green-bg)', borderBottom: '1px solid var(--hairline)' }}>
                          <td style={{ padding: '9px 10px' }}>{s.public_id || `#${s.id}`}</td>
                          <td style={{ padding: '9px 10px', color: 'var(--green-fg)' }}>
                            ✓ Scheduled — UID <code style={{ fontFamily: 'monospace' }}>{r.uid}</code>
                            {r.already_existed ? ' (already existed)' : ''}
                          </td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={s.id} style={{ background: 'var(--red-bg)', borderBottom: '1px solid var(--hairline)' }}>
                        <td style={{ padding: '9px 10px' }}>{s.public_id || `#${s.id}`}</td>
                        <td style={{ padding: '9px 10px', color: 'var(--red-fg)' }}>✗ {r.error}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="modal-actions">
          {!submitted ? (
            <>
              <span style={{ flex: 1 }} />
              <button type="button" className="btn-ghost" onClick={onClose} disabled={submitting}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={handleSubmit} disabled={!canSubmit}>
                {submitting
                  ? `Scheduling ${sortedSubs.length}…`
                  : `Schedule ${sortedSubs.length} visit${sortedSubs.length === 1 ? '' : 's'}`}
              </button>
            </>
          ) : (
            <>
              <span style={{ flex: 1 }} />
              <button type="button" className="btn-primary" onClick={handleCloseAfterSuccess}>
                Close
              </button>
            </>
          )}
        </div>
      </div>

      {existingBySociety && Object.keys(existingBySociety).length > 0 && (
        <div
          className="modal-backdrop"
          style={{ zIndex: 1100 }}
          onClick={cancelExistingWarning}
        >
          <div
            className="modal"
            style={{ maxWidth: 760, maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--amber-fg)', marginBottom: 4 }}>
              ⚠ Units already with Openhouse
            </div>
            <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
              The following societies already have units with Openhouse. Review before scheduling.
            </div>
            <div style={{ overflow: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {Object.entries(existingBySociety).map(([society, units]) => (
                <div key={society}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--amber-fg)', marginBottom: 4 }}>
                    {society} <span className="muted" style={{ fontWeight: 500 }}>({units.length} unit{units.length === 1 ? '' : 's'})</span>
                  </div>
                  <div className="inv-table-wrap" style={{ boxShadow: 'none' }}>
                    <table className="inv-table">
                      <thead>
                        <tr>
                          <th className="inv-th">UID</th>
                          <th className="inv-th">Tower</th>
                          <th className="inv-th">Unit</th>
                          <th className="inv-th">Floor</th>
                          <th className="inv-th">Config</th>
                          <th className="inv-th">Area (sqft)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {units.map((u, i) => (
                          <tr key={u.uid || `${society}-${i}`} style={{ borderBottom: '1px solid var(--hairline)' }}>
                            <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>{u.uid || '—'}</td>
                            <td style={{ padding: '6px 8px' }}>{u.tower_no || '—'}</td>
                            <td style={{ padding: '6px 8px' }}>{u.unit_no || '—'}</td>
                            <td style={{ padding: '6px 8px' }}>{u.floor || '—'}</td>
                            <td style={{ padding: '6px 8px' }}>{u.configuration || '—'}</td>
                            <td style={{ padding: '6px 8px' }}>{u.area_sqft ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
              <button type="button" className="btn-ghost" onClick={cancelExistingWarning} disabled={submitting}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={confirmExistingAndBulkSchedule} disabled={submitting}>
                {submitting ? 'Scheduling…' : 'Schedule anyway'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
