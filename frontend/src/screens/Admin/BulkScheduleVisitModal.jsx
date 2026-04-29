import { useEffect, useMemo, useState } from 'react';

import { ApiError, api } from '../../api';

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
 *     body: { schedule_date, schedule_time, items: [{id, field_exec_id}] }
 *   Pre-flight failure → 400 + { preflight_errors: [{id, errors: [{field?, label}]}] }
 *   Phase-2 result      → 200 + { ok, results: [{id, ok, uid?, error?}], summary }
 */
export default function BulkScheduleVisitModal({ selectedSubmissions, onClose, onSuccess }) {
  const [fieldExecs, setFieldExecs] = useState([]);
  const [loadingExecs, setLoadingExecs] = useState(true);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  // Map<submission_id, field_exec_id (string for select element, '' = unselected)>
  const [execBySid, setExecBySid] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [preflightErrors, setPreflightErrors] = useState([]); // [{id, errors: [{field, label}]}]
  const [resultsByid, setResultsBySid] = useState(null); // null = not yet submitted

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

  // Initialize per-row exec map whenever the selection changes
  useEffect(() => {
    setExecBySid((prev) => {
      const next = { ...prev };
      // Drop any sids no longer selected
      for (const sid of Object.keys(next)) {
        if (!selectedSubmissions.some((s) => String(s.id) === String(sid))) {
          delete next[sid];
        }
      }
      // Default new sids to ''
      for (const s of selectedSubmissions) {
        if (next[s.id] === undefined) next[s.id] = '';
      }
      return next;
    });
  }, [selectedSubmissions]);

  // Selected submissions sorted by status priority (Visit Scheduled first), then public_id
  const sortedSubs = useMemo(() => {
    return [...selectedSubmissions].sort((a, b) => {
      const ap = a.status === 'Visit Scheduled' ? 0 : 1;
      const bp = b.status === 'Visit Scheduled' ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return (a.public_id || '').localeCompare(b.public_id || '');
    });
  }, [selectedSubmissions]);

  // Validation summary up-front for UX (the same checks happen server-side too)
  const clientWarnings = useMemo(() => {
    const warnings = [];
    const wrongStatus = sortedSubs.filter((s) => s.status !== 'Visit Scheduled');
    if (wrongStatus.length > 0) {
      warnings.push(
        `${wrongStatus.length} listing(s) are not in 'Visit Scheduled' status. ` +
        `The Forms app may still accept them, but normally these are scheduled from the Visit Scheduled column.`
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
  const canSubmit = (
    sortedSubs.length > 0 &&
    Boolean(date) && Boolean(time) &&
    allExecsChosen &&
    !submitting && !loadingExecs
  );

  const setExecForSid = (sid, execId) => {
    setExecBySid((prev) => ({ ...prev, [sid]: execId }));
    // Clear any preflight error for this row when the user changes input
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

  const handleSubmit = async () => {
    setError('');
    setPreflightErrors([]);
    setResultsBySid(null);
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const items = sortedSubs.map((s) => ({
        id: s.id,
        field_exec_id: Number(execBySid[s.id]),
      }));
      const result = await api.adminBulkScheduleVisit({
        schedule_date: date,
        schedule_time: time,
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
              {/* Shared date / time / "apply exec to all" */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.5fr', gap: 16, alignItems: 'end' }}>
                <div>
                  <label style={labelStyle}>Date</label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    disabled={submitting}
                    style={inputStyle}
                    min={new Date().toISOString().split('T')[0]}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Time (24h)</label>
                  <input
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    disabled={submitting}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Apply field exec to all rows</label>
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
                    <th style={thStyle}>Field exec</th>
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
                          <select
                            value={execBySid[s.id] || ''}
                            onChange={(e) => setExecForSid(s.id, e.target.value)}
                            disabled={submitting || loadingExecs || alreadyScheduled}
                            style={inputStyle}
                          >
                            <option value="">— select —</option>
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
    </div>
  );
}
