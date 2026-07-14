/**
 * Raise a ticket. Two modes:
 *   - On a submission — debounced search over submissions, pick one; the
 *     assigned RM is resolved from the row (`listing_rm_name || assigned_rm_name`).
 *   - Direct to RM — no submission; pick the RM the ticket is for.
 *
 * Ported from Direct_Inventory's `components/CreateTicketModal.jsx`, adapted
 * to this app's submission-linked ticket shape (`submission_id`/`public_id`/
 * `society_name` instead of Direct's `oh_id`/inventory search) and its split
 * cp/rm staff identity (a manager's own id lives in `rms`, as `user.rm_id`).
 *
 * Direct-mode RM list: `adminListRms()` returns every row of the `rms` table
 * (plain RMs, managers, and city viewers together), because that endpoint
 * also feeds the CP<->RM assignment dropdown, where picking a manager is
 * valid. A ticket's assignee must be a plain RM (the backend's create_ticket
 * rejects `is_manager`/`is_viewer` rows with "invalid RM"), so this modal
 * excludes both up front — sparing the user a guaranteed-to-fail submit.
 * Managers are additionally scoped to their own team (`manager_id ===
 * user.rm_id`); the backend re-checks that scope too.
 *
 * Admin/manager only — enforced by the caller (CreateTicketButton is only
 * rendered for those roles), not re-checked in here.
 *
 * Props: { onClose, onCreated? }
 */
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { IconClose } from '../icons.jsx';

export default function CreateTicketModal({ onClose, onCreated }) {
  const { user } = useAuth();
  const isManager = user?.role === 'manager';

  const [mode, setMode] = useState('submission'); // 'submission' | 'direct'
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Submission-search mode.
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState(null);

  // Direct-to-RM mode.
  const [rms, setRms] = useState([]);
  const [loadingRms, setLoadingRms] = useState(true);
  const [rmId, setRmId] = useState('');

  // Load RMs once, regardless of which mode is active first.
  useEffect(() => {
    let alive = true;
    api.adminListRms()
      .then((r) => { if (alive) setRms(r?.rms || []); })
      .catch(() => {})
      .finally(() => { if (alive) setLoadingRms(false); });
    return () => { alive = false; };
  }, []);

  // Plain RMs only (see file-header note), then a manager's own team.
  const directRms = rms.filter((r) => {
    if (r.is_manager || r.is_viewer) return false;
    if (isManager && r.manager_id !== user?.rm_id) return false;
    return true;
  });

  // Debounced (250ms) submission search — skipped once a submission is picked.
  useEffect(() => {
    if (mode !== 'submission' || picked) return undefined;
    const term = q.trim();
    if (!term) { setResults([]); setSearching(false); return undefined; }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.adminListSubmissions({ search: term, limit: 10 });
        setResults(r?.submissions || []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, mode, picked]);

  const pickedRmName = picked ? (picked.listing_rm_name || picked.assigned_rm_name || '') : '';

  const canSubmit = !submitting && !!title.trim() && (
    mode === 'submission' ? !!(picked && pickedRmName) : !!rmId
  );

  function switchMode(next) {
    if (next === mode || submitting) return;
    setMode(next);
    setError('');
  }

  async function submit() {
    if (!canSubmit) return;
    setError('');
    setSubmitting(true);
    try {
      const payload = { title: title.trim(), summary: summary.trim() };
      if (mode === 'submission') payload.submission_id = picked.id;
      else payload.rm_id = Number(rmId);
      await api.ticketCreate(payload);
      window.dispatchEvent(new Event('tickets:changed'));
      onCreated?.();
      onClose();
    } catch (e) {
      setError(e?.data?.error || e.message || 'Failed to create ticket');
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !submitting) onClose?.(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  return (
    <div className="modal-backdrop" onClick={() => { if (!submitting) onClose?.(); }}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head-row">
          <h3 style={{ marginBottom: 0 }}>New Ticket</h3>
          <button type="button" className="modal-close" onClick={onClose} disabled={submitting} aria-label="Close"><IconClose /></button>
        </div>

        <div className="tk-mode-toggle">
          <button type="button" className={mode === 'submission' ? 'on' : ''} aria-pressed={mode === 'submission'} onClick={() => switchMode('submission')} disabled={submitting}>
            On a submission
          </button>
          <button type="button" className={mode === 'direct' ? 'on' : ''} aria-pressed={mode === 'direct'} onClick={() => switchMode('direct')} disabled={submitting}>
            Direct to RM
          </button>
        </div>

        {mode === 'submission' ? (
          <div style={{ marginTop: 12 }}>
            <label>Submission</label>
            {picked ? (
              <div className="tk-picked">
                <div>
                  <strong>{picked.society_name || '—'}</strong>
                  <span className="muted"> · {picked.public_id || '—'}</span>
                </div>
                <div className="tk-picked-rm">
                  {pickedRmName
                    ? <>RM: <strong>{pickedRmName}</strong></>
                    : <span className="tk-warn">No RM assigned to this submission — pick another one.</span>}
                </div>
                <button type="button" className="btn-link" onClick={() => { setPicked(null); setResults([]); }} disabled={submitting}>
                  Change
                </button>
              </div>
            ) : (
              <>
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search society, public ID, CP, seller…"
                  autoFocus
                  disabled={submitting}
                />
                {searching && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Searching…</div>}
                {!searching && q.trim() && results.length === 0 && (
                  <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>No matches.</div>
                )}
                {results.length > 0 && (
                  <ul className="tk-search-list">
                    {results.map((s) => (
                      <li key={s.id}>
                        <button type="button" className="tk-search-row" onClick={() => setPicked(s)}>
                          <span className="tk-sr-soc">{s.society_name || '—'}</span>
                          <span className="tk-sr-meta">
                            {s.public_id || '—'} · RM: {(s.listing_rm_name || s.assigned_rm_name) || 'Unassigned'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        ) : (
          <div style={{ marginTop: 12 }}>
            <label>RM</label>
            <select value={rmId} onChange={(e) => setRmId(e.target.value)} disabled={submitting || loadingRms}>
              <option value="">— choose an RM —</option>
              {directRms.map((r) => (
                <option key={r.id} value={r.id}>{r.name}{r.city ? ` · ${r.city}` : ''}</option>
              ))}
            </select>
            {!loadingRms && directRms.length === 0 && (
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                {isManager ? 'No RMs on your team.' : 'No RMs available.'}
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          <label>Title <span className="req">*</span></label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short summary of the issue" disabled={submitting} />
        </div>
        <div style={{ marginTop: 14 }}>
          <label>Details</label>
          <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} placeholder="Add any context for the RM (optional)" disabled={submitting} />
        </div>

        {error && <div className="modal-error">{error}</div>}

        <div className="modal-actions">
          <span style={{ flex: 1 }} />
          <button type="button" className="btn-ghost" onClick={onClose} disabled={submitting}>Cancel</button>
          <button type="button" className="btn-primary" onClick={submit} disabled={!canSubmit}>
            {submitting ? 'Creating…' : 'Create Ticket'}
          </button>
        </div>
      </div>
    </div>
  );
}
