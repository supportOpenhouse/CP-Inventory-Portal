/**
 * Change channel partner — admin-only reassignment of a submission to a
 * different CP. Opened from the pen icon in PeopleSection.
 *
 * Type-ahead against /api/admin/cps rather than a dropdown preloaded with
 * every CP: there are ~7,000 of them, so a full list would be a multi-hundred-
 * KB payload and an unusable scroll. The server already searches name, phone
 * and CP code, and returns only active, non-admin CPs — the same set the
 * backend accepts as a target.
 *
 * Props:
 *   submission — the row being edited (needs id, public_id, society_name,
 *                cp_id, cp_name, cp_code)
 *   onClose    — () => void
 *   onChanged  — (updatedSubmission) => void, after a successful save
 */
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../../api';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { useModalClose } from '../../../hooks/useModalClose';
import { IconClose, IconSearch, IconCheck } from '../../icons.jsx';

const MIN_QUERY = 2; // the endpoint returns nothing below this

export default function ChangeCpModal({ submission: s, onClose, onChanged }) {
  const [query, setQuery] = useState('');
  const q = useDebouncedValue(query.trim(), 300);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const { closing, close } = useModalClose(onClose, { enabled: true, disabled: saving });

  useEffect(() => {
    if (q.length < MIN_QUERY) { setResults([]); setSearching(false); return undefined; }
    // `alive` drops a slow response that lands after the user has kept typing,
    // so an older query's results can never overwrite a newer one's.
    let alive = true;
    setSearching(true);
    api.adminCpSearch(q, 20)
      .then((d) => { if (alive) setResults(d?.results || []); })
      .catch((e) => { if (alive) { setResults([]); setError(e instanceof ApiError ? e.message : 'Search failed'); } })
      .finally(() => { if (alive) setSearching(false); });
    return () => { alive = false; };
  }, [q]);

  const isCurrent = picked && picked.id === s.cp_id;

  const save = async () => {
    if (!picked || isCurrent) return;
    setError('');
    setSaving(true);
    try {
      const res = await api.adminChangeSubmissionCp(s.id, picked.id);
      // The endpoint returns the new CP's display fields, so the card and the
      // table row can update in place without a refetch.
      onChanged?.({
        ...s,
        cp_id: res.cp_id, cp_name: res.cp_name, cp_code: res.cp_code, cp_phone: res.cp_phone,
      });
      // onClose directly, NOT close(): close() is guarded by `disabled: saving`
      // and `saving` is still true here, so it would silently no-op and leave
      // the modal open. Same pattern as submitCancel in ScheduleVisitSection.
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not change the CP');
      setSaving(false);
    }
  };

  return (
    <div className={`modal-backdrop${closing ? ' is-closing-scrim' : ''}`} onClick={close}>
      <div className={`modal cpx-modal${closing ? ' is-closing-panel' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head-row">
          <h3 style={{ marginBottom: 0 }}>Change channel partner</h3>
          <button type="button" className="modal-close" onClick={close} aria-label="Close"><IconClose size={15} /></button>
        </div>
        <div className="modal-sub">{s.public_id} · {s.society_name}</div>

        <div className="cpx-current">
          <span className="muted">Currently</span>
          <strong>{s.cp_name}</strong>
          <span className="muted">{s.cp_code}</span>
        </div>

        {error && <div className="modal-error">{error}</div>}

        <div className="cpx-search">
          <IconSearch size={15} className="cpx-search-ic" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => { setQuery(e.target.value); setError(''); }}
            placeholder="Search by name, phone or CP code"
            aria-label="Search channel partners"
          />
        </div>

        <div className="cpx-results" role="listbox" aria-label="Matching channel partners">
          {q.length < MIN_QUERY ? (
            <div className="cpx-empty muted">Type at least {MIN_QUERY} characters to search.</div>
          ) : searching && results.length === 0 ? (
            <div className="cpx-empty muted">Searching…</div>
          ) : results.length === 0 ? (
            <div className="cpx-empty muted">No active CP matches “{q}”.</div>
          ) : results.map((cp) => {
            const sel = picked?.id === cp.id;
            const current = cp.id === s.cp_id;
            return (
              <button
                key={cp.id}
                type="button"
                role="option"
                aria-selected={sel}
                className={`cpx-row${sel ? ' is-sel' : ''}`}
                onClick={() => setPicked(cp)}
              >
                <div className="cpx-row-main">
                  <div className="cpx-name">
                    {cp.name}
                    {current && <span className="cpx-tag">current</span>}
                  </div>
                  <div className="cpx-meta muted">
                    {[cp.cp_code, cp.phone && `+91 ${cp.phone}`, cp.city].filter(Boolean).join(' · ')}
                  </div>
                </div>
                {sel && <IconCheck size={16} className="cpx-check" />}
              </button>
            );
          })}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={close} disabled={saving} style={{ flex: 1, justifyContent: 'center' }}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={save}
            disabled={!picked || isCurrent || saving}
            style={{ flex: 1, justifyContent: 'center' }}
          >
            {saving ? 'Saving…' : picked && !isCurrent ? `Assign to ${picked.name.split(' ')[0]}` : 'Assign'}
          </button>
        </div>
      </div>
    </div>
  );
}
