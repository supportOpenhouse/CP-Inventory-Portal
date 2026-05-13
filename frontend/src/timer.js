/**
 * Reminder-timer helpers used by both the CP dashboard and the admin
 * board to render the 7-day countdown bar (and the overdue pill once
 * the deadline passes).
 *
 * Two timers exist on a submission:
 *   1. "visit" — runs while status='Submitted'.
 *      Anchor: submitted_stage_at (from submission_events) || submitted_at.
 *      Goal:   CP schedules a visit; status moves to 'Visit Scheduled'.
 *   2. "seller_meet" — runs while status='Visit Completed'.
 *      Anchor: visit_completed_stage_at (from submission_events).
 *      Goal:   CP arranges seller meeting; status moves elsewhere.
 *
 * Day counting uses IST so day boundaries match what the backend cron
 * computes (Postgres epoch / 86400). Browsers in other timezones still
 * see the same "5 days left" the cron acts on.
 */

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DEADLINE_DAYS = 7;

function istDay(dt) {
  return Math.floor((dt.getTime() + IST_OFFSET_MS) / 86400000);
}

/**
 * Return the active timer info for a submission, or null if neither
 * timer is running. Shape:
 *   {
 *     kind: 'visit' | 'seller_meet',
 *     daysSinceStart: int,            // 0 on the first day
 *     daysLeft: int,                  // capped at 0 once overdue
 *     overdue: bool,                  // daysSinceStart > 7
 *     overdueBy: int,                 // 0 unless overdue
 *     pctRemaining: int,              // 0..100 — bar fills toward 0 as time runs out
 *   }
 *
 * Returns null when:
 *   - status isn't 'Submitted' or 'Visit Completed', or
 *   - the anchor timestamp is missing AND there's no fallback.
 */
export function timerFor(submission) {
  if (!submission) return null;
  const status = submission.status;
  if (status !== 'Submitted' && status !== 'Visit Completed') return null;

  const kind = status === 'Submitted' ? 'visit' : 'seller_meet';

  // For the visit timer we accept submitted_at as a fallback so legacy
  // rows (no submission_events) still get the UI. The seller_meet timer
  // can't fall back — we don't have a per-row "visit_completed_at"
  // column, only the event row, so missing it means no timer.
  const anchorIso = kind === 'visit'
    ? (submission.submitted_stage_at || submission.submitted_at)
    : submission.visit_completed_stage_at;
  if (!anchorIso) return null;

  const anchor = new Date(anchorIso);
  if (isNaN(anchor.getTime())) return null;

  const daysSinceStart = Math.max(0, istDay(new Date()) - istDay(anchor));
  const overdue = daysSinceStart > DEADLINE_DAYS;
  const daysLeft = Math.max(0, DEADLINE_DAYS - daysSinceStart);
  const overdueBy = overdue ? (daysSinceStart - DEADLINE_DAYS) : 0;
  // Bar fills toward 0 as time runs out: full at start (7 days left),
  // empty at the deadline. Inverse of "consumed".
  const pctRemaining = Math.round((daysLeft / DEADLINE_DAYS) * 100);

  return { kind, daysSinceStart, daysLeft, overdue, overdueBy, pctRemaining };
}
