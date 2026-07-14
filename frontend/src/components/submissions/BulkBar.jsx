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
 * Rendered only while `bulkMode` is on AND at least one row is selected.
 * On any successful action (`adminBulkStatus`, or either modal's onSuccess)
 * this clears the selection, exits bulk mode, and tells the page to reload.
 *
 * "Select all matching": this app's admin list endpoint
 * (`GET /admin/submissions`) always paginates per stage (default 15,
 * capped at 500) — there is no ids-only/unlimited endpoint for it (only the
 * CSV export sweeps every matching row, and that's a separate file-download
 * codepath). Rather than add a new backend route for this task, "Select all"
 * here selects every row *already loaded* into the page (same rows
 * BoardView/TableView are currently rendering — identical semantics to
 * TableView's own header "select all" checkbox). If more rows exist below
 * what's loaded (further pages / more stage scroll), they are NOT included.
 * Needs `setSelectedIds` from the page to work; without it the control is
 * simply omitted.
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
  setSelectedIds,
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

  if (!bulkMode || selectedIds.size === 0) return null;

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

  function selectAllLoaded() {
    setSelectedIds?.(new Set(submissions.map((s) => s.id)));
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
  const canApply = !submitting && (
    (action === 'stage' && Boolean(stage) && (stage !== 'Rejected' || Boolean(rejectReason))) ||
    (action === 'schedule' && !overScheduleCap) ||
    action === 'reassign'
  );

  return (
    <>
      <div className="bulk-bar">
        <span className="bulk-count">{selectedIds.size} selected</span>

        {setSelectedIds && (
          <button
            type="button"
            className="btn-link"
            onClick={selectAllLoaded}
            disabled={submitting || submissions.length === 0 || selectedIds.size === submissions.length}
            title="Selects every row currently loaded on the page — doesn't reach further pages/stage scroll not yet loaded"
          >
            Select all loaded ({submissions.length})
          </button>
        )}

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
        <button type="button" className="btn-ghost" onClick={onClearSelection} disabled={submitting}>
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
