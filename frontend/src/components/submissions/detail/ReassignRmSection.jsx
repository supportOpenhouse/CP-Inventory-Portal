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
import { IconArrowRight } from '../../icons.jsx';

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

  // The RM who actually owns this listing right now — the per-listing RM if
  // set, else the CP's permanent RM (same rule as the backend scope filter).
  // *_active come from get_submission; false means deactivated or dangling.
  const viaListing = !!s.listing_rm_id;
  const current = viaListing
    ? { name: s.listing_rm_name, active: s.listing_rm_active !== false }
    : s.cp_rm_id
      ? { name: s.cp_rm_name, active: s.cp_rm_active !== false }
      : null;

  // The picker list is active-only. A deactivated current RM therefore has no
  // <option>, and a <select> whose value matches nothing silently displays its
  // FIRST option — this used to read "No override" on listings that did have
  // an RM. Render the current one explicitly so the select shows the truth;
  // `disabled` keeps it un-pickable. (The API rejects an inactive target too —
  // _validate_target_rm — so this is display, not the enforcement.)
  const currentMissingFromList = viaListing && !rms.some((rm) => rm.id === s.listing_rm_id);

  // "No override" hands the listing to the CP's RM. If that RM is deactivated
  // or the CP has none, choosing it leaves the listing with no active RM —
  // exactly what an Invalid RM lead is — so it isn't offered then.
  const cpRmUsable = !!s.cp_rm_id && s.cp_rm_active !== false;
  const noOverrideLabel = s.cp_rm_id
    ? `— No override (use CP's RM: ${s.cp_rm_name}${cpRmUsable ? '' : ', disabled'}) —`
    : '— No override (CP has no RM) —';

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
      <div className="arm-current">
        <span className="muted">Current RM</span>{' '}
        {current ? (
          <>
            <strong>{current.name || 'Unknown RM'}</strong>
            <span className="muted"> · {viaListing ? 'set on this listing' : "the CP's RM"}</span>
            {!current.active && <span className="arm-disabled">disabled</span>}
          </>
        ) : (
          <span className="arm-disabled">none</span>
        )}
      </div>
      {canReassign && current && !current.active && (
        <div className="arm-warn">
          This RM is disabled — their listings stay with them until reassigned.
          Pick an active RM below.
        </div>
      )}

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
                <span className="muted">(writes society <IconArrowRight size={12} style={{ verticalAlign: '-2px' }} /> RM mapping)</span>
              </span>
            </label>
          </div>

          <select
            value={s.listing_rm_id || ''}
            onChange={(e) => assignListingRm(e.target.value, { updateSocietyMapping: rmAssignMode === 'society' })}
            disabled={busy}
          >
            {/* Was "use city fallback" — wrong: clearing the override falls
                back to the CP's RM. The city default applies only at insert. */}
            <option value="" disabled={!cpRmUsable}>{noOverrideLabel}</option>
            {currentMissingFromList && (
              <option value={s.listing_rm_id} disabled>
                {s.listing_rm_name || `RM #${s.listing_rm_id}`}
                {s.listing_rm_active === false ? ' (disabled)' : ''}
              </option>
            )}
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
      ) : null}
    </div>
  );
}
