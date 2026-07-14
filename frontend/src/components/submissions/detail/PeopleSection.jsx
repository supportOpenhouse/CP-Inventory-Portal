/**
 * People — channel partner (with a link to their submission history) and
 * seller contact details. Ported from CP DetailPanel.jsx ("People" block).
 * Read-only; not gated on `canAct` — CP shows this to every role, including
 * viewers.
 *
 * Extra prop beyond the standard {submission, canAct, onChanged}:
 *   onOpenCpHistory?: (cpId) => void — opens the CP's full submission
 *   history (same as CP's `onOpenCpHistory` DetailPanel prop).
 */
export default function PeopleSection({ submission, canAct, onChanged, onOpenCpHistory, embedded }) {
  if (!submission) return null;
  const s = submission;
  const body = (
      <div className="field-grid-2">
        <div className="field-row">
          <div className="field-lbl">Channel partner</div>
          <div className="field-val">
            <button
              type="button"
              className="btn-link"
              style={{ padding: 0 }}
              onClick={() => onOpenCpHistory?.(s.cp_id)}
              title="See all submissions by this CP"
            >
              {s.cp_name}
            </button>
            <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
              {s.cp_code} · +91 {s.cp_phone}
            </div>
            {s.submitted_by_name && (
              <div style={{
                marginTop: 6, padding: '4px 8px',
                background: 'var(--brand-soft)', color: 'var(--brand-strong)',
                border: '1px solid var(--brand-ring)', borderRadius: 4,
                fontSize: 12, lineHeight: 1.3,
              }}>
                ✏ Submitted by <strong>{s.submitted_by_name}</strong> on behalf of <strong>{s.cp_name}</strong>
              </div>
            )}
          </div>
        </div>
        <div className="field-row">
          <div className="field-lbl">Seller</div>
          <div className="field-val">
            {s.seller_name || <span className="muted" style={{ fontStyle: 'italic' }}>Not provided</span>}
            {s.seller_phone && (
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                +91 {s.seller_phone}
              </div>
            )}
          </div>
        </div>
      </div>
  );

  if (embedded) return body;
  return (
    <div className="card-block">
      <h3>People</h3>
      {body}
    </div>
  );
}
