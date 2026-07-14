/**
 * Shows the records a submission matched against (the data behind the
 * Perfect / Collated / Submissions badges). Opened by clicking a badge.
 * Ported from CP verbatim (same props/behavior); retokened to Direct's
 * .modal-* classes and design tokens instead of CP's inline-styled markup.
 *
 * Props:
 *   open    — boolean; controls visibility
 *   onClose — fires on backdrop click / close button
 *   title   — heading text
 *   items   — the submission's `match_details` array. Each item:
 *             { source, match, id, ref_id?, society, tower, unit_no, floor, bhk, area }
 *   onOpenSubmission — optional (id) => void. When a match came from another
 *             CP's submission (source==='submissions' with a numeric ref_id),
 *             the row becomes clickable and calls this to open that submission's
 *             side panel.
 */

import { formatBhk } from '../format';

const SOURCE_LABELS = {
  inventory: 'External inventory',
  submissions: 'Other CP submissions',
  properties: 'Openhouse properties',
};

const SOURCE_ORDER = ['inventory', 'submissions', 'properties'];

function unitLabel(it) {
  // "Tower 13 · Unit 502" / "Unit 502" / "—" when neither is present.
  const bits = [];
  if (it.tower) bits.push(`Tower ${it.tower}`);
  if (it.unit_no) bits.push(`Unit ${it.unit_no}`);
  return bits.length ? bits.join(' · ') : 'No tower/unit';
}

export default function MatchDetailsModal({ open, onClose, title = 'Matched with', items, onOpenSubmission }) {
  if (!open) return null;

  const list = Array.isArray(items) ? items : [];
  const grouped = SOURCE_ORDER
    .map((src) => ({ src, rows: list.filter((it) => it.source === src) }))
    .filter((g) => g.rows.length > 0);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head-row">
          <h3 style={{ marginBottom: 0 }}>{title}</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        {list.length === 0 ? (
          <div className="muted" style={{ fontSize: 14, lineHeight: 1.5, marginTop: 8 }}>
            No stored match details for this listing. Older rows are filled in by
            the one-time backfill — run it to populate historical matches.
          </div>
        ) : (
          grouped.map(({ src, rows }) => (
            <div key={src} style={{ marginTop: 16 }}>
              <div className="muted" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 8 }}>
                {SOURCE_LABELS[src] || src} ({rows.length})
              </div>
              {rows.map((it, idx) => {
                const clickable = it.source === 'submissions' && it.ref_id != null && typeof onOpenSubmission === 'function';
                return (
                  <div
                    key={`${src}-${it.id || idx}`}
                    onClick={clickable ? () => { onClose?.(); onOpenSubmission(it.ref_id); } : undefined}
                    title={clickable ? 'Open this listing' : undefined}
                    style={{
                      border: `1px solid ${clickable ? 'var(--purple)' : 'var(--border)'}`,
                      borderRadius: 'var(--r-sm)',
                      padding: '10px 12px',
                      marginBottom: 8,
                      background: clickable ? 'rgba(139, 92, 246, 0.08)' : 'var(--surface-2)',
                      cursor: clickable ? 'pointer' : 'default',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                        {it.society || '—'}
                        {clickable && <span style={{ color: 'var(--purple)', fontWeight: 600 }}> ↗</span>}
                      </div>
                      {it.match && (
                        <span
                          style={{
                            fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 8,
                            background: it.match === 'exact' ? 'var(--red-bg)' : 'var(--amber-bg)',
                            color: it.match === 'exact' ? 'var(--red-fg)' : 'var(--amber-fg)',
                            whiteSpace: 'nowrap', height: 'fit-content',
                          }}
                        >
                          {it.match}
                        </span>
                      )}
                    </div>
                    <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                      {unitLabel(it)} · Floor {it.floor || '—'} · {it.bhk ? formatBhk(it.bhk) : '— BHK'}
                      {it.area ? ` · ${it.area} sqft` : ''}
                    </div>
                    {it.id && (
                      <div className="muted" style={{ fontSize: 12, marginTop: 2, fontFamily: 'monospace' }}>
                        {it.id}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
