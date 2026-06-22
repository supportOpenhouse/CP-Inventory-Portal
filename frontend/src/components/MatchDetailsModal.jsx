/**
 * Shows the records a submission matched against (the data behind the
 * Perfect / Collated / Submissions badges). Opened by clicking a badge.
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
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(15,23,42,0.55)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 16,
          padding: '20px 22px',
          maxWidth: 520,
          width: '100%',
          maxHeight: '80vh',
          overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{
            fontFamily: 'Fraunces, serif', fontSize: 20, fontWeight: 700, color: 'var(--oh-charcoal)',
          }}>
            {title}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              border: 'none', background: 'transparent', fontSize: 22,
              lineHeight: 1, cursor: 'pointer', color: 'var(--oh-gray)',
            }}
          >
            ×
          </button>
        </div>

        {list.length === 0 ? (
          <div style={{ fontSize: 14, color: 'var(--oh-gray)', lineHeight: 1.5, marginTop: 8 }}>
            No stored match details for this listing. Older rows are filled in by
            the one-time backfill — run it to populate historical matches.
          </div>
        ) : (
          grouped.map(({ src, rows }) => (
            <div key={src} style={{ marginTop: 16 }}>
              <div style={{
                fontSize: 11, fontWeight: 700, letterSpacing: 0.4,
                textTransform: 'uppercase', color: 'var(--oh-gray)', marginBottom: 8,
              }}>
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
                    border: `1px solid ${clickable ? '#C4B5FD' : 'var(--oh-border)'}`,
                    borderRadius: 10,
                    padding: '10px 12px',
                    marginBottom: 8,
                    background: clickable ? '#f5f3ff' : '#fafafa',
                    cursor: clickable ? 'pointer' : 'default',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--oh-charcoal)' }}>
                      {it.society || '—'}
                      {clickable && <span style={{ color: '#7C3AED', fontWeight: 600 }}> ↗</span>}
                    </div>
                    {it.match && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 8,
                        background: it.match === 'exact' ? '#FEE2E2' : '#FEF3C7',
                        color: it.match === 'exact' ? '#991B1B' : '#92400E',
                        whiteSpace: 'nowrap', height: 'fit-content',
                      }}>
                        {it.match}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--oh-gray)', marginTop: 4 }}>
                    {unitLabel(it)} · Floor {it.floor || '—'} · {it.bhk ? formatBhk(it.bhk) : '— BHK'}
                    {it.area ? ` · ${it.area} sqft` : ''}
                  </div>
                  {it.id && (
                    <div style={{ fontSize: 12, color: 'var(--oh-gray)', marginTop: 2, fontFamily: 'monospace' }}>
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
