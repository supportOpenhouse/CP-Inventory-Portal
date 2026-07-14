/**
 * Status — editable stage dropdown (or read-only label) + Rejected-reason
 * sub-dropdown. Ported from CP DetailPanel.jsx (top-level status block +
 * handleStatusChange). AUTO_ONLY_STAGES (Visit Scheduled / Visit Completed /
 * Offer) are never manual destinations, and the dropdown is hidden entirely
 * while the row is already in one of them — those transitions happen via
 * the dedicated Schedule Visit / Counter Offer flows instead.
 */
import { useState } from 'react';
import { api } from '../../../api';
import { STAGES, AUTO_ONLY_STAGES, REJECTED_REASONS, stageMeta } from '../../../format';

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

  const canEdit = canAct && !AUTO_ONLY_STAGES.has(s.status);

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
              <option key={st.key} value={st.key} disabled={AUTO_ONLY_STAGES.has(st.key)}>
                {(st.label || st.key)}{AUTO_ONLY_STAGES.has(st.key) ? ' (auto)' : ''}
              </option>
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
          {AUTO_ONLY_STAGES.has(s.status) && (
            <div className="muted" style={{ fontSize: 11, fontWeight: 400, marginTop: 2 }}>
              Set automatically — not manually changeable from here.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
