/**
 * Assigned RM — per-listing RM override (submissions.listing_rm_id; doesn't
 * touch the CP's permanent RM). Admin/manager get the full scope picker
 * (this listing only vs. this listing + a society→RM mapping for future
 * submissions); plain RMs and viewers see a read-only effective RM. Ported
 * from CP DetailPanel.jsx ("Assigned RM" block + assignListingRm).
 *
 * Role checks (isAdmin/isManager/canReassign) are computed independently of
 * the generic `canAct` gate — only admin/manager may reassign, same as CP.
 */
import { useEffect, useState } from 'react';
import { api } from '../../../api';
import { getUser } from '../../../auth';

export default function ReassignRmSection({ submission, onChanged }) {
  const [rms, setRms] = useState([]);
  const [rmAssignMode, setRmAssignMode] = useState('listing');
  const [busy, setBusy] = useState(false);

  const user = getUser();
  const isAdmin = user?.role === 'admin';
  const isViewer = user?.role === 'viewer';
  const isManager = !isAdmin && !isViewer && (user?.role === 'manager' || user?.isManager);
  const canReassign = isAdmin || isManager;

  useEffect(() => {
    if (!canReassign || rms.length > 0) return;
    api.adminListRms().then((r) => setRms(r.rms || [])).catch(() => {});
  }, [canReassign, rms.length]);

  if (!submission) return null;
  const s = submission;

  const assignListingRm = async (rmIdRaw, { updateSocietyMapping = false } = {}) => {
    if (busy) return;
    const rmId = rmIdRaw ? parseInt(rmIdRaw, 10) : null;
    setBusy(true);
    try {
      await api.adminSetListingRm(s.id, rmId, { updateSocietyMapping });
      const fresh = await api.adminGetSubmission(s.id);
      onChanged?.({ ...fresh.submission, events: fresh.events });
    } catch (err) {
      alert(err.message || 'Failed to set listing RM');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card-block">
      <h3>Assigned RM</h3>
      {canReassign ? (
        <>
          <div style={{ marginBottom: 10, padding: 10, border: '1px solid var(--border)', borderRadius: 'var(--r-sm)' }}>
            <div className="field-lbl" style={{ marginBottom: 6 }}>Reassign scope</div>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 6, cursor: 'pointer', marginBottom: 4, fontWeight: 400 }}>
              <input
                type="radio"
                name={`rm-mode-${s.id}`}
                checked={rmAssignMode === 'listing'}
                onChange={() => setRmAssignMode('listing')}
                disabled={busy}
              />
              <span style={{ fontSize: 13 }}>
                <strong>This listing only</strong>{' '}
                <span className="muted">(default)</span>
              </span>
            </label>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 6, cursor: 'pointer', fontWeight: 400 }}>
              <input
                type="radio"
                name={`rm-mode-${s.id}`}
                checked={rmAssignMode === 'society'}
                onChange={() => setRmAssignMode('society')}
                disabled={busy}
              />
              <span style={{ fontSize: 13 }}>
                <strong>This listing + future submissions of {s.society_name || 'this society'}</strong>{' '}
                <span className="muted">(writes society→RM mapping)</span>
              </span>
            </label>
          </div>

          <select
            value={s.listing_rm_id || ''}
            onChange={(e) => assignListingRm(e.target.value, { updateSocietyMapping: rmAssignMode === 'society' })}
            disabled={busy}
          >
            <option value="">— No override (use city fallback) —</option>
            {rms.map((rm) => (
              <option key={rm.id} value={rm.id}>
                {rm.name}{rm.city ? ` · ${rm.city}` : ''}{rm.is_manager ? ' · Manager' : ''}
              </option>
            ))}
          </select>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            {rmAssignMode === 'listing'
              ? `Reassigns THIS listing only. Other submissions for ${s.society_name || 'this society'} are not touched.`
              : `Reassigns THIS listing AND points future submissions of ${s.society_name || 'this society'} at the chosen RM (existing other submissions of this society are unchanged).`}
          </div>
        </>
      ) : (
        <div className="field-val">
          {s.listing_rm_name ? (
            <>
              {s.listing_rm_name}
              <span style={{ fontSize: 11, color: 'var(--purple)', marginLeft: 6 }}>(listing override)</span>
            </>
          ) : (
            s.cp_rm_name || <span className="muted" style={{ fontStyle: 'italic' }}>Unassigned</span>
          )}
        </div>
      )}
    </div>
  );
}
