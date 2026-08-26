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
 *
 * Rows are clickable in two different ways:
 *   - source 'submissions' -> opens that submission's panel in-app (onOpenSubmission)
 *   - source 'inventory'   -> opens the listing in the Direct Inventory portal
 *                             in a new tab; `id` is the external oh_id.
 * 'properties' rows stay inert — there's no per-record page to send anyone to.
 */

import { formatBhk } from '../format';
import { useModalClose } from '../hooks/useModalClose';
import { IconClose, IconExternal } from './icons.jsx';

const SOURCE_LABELS = {
  inventory: 'External inventory',
  submissions: 'Other CP submissions',
  properties: 'Openhouse properties',
};

const SOURCE_ORDER = ['inventory', 'submissions', 'properties'];

// Sibling app that owns the external inventory records. Hardcoded rather than
// an env var: it's a fixed public URL, and adding VITE_* config would mean a
// Vercel setting to keep in sync for no gain.
const DIRECT_INVENTORY_URL = 'https://direct-inventory-portal.vercel.app';

// The oh_id lands in a path segment, so encode it — ids come from an external
// system and we don't control their character set.
const inventoryHref = (it) => (
  it.source === 'inventory' && it.id ? `${DIRECT_INVENTORY_URL}/${encodeURIComponent(it.id)}` : null
);

function unitLabel(it) {
  // "Tower 13 · Unit 502" / "Unit 502" / "—" when neither is present.
  const bits = [];
  if (it.tower) bits.push(`Tower ${it.tower}`);
  if (it.unit_no) bits.push(`Unit ${it.unit_no}`);
  return bits.length ? bits.join(' · ') : 'No tower/unit';
}

export default function MatchDetailsModal({ open, onClose, title = 'Matched with', items, onOpenSubmission }) {
  const { closing, close } = useModalClose(onClose, { enabled: open });
  if (!open) return null;

  const list = Array.isArray(items) ? items : [];
  const grouped = SOURCE_ORDER
    .map((src) => ({ src, rows: list.filter((it) => it.source === src) }))
    .filter((g) => g.rows.length > 0);

  return (
    <div className={`modal-backdrop${closing ? ' is-closing-scrim' : ''}`} onClick={close}>
      <div className={`modal${closing ? ' is-closing-panel' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head-row">
          <h3 style={{ marginBottom: 0 }}>{title}</h3>
          <button type="button" className="modal-close" onClick={close} aria-label="Close"><IconClose size={15} /></button>
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
                const href = inventoryHref(it);
                const internal = it.source === 'submissions' && it.ref_id != null && typeof onOpenSubmission === 'function';
                const clickable = !!href || internal;
                // External links get the brand accent so they read as "leaves
                // the app", distinct from the purple in-app submission rows.
                const accent = href ? 'var(--brand)' : 'var(--purple)';
                const tint = href ? 'var(--brand-softer)' : 'rgba(139, 92, 246, 0.08)';
                // A real anchor for the external case — that's what makes
                // ctrl/middle-click, "copy link address" and keyboard focus
                // work. window.open() would give up all three.
                const Row = href ? 'a' : 'div';
                return (
                  <Row
                    key={`${src}-${it.id || idx}`}
                    {...(href ? { href, target: '_blank', rel: 'noopener noreferrer' } : {})}
                    onClick={internal ? () => { close(); onOpenSubmission(it.ref_id); } : undefined}
                    title={href ? `Open ${it.id} in the Direct Inventory portal` : internal ? 'Open this listing' : undefined}
                    style={{
                      display: 'block',
                      textDecoration: 'none',
                      color: 'inherit',
                      border: `1px solid ${clickable ? accent : 'var(--border)'}`,
                      borderRadius: 'var(--r-sm)',
                      padding: '10px 12px',
                      marginBottom: 8,
                      background: clickable ? tint : 'var(--surface-2)',
                      cursor: clickable ? 'pointer' : 'default',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                        {it.society || '—'}
                        {clickable && <IconExternal size={12} style={{ color: accent, marginLeft: 5, verticalAlign: '-1px' }} />}
                      </div>
                      {it.match && (
                        <span
                          style={{
                            fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 8,
                            // 'fuzzy' is a full 5-field hit reached via a
                            // tower/unit near-miss — same strength as 'exact',
                            // so same red. Only 'partial' is amber.
                            background: it.match === 'partial' ? 'var(--amber-bg)' : 'var(--red-bg)',
                            color: it.match === 'partial' ? 'var(--amber-fg)' : 'var(--red-fg)',
                            whiteSpace: 'nowrap', height: 'fit-content',
                          }}
                          title={it.match === 'fuzzy'
                            ? 'Tower/unit matched as a near-miss (likely typo), area corroborates'
                            : undefined}
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
                  </Row>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
