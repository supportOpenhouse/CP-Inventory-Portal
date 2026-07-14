/**
 * Unit details — read-only field grid with an inline "✏ Edit" trigger in the
 * card header (admin only). Ported from CP DetailPanel.jsx: the "Unit details"
 * block + the header Edit button + EDITABLE_FIELDS / startEdit / saveEdit
 * (previously split into a separate EditFieldsSection — merged so the button
 * sits next to the title like CP). Editing covers the same cross-section
 * fields CP's editor did (pricing / seller / drive links / comments).
 *
 * Save is admin-gated server-side (PATCH /api/admin/submissions/<id> is
 * @require_admin_role), so the Edit button only shows to admins.
 */
import { useState } from 'react';
import { api } from '../../../api';
import { getUser } from '../../../auth';
import { formatBhk } from '../../../format';

const EDITABLE_FIELDS = [
  { key: 'tower',               label: 'Tower',            type: 'text'   },
  { key: 'unit_no',              label: 'Unit No',          type: 'text'   },
  { key: 'floor',                label: 'Floor',            type: 'text'   },
  { key: 'sqft',                 label: 'Area (sqft)',      type: 'number' },
  { key: 'bhk',                  label: 'BHK',              type: 'number' },
  { key: 'occupancy_status',     label: 'Occupancy',        type: 'text'   },
  { key: 'asking_price',         label: 'Asking price (₹)', type: 'number' },
  { key: 'seller_name',          label: 'Seller name',      type: 'text'   },
  { key: 'seller_phone',         label: 'Seller phone',     type: 'text'   },
  { key: 'drive_links',          label: 'Google Drive URLs (one per line)', type: 'textarea' },
  { key: 'additional_comments',  label: 'Additional comments', type: 'textarea' },
];

function Field({ label, value, optional = false }) {
  return (
    <div className="field-row">
      <div className="field-lbl">{label}</div>
      <div className="field-val">
        {value || (optional ? '—' : <span className="muted" style={{ fontStyle: 'italic' }}>Missing</span>)}
      </div>
    </div>
  );
}

export default function UnitDetailsSection({ submission, onChanged }) {
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [busy, setBusy] = useState(false);

  if (!submission) return null;
  const s = submission;
  const isAdmin = getUser()?.role === 'admin';

  const startEdit = () => {
    const form = {};
    EDITABLE_FIELDS.forEach(({ key }) => { form[key] = s[key] ?? ''; });
    setEditForm(form);
    setEditMode(true);
  };

  const cancelEdit = () => {
    setEditMode(false);
    setEditForm({});
  };

  const saveEdit = async () => {
    if (busy) return;
    // Build payload of only changed fields.
    const payload = {};
    EDITABLE_FIELDS.forEach(({ key, type }) => {
      const oldVal = s[key];
      const normalizedOld = oldVal === null || oldVal === undefined ? '' : String(oldVal);
      const newVal = editForm[key];
      const normalizedNew = newVal === null || newVal === undefined ? '' : String(newVal);
      if (normalizedOld !== normalizedNew) {
        if (type === 'number' && newVal !== '') payload[key] = parseInt(newVal, 10);
        else payload[key] = newVal === '' ? null : newVal;
      }
    });

    if (Object.keys(payload).length === 0) { setEditMode(false); return; }

    setBusy(true);
    try {
      await api.adminUpdateSubmission(s.id, payload);
      setEditMode(false);
      const fresh = await api.adminGetSubmission(s.id);
      onChanged?.({ ...fresh.submission, events: fresh.events });
    } catch (err) {
      alert(err.message || 'Failed to save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card-block">
      <div className="card-head">
        <h3>Unit details</h3>
        {isAdmin && (editMode
          ? <small className="muted" style={{ fontWeight: 400 }}>Society &amp; CP cannot be changed</small>
          : <button type="button" className="btn-soft" onClick={startEdit} disabled={busy}>✏ Edit</button>
        )}
      </div>

      {editMode ? (
        <>
          <div className="form-grid">
            {EDITABLE_FIELDS.map(({ key, label, type }) => (
              <div key={key} className={type === 'textarea' ? 'form-wide-2' : ''}>
                <label>{label}</label>
                {type === 'textarea' ? (
                  <textarea rows={3} value={editForm[key] ?? ''}
                    onChange={(e) => setEditForm({ ...editForm, [key]: e.target.value })} />
                ) : (
                  <input type={type} value={editForm[key] ?? ''}
                    onChange={(e) => setEditForm({ ...editForm, [key]: e.target.value })} />
                )}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button type="button" className="btn-primary" onClick={saveEdit} disabled={busy}>
              {busy ? 'Saving…' : '✓ Save changes'}
            </button>
            <button type="button" className="btn-ghost" onClick={cancelEdit} disabled={busy}>Cancel</button>
          </div>
        </>
      ) : (
        <div className="field-grid-2">
          <Field label="Tower" value={s.tower} />
          <Field label="Unit No" value={s.unit_no} />
          <Field label="BHK" value={formatBhk(s.bhk, false)} />
          <Field label="Area" value={s.sqft ? `${s.sqft} sqft` : null} />
          <Field label="Floor" value={s.floor} />
          <Field label="Occupancy" value={s.occupancy_status} />
        </div>
      )}
    </div>
  );
}
