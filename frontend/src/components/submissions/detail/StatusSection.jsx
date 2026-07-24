/**
 * Status — editable stage dropdown (or read-only label) + Rejected-reason
 * sub-dropdown. Ported from CP DetailPanel.jsx (top-level status block +
 * handleStatusChange). Gating is by forms_uid: a submission LINKED to a
 * property (forms_uid set) has its stage driven by the cp_inventory_status
 * sync, so it's fully read-only here; an UNLINKED submission has no
 * automation, so every stage is a valid manual destination.
 */
import { useState } from 'react';
import { api } from '../../../api';
import { STAGES, REJECTED_REASONS, stageMeta } from '../../../format';

export default function StatusSection({ submission, canAct, onChanged }) {
  const [busy, setBusy] = useState(false);
  // 'Rejected' picked but reason not yet chosen — shows the reason
  // sub-dropdown without persisting the status change yet.
  const [pendingRejected, setPendingRejected] = useState(false);

  if (!submission) return null;
  const s = submission;

  const handleStatusChange = async (newStatus, newReason = null) => {
    if (busy) return;
    if (newStatus === s.status && (newReason || null) === (s.status_reason || null)) return;
    setBusy(true);
    try {
      await api.adminChangeStatus(s.id, newStatus, newReason);
      const fresh = await api.adminGetSubmission(s.id);
      onChanged?.({ ...fresh.submission, events: fresh.events });
    } catch (err) {
      alert(err.message || 'Failed to change status');
    } finally {
      setBusy(false);
    }
  };

  // forms_uid present → linked to a property; the cp_inventory_status sync owns
  // the stage, so it's fully read-only at every stage. Absent → no automation,
  // so the stage is fully manual (including the otherwise-auto stages).
  const linked = !!s.forms_uid;
  const canEdit = canAct && !linked;

  return (
    <div className="card-block">
      <h3>Status</h3>
      {canEdit ? (
        <>
          <select
            value={pendingRejected ? 'Rejected' : s.status}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'Rejected') {
                // Show the reason sub-dropdown; don't persist yet. If the
                // row is already Rejected, reuse the existing reason.
                setPendingRejected(true);
                return;
              }
              setPendingRejected(false);
              handleStatusChange(v, null);
            }}
            disabled={busy}
          >
            {STAGES.map((st) => (
              <option key={st.key} value={st.key}>{st.label || st.key}</option>
            ))}
          </select>
          {(s.status === 'Rejected' || pendingRejected) && (
            <select
              style={{ marginTop: 6 }}
              value={s.status_reason || ''}
              onChange={(e) => {
                const reason = e.target.value || null;
                setPendingRejected(false);
                if (reason) handleStatusChange('Rejected', reason);
              }}
              disabled={busy}
            >
              <option value="" disabled>Select reason…</option>
              {REJECTED_REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          )}
        </>
      ) : (
        <div className="field-val" style={{ fontWeight: 500 }}>
          <span className="stage-dot" style={{ background: stageMeta(s.status).color }} />
          {s.status}{s.status_reason ? ` (${s.status_reason})` : ''}
          {linked && (
            <div className="muted" style={{ fontSize: 11, fontWeight: 400, marginTop: 2 }}>
              Set automatically — not manually changeable from here.
              Please change from the supply tracker.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
