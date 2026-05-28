import { useEffect, useMemo, useState } from 'react';

import { ApiError, api } from '../../api';
import { todayInIST } from '../../format';

/**
 * Modal for scheduling visits for multiple submissions at once.
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
 *     (schedule_time is per-item now; date is shared.)
 *   Pre-flight failure → 400 + { preflight_errors: [{id, errors: [{field?, label}]}] }
 *   Phase-2 result      → 200 + { ok, results: [{id, ok, uid?, error?}], summary }
 */
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
  const [resultsByid, setResultsBySid] = useState(null); // null = not yet submitted
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

  // Style tokens (kept inline so the component is self-contained)
  const overlayStyle = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
    zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 16,
  };
  const modalStyle = {
    background: '#fff', borderRadius: 8, width: '100%', maxWidth: 880,
    maxHeight: '90vh', display: 'flex', flexDirection: 'column',
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
  };
  const headerStyle = {
    padding: '18px 24px', borderBottom: '1px solid #eee',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  };
  const bodyStyle = { padding: 24, overflow: 'auto', flex: 1 };
  const footerStyle = {
    padding: '14px 24px', borderTop: '1px solid #eee',
    display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10,
  };
  const labelStyle = { fontSize: 12, color: '#666', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4, display: 'block' };
  const inputStyle = { padding: '8px 10px', border: '1px solid #ddd', borderRadius: 4, fontSize: 14, width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' };
  const tableStyle = { width: '100%', borderCollapse: 'collapse', marginTop: 16, fontSize: 13 };
  const thStyle = { textAlign: 'left', padding: '8px 10px', background: '#f7f7f7', borderBottom: '1px solid #ddd', fontWeight: 600 };
  const tdStyle = { padding: '8px 10px', borderBottom: '1px solid #eee', verticalAlign: 'top' };

  // ── Render ────────────────────────────────────────────────────────
  const submitted = resultsByid !== null;

  return (
    <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}>
      <div style={modalStyle}>
        <div style={headerStyle}>
          <div style={{ fontSize: 18, fontWeight: 600 }}>
            {submitted ? 'Bulk schedule — results' : `Schedule visits for ${sortedSubs.length} listing${sortedSubs.length === 1 ? '' : 's'}`}
          </div>
          <button
            onClick={() => (submitting ? null : onClose())}
            disabled={submitting}
            style={{ background: 'transparent', border: 0, fontSize: 22, cursor: submitting ? 'not-allowed' : 'pointer', color: '#666' }}
            aria-label="Close"
          >×</button>
        </div>

        <div style={bodyStyle}>
          {/* Errors / warnings */}
          {error && (
            <div style={{ background: '#fee2e2', color: '#991b1b', padding: 12, borderRadius: 4, marginBottom: 12 }}>
              {error}
            </div>
          )}
          {clientWarnings.length > 0 && !submitted && (
            <div style={{ background: '#fef3c7', color: '#92400e', padding: 12, borderRadius: 4, marginBottom: 12, fontSize: 13 }}>
              {clientWarnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}
          {preflightErrors.length > 0 && (
            <div style={{ background: '#fee2e2', color: '#991b1b', padding: 12, borderRadius: 4, marginBottom: 12, fontSize: 13 }}>
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
                  <label style={labelStyle}>Date</label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    disabled={submitting}
                    style={inputStyle}
                    min={todayInIST()}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Apply Field Executive to all rows</label>
                  <select
                    value=""
                    onChange={(e) => applyExecToAll(e.target.value)}
                    disabled={submitting || loadingExecs}
                    style={inputStyle}
                  >
                    <option value="">— pick to fill all rows —</option>
                    {fieldExecs.map((fe) => (
                      <option key={fe.id} value={fe.id}>{fe.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Per-row table */}
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Listing</th>
                    <th style={thStyle}>Society / City</th>
                    <th style={thStyle}>Status</th>
                    <th style={thStyle}>Time</th>
                    <th style={thStyle}>Field Executive</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedSubs.map((s) => {
                    const rowError = preflightErrors.find((pe) => String(pe.id) === String(s.id));
                    const alreadyScheduled = Boolean(s.forms_uid);
                    const rowBg = rowError ? '#fef2f2' : (alreadyScheduled ? '#f0fdf4' : 'transparent');
                    return (
                      <tr key={s.id} style={{ background: rowBg }}>
                        <td style={tdStyle}>
                          <div style={{ fontFamily: 'monospace', fontSize: 12 }}>{s.public_id || `#${s.id}`}</div>
                          {alreadyScheduled && (
                            <div style={{ fontSize: 11, color: '#16a34a' }}>✓ already scheduled (will skip)</div>
                          )}
                          {rowError && (
                            <div style={{ fontSize: 11, color: '#991b1b', marginTop: 4 }}>
                              {rowError.errors.map((e, i) => (
                                <div key={i}>• {e.label}</div>
                              ))}
                            </div>
                          )}
                        </td>
                        <td style={tdStyle}>
                          <div>{s.society_name || '—'}</div>
                          <div style={{ fontSize: 11, color: '#666' }}>{s.city || '—'}</div>
                        </td>
                        <td style={tdStyle}>
                          <span style={{ fontSize: 11, color: '#666' }}>{s.status}</span>
                        </td>
                        <td style={tdStyle}>
                          <input
                            type="time"
                            value={timeBySid[s.id] || ''}
                            onChange={(e) => setTimeForSid(s.id, e.target.value)}
                            disabled={submitting || alreadyScheduled}
                            style={{ ...inputStyle, minWidth: 110 }}
                          />
                        </td>
                        <td style={tdStyle}>
                          <select
                            value={execBySid[s.id] || ''}
                            onChange={(e) => setExecForSid(s.id, e.target.value)}
                            disabled={submitting || loadingExecs || alreadyScheduled}
                            style={inputStyle}
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
            </>
          )}

          {/* Results view (after submit) */}
          {submitted && (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Listing</th>
                  <th style={thStyle}>Result</th>
                </tr>
              </thead>
              <tbody>
                {sortedSubs.map((s) => {
                  const r = resultsByid[s.id];
                  if (!r) {
                    return (
                      <tr key={s.id}>
                        <td style={tdStyle}>{s.public_id || `#${s.id}`}</td>
                        <td style={tdStyle}><span style={{ color: '#666' }}>(no result returned)</span></td>
                      </tr>
                    );
                  }
                  if (r.ok) {
                    return (
                      <tr key={s.id} style={{ background: '#f0fdf4' }}>
                        <td style={tdStyle}>{s.public_id || `#${s.id}`}</td>
                        <td style={{ ...tdStyle, color: '#166534' }}>
                          ✓ Scheduled — UID <code style={{ fontFamily: 'monospace' }}>{r.uid}</code>
                          {r.already_existed ? ' (already existed)' : ''}
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={s.id} style={{ background: '#fef2f2' }}>
                      <td style={tdStyle}>{s.public_id || `#${s.id}`}</td>
                      <td style={{ ...tdStyle, color: '#991b1b' }}>✗ {r.error}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div style={footerStyle}>
          {!submitted ? (
            <>
              <button
                onClick={onClose}
                disabled={submitting}
                style={{ padding: '8px 16px', border: '1px solid #ccc', background: '#fff', borderRadius: 4, cursor: submitting ? 'not-allowed' : 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                style={{
                  padding: '8px 16px', border: 0, borderRadius: 4,
                  background: canSubmit ? '#FF6B2B' : '#ccc',
                  color: '#fff', cursor: canSubmit ? 'pointer' : 'not-allowed',
                  fontWeight: 600,
                }}
              >
                {submitting
                  ? `Scheduling ${sortedSubs.length}…`
                  : `Schedule ${sortedSubs.length} visit${sortedSubs.length === 1 ? '' : 's'}`}
              </button>
            </>
          ) : (
            <button
              onClick={handleCloseAfterSuccess}
              style={{ padding: '8px 16px', border: 0, borderRadius: 4, background: '#FF6B2B', color: '#fff', cursor: 'pointer', fontWeight: 600 }}
            >
              Close
            </button>
          )}
        </div>
      </div>

      {existingBySociety && Object.keys(existingBySociety).length > 0 && (
        <div
          onClick={cancelExistingWarning}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1100,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 10, padding: 20,
              width: '100%', maxWidth: 760, maxHeight: '88vh',
              display: 'flex', flexDirection: 'column',
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            }}
          >
            <div style={{ fontSize: 17, fontWeight: 700, color: '#92400E', marginBottom: 4 }}>
              ⚠ Units already with Openhouse
            </div>
            <div style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
              The following societies already have units with Openhouse. Review before scheduling.
            </div>
            <div style={{ overflow: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {Object.entries(existingBySociety).map(([society, units]) => (
                <div key={society}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#92400E', marginBottom: 4 }}>
                    {society} <span style={{ color: '#666', fontWeight: 500 }}>({units.length} unit{units.length === 1 ? '' : 's'})</span>
                  </div>
                  <div style={{ border: '1px solid #FCD34D', borderRadius: 6, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead style={{ background: '#FEF3C7' }}>
                        <tr>
                          <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 700 }}>UID</th>
                          <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 700 }}>Tower</th>
                          <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 700 }}>Unit</th>
                          <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 700 }}>Floor</th>
                          <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 700 }}>Config</th>
                          <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 700 }}>Area (sqft)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {units.map((u, i) => (
                          <tr key={u.uid || `${society}-${i}`} style={{ background: i % 2 ? '#fff' : '#FFFBEB' }}>
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
              <button
                onClick={cancelExistingWarning}
                disabled={submitting}
                style={{ padding: '8px 16px', border: '1px solid #ccc', background: '#fff', borderRadius: 4, cursor: submitting ? 'not-allowed' : 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={confirmExistingAndBulkSchedule}
                disabled={submitting}
                style={{
                  padding: '8px 16px', border: 0, borderRadius: 4,
                  background: submitting ? '#FFB28D' : '#FF6B2B',
                  color: '#fff', cursor: submitting ? 'not-allowed' : 'pointer', fontWeight: 600,
                }}
              >
                {submitting ? 'Scheduling…' : 'Schedule anyway'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
