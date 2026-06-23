import { useEffect, useMemo, useState } from 'react';

import { ApiError, api } from '../../api';

/**
 * Bulk RM reassignment with two modes:
 *   - 'listings' (DEFAULT): sets submissions.listing_rm_id for the selected
 *     rows ONLY. Other submissions of the same societies/CPs are not touched.
 *   - 'societies': same listing_rm_id update, AND upserts society_rm_mappings
 *     for every distinct society in the selection so future submissions of
 *     those societies route to the new RM. Existing other submissions of
 *     those societies are still left alone.
 *
 * Props:
 *   selectedSubmissions: array of submission rows currently ticked
 *   onClose: () => void
 *   onSuccess: () => void   // parent should clear selection + reload
 */
export default function BulkReassignRmModal({ selectedSubmissions, onClose, onSuccess }) {
  const [mode, setMode] = useState('listings');  // 'listings' (default) | 'societies'
  const [rms, setRms] = useState([]);
  const [loadingRms, setLoadingRms] = useState(true);
  const [targetRmId, setTargetRmId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [resultSummary, setResultSummary] = useState(null);

  // Load RM list on mount. Backend already returns only active RMs.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await api.adminListRms();
        if (alive) setRms(data?.rms || []);
      } catch (e) {
        if (alive) setError(e instanceof ApiError ? e.message : 'Failed to load RMs');
      } finally {
        if (alive) setLoadingRms(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Group selected submissions by society so we can show the per-society impact
  // (count of selected listings per society, plus the city for context).
  const societySummary = useMemo(() => {
    const map = new Map(); // society (text) -> { society, society_name, city, count }
    for (const s of selectedSubmissions) {
      const key = s.society || s.society_name;
      if (!key) continue;
      const ex = map.get(key);
      if (ex) {
        ex.count += 1;
      } else {
        map.set(key, {
          society: key,
          society_name: s.society_name || s.society || key,
          city: s.city || '',
          count: 1,
        });
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => (a.society_name || '').localeCompare(b.society_name || '')
    );
  }, [selectedSubmissions]);

  const targetRm = rms.find((r) => String(r.id) === String(targetRmId));
  const canSubmit = (
    targetRmId &&
    selectedSubmissions.length > 0 &&
    !submitting && !loadingRms
  );

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setError('');
    setResultSummary(null);
    setSubmitting(true);
    try {
      const data = await api.adminBulkReassignListingRm({
        submission_ids: selectedSubmissions.map((s) => s.id),
        target_rm_id: Number(targetRmId),
        update_society_mapping: mode === 'societies',
      });
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
              : `Reassign ${selectedSubmissions.length} listing${selectedSubmissions.length === 1 ? '' : 's'} to a new RM`}
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
              {/* Mode picker. Listing-only is the default; the second mode
                  also writes society→RM mappings so future submissions for
                  the same societies route to the new RM. */}
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
                      Reassigns the selected {selectedSubmissions.length} listing{selectedSubmissions.length === 1 ? '' : 's'} to the chosen RM. Other submissions of the same societies are not touched.
                    </div>
                  </span>
                </label>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', padding: '6px 0' }}>
                  <input
                    type="radio"
                    name="reassign-mode"
                    value="societies"
                    checked={mode === 'societies'}
                    onChange={() => setMode('societies')}
                    disabled={submitting}
                    style={{ marginTop: 3 }}
                  />
                  <span>
                    <strong>These listings + future submissions of their societies</strong>
                    <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                      Reassigns the selected listings AND points future submissions of the {societySummary.length} societ{societySummary.length === 1 ? 'y' : 'ies'} below at the chosen RM. Existing other submissions of those societies are unchanged.
                    </div>
                  </span>
                </label>
              </div>

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
                          {s.listing_rm_name || <span style={{ fontStyle: 'italic', color: '#999' }}>(none — city fallback)</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={th}>Society</th>
                      <th style={th}>City</th>
                      <th style={th}>Selected listings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {societySummary.map((soc) => (
                      <tr key={soc.society}>
                        <td style={td}>
                          <div style={{ fontWeight: 600 }}>{soc.society_name}</div>
                        </td>
                        <td style={{ ...td, color: '#666' }}>{soc.city || '—'}</td>
                        <td style={td}>
                          <span style={{ fontWeight: 600 }}>{soc.count}</span>
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
              <div style={{ background: '#F0FDF4', color: '#166534', padding: 12, borderRadius: 4, fontSize: 14, marginBottom: 12 }}>
                ✓ Reassigned <strong>{resultSummary.updated_count}</strong> listing{resultSummary.updated_count === 1 ? '' : 's'} to{' '}
                <strong>{resultSummary.target_rm_name}</strong>.
                {resultSummary.skipped_already_on_rm > 0 && (
                  <> {resultSummary.skipped_already_on_rm} were already on this RM.</>
                )}
                {resultSummary._mode === 'societies' && resultSummary.society_mappings_updated > 0 && (
                  <>{' '}Future submissions of{' '}
                    <strong>{resultSummary.society_mappings_updated}</strong>{' '}
                    societ{resultSummary.society_mappings_updated === 1 ? 'y' : 'ies'}{' '}
                    will also route to {resultSummary.target_rm_name}.
                  </>
                )}
              </div>
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
                  : `Reassign ${selectedSubmissions.length} listing${selectedSubmissions.length === 1 ? '' : 's'}${targetRm ? ` to ${targetRm.name}` : ''}${mode === 'societies' && societySummary.length ? ` + map ${societySummary.length} societ${societySummary.length === 1 ? 'y' : 'ies'}` : ''}`}
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
