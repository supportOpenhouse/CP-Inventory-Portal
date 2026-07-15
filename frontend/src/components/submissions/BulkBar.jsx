/**
 * Floating select-mode action bar. Shell ported from Direct Inventory's
 * `components/BulkActionBar.jsx` (fixed, orange-bordered `.bulk-bar` pinned
 * top-right — see the second `.bulk-bar` rule in styles.css, which wins the
 * cascade over the inline non-fixed one used elsewhere) — retargeted at this
 * app's stage machine (`STAGES` / `AUTO_ONLY_STAGES` / `REJECTED_REASONS`
 * from format.js) and its three bulk endpoints:
 *
 *   - Change Stage   -> api.adminBulkStatus, inline stage + (if Rejected) a
 *                       reject-reason picker, applied directly from the bar.
 *   - Schedule Visit -> opens BulkScheduleVisitModal (ported from CP;
 *                       20-item cap enforced here, mirroring CP's admin
 *                       screen which disables the action past 20 selected).
 *   - Reassign RM    -> opens BulkReassignRmModal (ported from CP);
 *                       admin/manager only, gated by `canReassign`.
 *
 * Rendered for the whole of `bulkMode`, including at zero selected — changing
 * a filter clears the selection (it must: filters are client-side, so stale ids
 * would target hidden rows), and unmounting the bar on that would yank the
 * toolbar out from under the user mid-task. At zero it just disables Apply.
 * On any successful action (`adminBulkStatus`, or either modal's onSuccess)
 * this clears the selection, exits bulk mode, and tells the page to reload.
 *
 * "Select all": `GET /admin/submissions?all=true` returns every row matching the
 * current server filters (capped at 5000 by _list_submissions_core); the page
 * then selects those that also pass the client-only refinements, using the same
 * `matchesClientFilters` predicate the Board/Table render through. Rows the user
 * unticks afterwards simply leave `selectedIds`. If the 5000 cap truncates, the
 * page passes a `selectAllNote` and we render it — never a silent cap.
 */
import { useMemo, useState } from 'react';

import { api } from '../../api';
import { STAGES, AUTO_ONLY_STAGES, REJECTED_REASONS } from '../../format';
import BulkScheduleVisitModal from './BulkScheduleVisitModal.jsx';
import BulkReassignRmModal from './BulkReassignRmModal.jsx';

// Bulk-schedule-visit has a hard server-side cap (BULK_SCHEDULE_VISIT_MAX_ITEMS
// = 20 in backend/routes/admin.py) — block the action client-side past that,
// same as CP's admin screen does before ever opening the modal.
const SCHEDULE_VISIT_MAX = 20;

// Stages the backend accepts for a manual bulk status change. AUTO_ONLY_STAGES
// (Visit Scheduled / Visit Completed / Offer) are set by dedicated flows only
// — POSTing one of these to /admin/submissions/bulk-status is rejected with
// a 400, so they're not offered here.
const STAGE_OPTIONS = STAGES.filter((s) => !AUTO_ONLY_STAGES.has(s.key));

