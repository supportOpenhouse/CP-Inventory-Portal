import { timerFor } from '../timer';

/**
 * Renders one of three things on a submission card:
 *   - nothing, when no reminder timer is running
 *   - an "ageing strip" with a 7-day countdown bar (1..7 days left)
 *   - an "overdue" pill once daysSinceStart > 7
 *
 * Used on both the admin BoardView card and the CP Dashboard card, so
 * styling lives in styles.css under the .board-card-* aging classes.
 *
 * `placement` chooses how the strip is attached:
 *   - 'card-bottom' (default): the strip stretches edge-to-edge of the
 *     card (negative margins). Used on the admin board card whose
 *     parent has 14px / 16px padding.
 *   - 'inline': no negative margins. Used on the mobile CP card whose
 *     parent's padding/border layout doesn't tolerate negative pulls.
 */
export default function AgingStrip({ submission, placement = 'card-bottom' }) {
  const timer = timerFor(submission);
  if (!timer) return null;

  if (timer.overdue) {
    return (
      <span className="aging-overdue-pill">
        <span className="dot" />
        Overdue · {timer.overdueBy + 7} day{timer.overdueBy + 7 === 1 ? '' : 's'}
      </span>
    );
  }

  const stripClass = placement === 'inline'
    ? 'aging-strip aging-strip-inline'
    : 'aging-strip';

  return (
    <div className={stripClass}>
      <div className="aging-row">
        <span className="aging-label">
          <svg
            className="clock-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            width="12"
            height="12"
          >
            <circle cx="12" cy="12" r="9" />
            <polyline points="12 7 12 12 15.5 14" />
          </svg>
          {timer.kind === 'visit' ? 'Schedule visit' : 'Seller meeting'}
        </span>
        <span className="aging-days">
          <span className="num">{timer.daysLeft}</span> day{timer.daysLeft === 1 ? '' : 's'} left
        </span>
      </div>
      <div className="aging-bar-track">
        <div
          className="aging-bar-fill"
          style={{ width: `${timer.pctRemaining}%` }}
        />
      </div>
    </div>
  );
}
