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
import { useState } from 'react';
import { IconEdit } from '../../icons.jsx';
import { getUser } from '../../../auth';
import ChangeCpModal from './ChangeCpModal.jsx';

export default function PeopleSection({ submission, canAct, onChanged, onOpenCpHistory, embedded }) {
  const [changingCp, setChangingCp] = useState(false);
  if (!submission) return null;
  const s = submission;
  // Admin-only, matching the endpoint's @require_admin_role. Reassigning a
  // listing changes who it's attributed to, so it isn't an RM/manager action.
  const isAdmin = getUser()?.role === 'admin';
  const body = (
      <div className="field-grid-2">
        <div className="field-row">
          <div className="field-lbl">Channel partner</div>
          <div className="field-val field-val-editable">
            {isAdmin && (
              <button
                type="button"
                className="field-edit-btn"
                onClick={() => setChangingCp(true)}
                title="Change channel partner"
                aria-label="Change channel partner"
              >
                <IconEdit size={14} />
              </button>
            )}
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
                <IconEdit size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />Submitted by <strong>{s.submitted_by_name}</strong> on behalf of <strong>{s.cp_name}</strong>
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

  const modal = changingCp && (
    <ChangeCpModal submission={s} onClose={() => setChangingCp(false)} onChanged={onChanged} />
  );

  if (embedded) return <>{body}{modal}</>;
  return (
    <div className="card-block">
      <h3>People</h3>
      {body}
      {modal}
    </div>
  );
}
