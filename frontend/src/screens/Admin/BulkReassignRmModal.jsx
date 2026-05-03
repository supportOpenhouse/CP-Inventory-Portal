import { useEffect, useMemo, useState } from 'react';

import { ApiError, api } from '../../api';
import { getUser } from '../../auth';

/**
 * Bulk RM reassignment with two modes:
 *   - 'listings' (DEFAULT): sets submissions.listing_rm_id for the selected
 *     rows ONLY. Doesn't touch the CP's permanent assignment.
 *   - 'cps':       changes channel_partners.rm_id for the CPs of selected
 *     listings. Affects ALL of each CP's listings, past and future.
 *
 * The user explicitly asked (2026-04-30) to ALWAYS surface this choice with
 * the listing-only mode as default.
 *
 * Props:
 *   selectedSubmissions: array of submission rows currently ticked
 *   onClose: () => void
 *   onSuccess: () => void   // parent should clear selection + reload
 */
export default function BulkReassignRmModal({ selectedSubmissions, onClose, onSuccess }) {
  const me = getUser();
  const isAdmin = me?.role === 'admin';
  const isManager = !isAdmin && (me?.role === 'manager' || me?.isManager);

  // Managers are constrained to per-listing reassignment within their team —
  // they can't change a CP's permanent RM (that's an admin-only org change).
  // Force the mode to 'listings' for them and hide the picker.
  const [mode, setMode] = useState('listings');  // 'listings' (default) | 'cps'
  const [rms, setRms] = useState([]);
  const [loadingRms, setLoadingRms] = useState(true);
  const [targetRmId, setTargetRmId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [resultSummary, setResultSummary] = useState(null);

  // Load RM list on mount. For managers, filter the list to their own team
  // (self + direct reports) so they can't accidentally pick an out-of-team RM
  // — the backend enforces the same rule, but the UI shouldn't even offer it.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await api.adminListRms();
        const all = data?.rms || [];
        const filtered = isManager && me?.rm_id
          ? all.filter((r) => r.id === me.rm_id || r.manager_id === me.rm_id)
          : all;
        if (alive) setRms(filtered);
      } catch (e) {
        if (alive) setError(e instanceof ApiError ? e.message : 'Failed to load RMs');
      } finally {
        if (alive) setLoadingRms(false);
      }
    })();
    return () => { alive = false; };
  }, [isManager, me?.rm_id]);

  // Group selected submissions by CP so we can show the per-CP impact
  const cpSummary = useMemo(() => {
    const map = new Map(); // cp_id -> { cp_id, cp_name, cp_code, current_rm_name, count }
    for (const s of selectedSubmissions) {
      if (!s.cp_id) continue;
      const ex = map.get(s.cp_id);
      if (ex) {
        ex.count += 1;
      } else {
        map.set(s.cp_id, {
          cp_id: s.cp_id,
          cp_name: s.cp_name || `CP #${s.cp_id}`,
          cp_code: s.cp_code || '',
          current_rm_name: s.assigned_rm_name || '—',
          count: 1,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => (a.cp_name || '').localeCompare(b.cp_name || ''));
  }, [selectedSubmissions]);

  const targetRm = rms.find((r) => String(r.id) === String(targetRmId));
  const canSubmit = (
    targetRmId &&
    selectedSubmissions.length > 0 &&
    (mode === 'listings' || cpSummary.length > 0) &&
    !submitting && !loadingRms
  );

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setError('');
    setResultSummary(null);
    setSubmitting(true);
    try {
      let data;
      if (mode === 'listings') {
        data = await api.adminBulkReassignListingRm({
          submission_ids: selectedSubmissions.map((s) => s.id),
          target_rm_id: Number(targetRmId),
        });
      } else {
        data = await api.adminBulkReassignRm({
          cp_ids: cpSummary.map((c) => c.cp_id),
          target_rm_id: Number(targetRmId),
        });
      }
      // Stash mode in result so the success screen can render the right summary
      setResultSummary({ ...data, _mode: mode });
    } catch (e) {
      setError(e?.message || 'Reassign failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (resultSummary) onSuccess();
    onClose();
  };

  // ── styles (inline for self-containment) ─────────────────────
  const overlay = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
    zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 16,
  };
  const modal = {
    background: '#fff', borderRadius: 8, width: '100%', maxWidth: 720,
    maxHeight: '90vh', display: 'flex', flexDirection: 'column',
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
  };
  const header = {
    padding: '18px 24px', borderBottom: '1px solid #eee',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  };
  const body = { padding: 24, overflow: 'auto', flex: 1 };
  const footer = {
    padding: '14px 24px', borderTop: '1px solid #eee',
    display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10,
  };
  const inputStyle = {
    padding: '8px 10px', border: '1px solid #ddd', borderRadius: 4, fontSize: 14,
    width: '100%', boxSizing: 'border-box', fontFamily: 'inherit',
  };
  const tableStyle = { width: '100%', borderCollapse: 'collapse', marginTop: 12, fontSize: 13 };
  const th = { textAlign: 'left', padding: '8px 10px', background: '#f7f7f7', borderBottom: '1px solid #ddd', fontWeight: 600 };
  const td = { padding: '8px 10px', borderBottom: '1px solid #eee', verticalAlign: 'top' };

  const submitted = resultSummary !== null;

  return (
    <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}>
      <div style={modal}>
        <div style={header}>
          <div style={{ fontSize: 18, fontWeight: 600 }}>
            {submitted
              ? 'Reassignment complete'
              : (mode === 'listings'
                ? `Reassign ${selectedSubmissions.length} listing${selectedSubmissions.length === 1 ? '' : 's'} to a new RM`
                : `Reassign ${cpSummary.length} CP${cpSummary.length === 1 ? '' : 's'} to a new RM`
              )}
          </div>
          <button
            onClick={() => (submitting ? null : (submitted ? handleClose() : onClose()))}
            disabled={submitting}
            style={{ background: 'transparent', border: 0, fontSize: 22, cursor: submitting ? 'not-allowed' : 'pointer', color: '#666' }}
            aria-label="Close"
          >×</button>
        </div>

        <div style={body}>
          {error && (
            <div style={{ background: '#fee2e2', color: '#991b1b', padding: 12, borderRadius: 4, marginBottom: 12 }}>
              {error}
            </div>
          )}

          {!submitted ? (
            <>
              {/* Mode picker — admins see both options. Managers can only do
                  per-listing reassignment within their team (CP-permanent RM
                  changes are admin-only because they affect org ownership). */}
              {isAdmin ? (
                <div style={{ marginBottom: 16, padding: 12, border: '1px solid #e5e5e5', borderRadius: 6 }}>
                  <div style={{ fontSize: 12, color: '#666', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>
                    What do you want to reassign?
                  </div>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', padding: '6px 0' }}>
                    <input
                      type="radio"
                      name="reassign-mode"
                      value="listings"
                      checked={mode === 'listings'}
                      onChange={() => setMode('listings')}
                      disabled={submitting}
                      style={{ marginTop: 3 }}
                    />
                    <span>
                      <strong>These listings only</strong>
                      {' '}<span style={{ color: '#888', fontSize: 13 }}>(default)</span>
                      <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                        Reassigns the selected {selectedSubmissions.length} listing{selectedSubmissions.length === 1 ? '' : 's'} to the chosen RM. Each CP's permanent RM assignment is unchanged — their other listings stay put.
                      </div>
                    </span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', padding: '6px 0' }}>
                    <input
                      type="radio"
                      name="reassign-mode"
                      value="cps"
                      checked={mode === 'cps'}
                      onChange={() => setMode('cps')}
                      disabled={submitting}
                      style={{ marginTop: 3 }}
                    />
                    <span>
                      <strong>Each CP's permanent RM</strong>
                      <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                        Changes the CP's permanent RM. <em>All</em> of each CP's listings — past and future, not just the {selectedSubmissions.length} you selected — will appear under the new RM going forward.
                      </div>
                    </span>
                  </label>
                </div>
              ) : (
                <div style={{ marginBottom: 16, padding: 12, background: '#F3F0FF', border: '1px solid #DDD6FE', borderRadius: 6, fontSize: 13, color: '#4C1D95' }}>
                  Reassigning <strong>{selectedSubmissions.length} listing{selectedSubmissions.length === 1 ? '' : 's'}</strong> to an RM in your team. Each CP's permanent RM is unchanged.
                </div>
              )}

              {mode === 'cps' && (
                <div style={{ background: '#FFF8E1', color: '#7C4A03', padding: 12, borderRadius: 4, fontSize: 13, marginBottom: 16 }}>
                  ⚠ Permanent CP-RM change. Affects <em>all</em> of each CP's listings. Confirm carefully.
                </div>
              )}

              <div>
                <label style={{ fontSize: 12, color: '#666', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4, display: 'block' }}>
                  Target RM
                </label>
                <select
                  value={targetRmId}
                  onChange={(e) => setTargetRmId(e.target.value)}
                  disabled={submitting || loadingRms}
                  style={inputStyle}
                >
                  <option value="">— select RM —</option>
                  {rms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}{r.is_manager ? ' (Manager)' : ''}{r.city ? ` · ${r.city}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {mode === 'listings' ? (
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={th}>Listing</th>
                      <th style={th}>Society / City</th>
                      <th style={th}>CP</th>
                      <th style={th}>Current listing-RM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedSubmissions.map((s) => (
                      <tr key={s.id}>
                        <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{s.public_id || `#${s.id}`}</td>
                        <td style={td}>
                          <div>{s.society_name || '—'}</div>
                          <div style={{ fontSize: 11, color: '#666' }}>{s.city || '—'}</div>
                        </td>
                        <td style={td}>
                          <div>{s.cp_name || '—'}</div>
                          {s.cp_code && <div style={{ fontSize: 11, color: '#999' }}>{s.cp_code}</div>}
                        </td>
                        <td style={{ ...td, color: '#666' }}>
                          {s.listing_rm_name || <span style={{ fontStyle: 'italic', color: '#999' }}>(none — uses CP's RM)</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={th}>CP</th>
                      <th style={th}>Current RM</th>
                      <th style={th}>Selected listings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cpSummary.map((c) => (
                      <tr key={c.cp_id}>
                        <td style={td}>
                          <div style={{ fontWeight: 600 }}>{c.cp_name}</div>
                          {c.cp_code && <div style={{ fontSize: 11, color: '#999' }}>{c.cp_code}</div>}
                        </td>
                        <td style={{ ...td, color: '#666' }}>{c.current_rm_name}</td>
                        <td style={td}>
                          <span style={{ fontWeight: 600 }}>{c.count}</span>
                          <span style={{ color: '#888' }}> in your selection</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : (
            <div>
              {/* Success summary — different shape per mode */}
              {resultSummary._mode === 'listings' ? (
                <div style={{ background: '#F0FDF4', color: '#166534', padding: 12, borderRadius: 4, fontSize: 14, marginBottom: 12 }}>
                  ✓ Reassigned <strong>{resultSummary.updated_count}</strong> listing{resultSummary.updated_count === 1 ? '' : 's'} to{' '}
                  <strong>{resultSummary.target_rm_name}</strong> (override on listing only — CP-permanent RM unchanged).
                  {resultSummary.skipped_already_on_rm > 0 && (
                    <> {resultSummary.skipped_already_on_rm} were already on this RM.</>
                  )}
                </div>
              ) : (
                <>
                  <div style={{ background: '#F0FDF4', color: '#166534', padding: 12, borderRadius: 4, fontSize: 14, marginBottom: 12 }}>
                    ✓ Reassigned {resultSummary.reassigned_count} CP{resultSummary.reassigned_count === 1 ? '' : 's'} to{' '}
                    <strong>{resultSummary.target_rm_name}</strong>.
                    {resultSummary.skipped_already_on_rm > 0 && (
                      <> {resultSummary.skipped_already_on_rm} were already on this RM (no change).</>
                    )}
                    {resultSummary.not_found > 0 && (
                      <> {resultSummary.not_found} CPs were not found.</>
                    )}
                  </div>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={th}>CP</th>
                        <th style={th}>Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(resultSummary.results || []).map((r) => (
                        <tr key={r.cp_id} style={{ background: r.ok ? (r.skipped ? '#FFF8E1' : '#F0FDF4') : '#fef2f2' }}>
                          <td style={td}>
                            <div style={{ fontWeight: 600 }}>{r.name || `CP #${r.cp_id}`}</div>
                            {r.cp_code && <div style={{ fontSize: 11, color: '#999' }}>{r.cp_code}</div>}
                          </td>
                          <td style={td}>
                            {r.ok && r.skipped && <span style={{ color: '#7C4A03' }}>↺ {r.note}</span>}
                            {r.ok && !r.skipped && <span style={{ color: '#166534' }}>✓ Reassigned</span>}
                            {!r.ok && <span style={{ color: '#991b1b' }}>✗ {r.error}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}
        </div>

        <div style={footer}>
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
                  ? `Reassigning…`
                  : (mode === 'listings'
                    ? `Reassign ${selectedSubmissions.length} listing${selectedSubmissions.length === 1 ? '' : 's'}${targetRm ? ` to ${targetRm.name}` : ''}`
                    : `Reassign ${cpSummary.length} CP${cpSummary.length === 1 ? '' : 's'}${targetRm ? ` to ${targetRm.name}` : ''}`
                  )}
              </button>
            </>
          ) : (
            <button
              onClick={handleClose}
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
