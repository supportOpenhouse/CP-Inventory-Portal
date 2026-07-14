/**
 * Inline row-expand detail (Direct pattern) — the panel a table row reveals
 * when clicked. Lazy-fetches the full submission (+events) on mount, shows
 * a skeleton until it lands, then renders the shared section composition.
 *
 * `onChanged` is optional and — when supplied by TableView — used to patch
 * the collapsed row's own summary fields too (status pill, price, etc.) so
 * the row doesn't go stale relative to what was just edited inline.
 */
import { useEffect, useState } from 'react';
import { api } from '../../api';
import SubmissionSections from './SubmissionSections.jsx';
import SectionsSkeleton from './SectionsSkeleton.jsx';
import { detailStore } from './submissionDetailStore.js';
import { showToast } from '../Toast.jsx';

export default function ExpandPanel({ id, canAct, onChanged, onOpenSubmission }) {
  // Seed from the persisted store so a reopen shows the last state instantly —
  // no skeleton, no re-fetch. Only the first-ever open of a row hits the network.
  const [data, setData] = useState(() => detailStore.get(id) || null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (detailStore.has(id)) { setData(detailStore.get(id)); setError(null); return undefined; }
    let alive = true;
    setData(null);
    setError(null);
    api.adminGetSubmission(id)
      .then((res) => {
        const merged = { ...res.submission, events: res.events };
        detailStore.set(id, merged);
        if (alive) setData(merged);
      })
      .catch((err) => { if (alive) setError(err.message || 'Failed to load'); });
    return () => { alive = false; };
  }, [id]);

  // A section save bubbled up its confirmed row: update this panel, persist it
  // to the store (so reopen reflects it without a DB round-trip), tell the host
  // (TableView's per-row override) so the collapsed row stays in sync, and toast
  // to confirm the save instead of re-loading to check.
  const handleChanged = (updated) => {
    detailStore.set(id, updated);
    setData(updated);
    onChanged?.(updated);
    showToast('Changes saved');
  };

  if (error) {
    return (
      <div className="expand-inner">
        <div className="card-block" style={{ color: 'var(--red-fg)' }}>{error}</div>
      </div>
    );
  }

  if (!data) return <SectionsSkeleton columns />;

  return <SubmissionSections s={data} canAct={canAct} onChanged={handleChanged} onOpenSubmission={onOpenSubmission} columns />;
}