export default function BulkBar({
  bulkMode,
  selectedIds,
  submissions = [],
  onSelectAll,
  selectingAll = false,
  selectAllNote = '',
  selectAllCap,
  onClearSelection,
  onExitBulkMode,
  onChanged,
  canReassign = false,
}) {
  const [action, setAction] = useState(''); // '' | 'stage' | 'schedule' | 'reassign'
  const [stage, setStage] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showReassignModal, setShowReassignModal] = useState(false);

  const selectedSubmissions = useMemo(
    () => submissions.filter((s) => selectedIds.has(s.id)),
    [submissions, selectedIds],
  );

  if (!bulkMode) return null;

  function changeAction(next) {
    setAction(next);
    setStage('');
    setRejectReason('');
    setError('');
  }

  function finishSuccess() {
    changeAction('');
    onClearSelection?.();
    onExitBulkMode?.();
    onChanged?.();
  }

  async function applyStageChange() {
    setError('');
    setSubmitting(true);
    try {
      await api.adminBulkStatus(
        Array.from(selectedIds),
        stage,
        stage === 'Rejected' ? rejectReason : null,
      );
      finishSuccess();
    } catch (err) {
      setError(err.message || 'Bulk status change failed');
    } finally {
      setSubmitting(false);
    }
  }

  function handleApply() {
    if (action === 'stage') { applyStageChange(); return; }
    if (action === 'schedule') { setShowScheduleModal(true); return; }
    if (action === 'reassign') { setShowReassignModal(true); return; }
  }

  const overScheduleCap = action === 'schedule' && selectedIds.size > SCHEDULE_VISIT_MAX;
  // The bar now renders at zero selected, so Apply must gate on the selection
  // itself — nothing below implies a non-empty set any more. Also gate on
  // `selectingAll`: a Select-all fetch in flight means `selectedIds` is about
  // to be replaced, so Apply must not fire against it in the meantime.
  const canApply = !submitting && !selectingAll && selectedIds.size > 0 && (
    (action === 'stage' && Boolean(stage) && (stage !== 'Rejected' || Boolean(rejectReason))) ||
    (action === 'schedule' && !overScheduleCap) ||
    action === 'reassign'
  );

  return (
    <>
      <div className="bulk-bar">
        <span className="bulk-count">{selectedIds.size} selected</span>

        {onSelectAll && (
          <button
            type="button"
            className="btn-link"
            onClick={onSelectAll}
            disabled={submitting || selectingAll}
            title={`Selects every row matching the current filters (server cap: ${selectAllCap})`}
          >
            {selectingAll ? 'Selecting…' : `Select all (${selectAllCap} cap)`}
          </button>
        )}
        {selectAllNote && <span className="bulk-error">{selectAllNote}</span>}

        <select value={action} onChange={(e) => changeAction(e.target.value)} disabled={submitting}>
          <option value="">— action —</option>
          <option value="stage">Change Stage</option>
          <option value="schedule">Schedule Visit</option>
          {canReassign && <option value="reassign">Reassign RM</option>}
        </select>

        {action === 'stage' && (
          <>
            <select value={stage} onChange={(e) => { setStage(e.target.value); setRejectReason(''); }} disabled={submitting}>
              <option value="">— stage —</option>
              {STAGE_OPTIONS.map((s) => (
                <option key={s.key} value={s.key}>{s.label || s.key}</option>
              ))}
            </select>
            {stage === 'Rejected' && (
              <select value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} disabled={submitting}>
                <option value="">— reason —</option>
                {REJECTED_REASONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            )}
          </>
        )}

        {overScheduleCap && (
          <span className="bulk-error" title={`Max ${SCHEDULE_VISIT_MAX} listings per bulk request`}>
            Max {SCHEDULE_VISIT_MAX} for Schedule Visit
          </span>
        )}

        <button type="button" className="btn-primary" onClick={handleApply} disabled={!canApply}>
          {submitting ? 'Applying…' : 'Apply'}
        </button>
        <button
          type="button"
          className="btn-ghost"
          // Clearing alone used to dismiss the bar (empty selection unmounted
          // it). It stays mounted now, so Cancel has to leave bulk mode itself.
          onClick={() => { changeAction(''); onClearSelection?.(); onExitBulkMode?.(); }}
          disabled={submitting}
        >
          Cancel
        </button>
        {error && <span className="bulk-error">{error}</span>}
      </div>

      {showScheduleModal && (
        <BulkScheduleVisitModal
          selectedSubmissions={selectedSubmissions}
          onClose={() => setShowScheduleModal(false)}
          onSuccess={() => { setShowScheduleModal(false); finishSuccess(); }}
        />
      )}

      {showReassignModal && (
        <BulkReassignRmModal
          selectedSubmissions={selectedSubmissions}
          onClose={() => setShowReassignModal(false)}
          onSuccess={() => { setShowReassignModal(false); finishSuccess(); }}
        />
      )}
    </>
  );
}
