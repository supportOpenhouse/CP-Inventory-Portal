/**
 * Bulk RM reassignment modal. Ported from CP's
 * `screens/Admin/BulkReassignRmModal.jsx` — logic kept verbatim (two modes,
 * `adminBulkReassignListingRm` call, per-society summary); chrome retokened
 * onto this app's `.modal`/`.btn-*`/`.inv-table` classes and CSS custom
 * properties instead of CP's inline hex-color styles.
 *
 * Two modes:
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
import { useEffect, useMemo, useState } from 'react';

import { ApiError, api } from '../../api';
import { IconClose } from '../icons.jsx';

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
    const map = new Map(); // society_id -> { society_id, society_name, city, count }
    for (const s of selectedSubmissions) {
      if (!s.society_id) continue;
      const ex = map.get(s.society_id);
      if (ex) {
        ex.count += 1;
      } else {
        map.set(s.society_id, {
          society_id: s.society_id,
          society_name: s.society_name || `Society #${s.society_id}`,
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

  const submitted = resultSummary !== null;

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}>
      <div className="modal modal-wide" style={{ maxHeight: '90vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head-row">
          <h3 style={{ marginBottom: 0, flex: 1 }}>
            {submitted
              ? 'Reassignment complete'
              : `Reassign ${selectedSubmissions.length} listing${selectedSubmissions.length === 1 ? '' : 's'} to a new RM`}
          </h3>
          <button
            type="button"
            className="modal-close"
            onClick={() => (submitting ? null : (submitted ? handleClose() : onClose()))}
            disabled={submitting}
            aria-label="Close"
          ><IconClose /></button>
        </div>

        <div style={{ overflow: 'auto', flex: 1 }}>
          {error && <div className="modal-error">{error}</div>}

          {!submitted ? (
            <>
              {/* Mode picker. Listing-only is the default; the second mode
                  also writes society→RM mappings so future submissions for
                  the same societies route to the new RM. */}
              <div style={{ marginBottom: 16, padding: 12, border: '1px solid var(--border)', borderRadius: 'var(--r-sm)' }}>
                <div className="field-lbl" style={{ marginBottom: 8 }}>
                  What do you want to reassign?
                </div>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', padding: '6px 0', fontWeight: 400 }}>
                  <input
                    type="radio"
                    name="bulk-reassign-mode"
                    value="listings"
                    checked={mode === 'listings'}
                    onChange={() => setMode('listings')}
                    disabled={submitting}
                    style={{ marginTop: 3 }}
                  />
                  <span>
                    <strong>These listings only</strong>
                    {' '}<span className="muted" style={{ fontSize: 13 }}>(default)</span>
                    <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                      Reassigns the selected {selectedSubmissions.length} listing{selectedSubmissions.length === 1 ? '' : 's'} to the chosen RM. Other submissions of the same societies are not touched.
                    </div>
                  </span>
                </label>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', padding: '6px 0', fontWeight: 400 }}>
                  <input
                    type="radio"
                    name="bulk-reassign-mode"
                    value="societies"
                    checked={mode === 'societies'}
                    onChange={() => setMode('societies')}
                    disabled={submitting}
                    style={{ marginTop: 3 }}
                  />
                  <span>
                    <strong>These listings + future submissions of their societies</strong>
                    <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                      Reassigns the selected listings AND points future submissions of the {societySummary.length} societ{societySummary.length === 1 ? 'y' : 'ies'} below at the chosen RM. Existing other submissions of those societies are unchanged.
                    </div>
                  </span>
                </label>
              </div>

              <div>
                <label className="field-lbl" style={{ marginBottom: 4, display: 'block' }}>
                  Target RM
                </label>
                <select
                  value={targetRmId}
                  onChange={(e) => setTargetRmId(e.target.value)}
                  disabled={submitting || loadingRms}
                >
                  <option value="">— select RM —</option>
                  {rms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}{r.is_manager ? ' (Manager)' : ''}{r.city ? ` · ${r.city}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="inv-table-wrap" style={{ marginTop: 12, boxShadow: 'none' }}>
                {mode === 'listings' ? (
                  <table className="inv-table">
                    <thead>
                      <tr>
                        <th className="inv-th">Listing</th>
                        <th className="inv-th">Society / City</th>
                        <th className="inv-th">CP</th>
                        <th className="inv-th">Current listing-RM</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedSubmissions.map((s) => (
                        <tr key={s.id} style={{ borderBottom: '1px solid var(--hairline)' }}>
                          <td style={{ padding: '9px 10px', fontFamily: 'monospace', fontSize: 12 }}>{s.public_id || `#${s.id}`}</td>
                          <td style={{ padding: '9px 10px' }}>
                            <div>{s.society_name || '—'}</div>
                            <div className="muted" style={{ fontSize: 11 }}>{s.city || '—'}</div>
                          </td>
                          <td style={{ padding: '9px 10px' }}>
                            <div>{s.cp_name || '—'}</div>
                            {s.cp_code && <div className="muted" style={{ fontSize: 11 }}>{s.cp_code}</div>}
                          </td>
                          <td className="muted" style={{ padding: '9px 10px' }}>
                            {s.listing_rm_name || <span style={{ fontStyle: 'italic' }}>(none — city fallback)</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <table className="inv-table">
                    <thead>
                      <tr>
                        <th className="inv-th">Society</th>
                        <th className="inv-th">City</th>
                        <th className="inv-th">Selected listings</th>
                      </tr>
                    </thead>
                    <tbody>
                      {societySummary.map((soc) => (
                        <tr key={soc.society_id} style={{ borderBottom: '1px solid var(--hairline)' }}>
                          <td style={{ padding: '9px 10px' }}>
                            <div style={{ fontWeight: 600 }}>{soc.society_name}</div>
                          </td>
                          <td className="muted" style={{ padding: '9px 10px' }}>{soc.city || '—'}</td>
                          <td style={{ padding: '9px 10px' }}>
                            <span style={{ fontWeight: 600 }}>{soc.count}</span>
                            <span className="muted"> in your selection</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          ) : (
            <div style={{ background: 'var(--green-bg)', color: 'var(--green-fg)', padding: 12, borderRadius: 'var(--r-sm)', fontSize: 14 }}>
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
                  ? 'Reassigning…'
                  : `Reassign ${selectedSubmissions.length} listing${selectedSubmissions.length === 1 ? '' : 's'}${targetRm ? ` to ${targetRm.name}` : ''}${mode === 'societies' && societySummary.length ? ` + map ${societySummary.length} societ${societySummary.length === 1 ? 'y' : 'ies'}` : ''}`}
              </button>
            </>
          ) : (
            <>
              <span style={{ flex: 1 }} />
              <button type="button" className="btn-primary" onClick={handleClose}>
                Close
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
