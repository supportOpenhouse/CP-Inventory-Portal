import { useMemo, useState } from 'react';

import { formatPrice, stageMeta, timeAgo } from '../../format';

// How to extract the sort key for each column.
// Values that don't exist sort to the end for ASC and start for DESC
// (via the NUL char trick for strings / +/-Infinity for numbers).
const SORT_ACCESSORS = {
  listing_id: (s) => (s.public_id || '').toString(),
  society:    (s) => (s.society_name || '').toString().toLowerCase(),
  city:       (s) => (s.city || '').toString().toLowerCase(),
  unit:       (s) => {
    const t = (s.tower || '').toString();
    const u = (s.unit_no || '').toString();
    return `${t}-${u}`.toLowerCase();
  },
  config:     (s) => {
    // Sort first by BHK number, then sqft
    const bhkNum = parseInt(((s.bhk || '').match(/\d+/) || [0])[0], 10) || 0;
    const sqft = parseInt(s.sqft, 10) || 0;
    return bhkNum * 100000 + sqft;
  },
  asking:     (s) => parseInt(s.asking_price, 10) || 0,
  cp:         (s) => (s.cp_name || '').toString().toLowerCase(),
  status:     (s) => (s.status || '').toString(),
  submitted:  (s) => {
    const t = s.submitted_at ? new Date(s.submitted_at).getTime() : 0;
    return isNaN(t) ? 0 : t;
  },
};

function SortIcon({ state }) {
  // state: 'asc' | 'desc' | null
  const active = !!state;
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        marginLeft: 4,
        fontSize: 10,
        color: active ? '#222' : '#BBB',
        lineHeight: 1,
      }}
    >
      {state === 'asc' ? '▲' : state === 'desc' ? '▼' : '↕'}
    </span>
  );
}

export default function TableView({
  submissions, loading, selectedId, onSelect,
  bulkMode = false, selectedIds = new Set(), onToggleSelect, onToggleAll,
  isAdmin = false,  // Unused in rendering (backend filters Unapproved for RMs),
                    // accepted for API consistency with BoardView.
}) {
  // { key, dir }  dir = 'asc' | 'desc'. Default: newest submissions first.
  const [sort, setSort] = useState({ key: 'submitted', dir: 'desc' });

  const toggleSort = (key) => {
    setSort((s) => {
      if (s.key !== key) return { key, dir: 'asc' };
      if (s.dir === 'asc') return { key, dir: 'desc' };
      return { key: 'submitted', dir: 'desc' };  // third click = reset to default
    });
  };

  const sorted = useMemo(() => {
    const acc = SORT_ACCESSORS[sort.key] || SORT_ACCESSORS.submitted;
    const copy = [...submissions];
    copy.sort((a, b) => {
      const av = acc(a);
      const bv = acc(b);
      let cmp = 0;
      if (typeof av === 'number' && typeof bv === 'number') {
        cmp = av - bv;
      } else {
        cmp = String(av).localeCompare(String(bv));
      }
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [submissions, sort]);

  if (loading) {
    return <div className="admin-table-loading">Loading submissions…</div>;
  }
  if (submissions.length === 0) {
    return <div className="admin-table-loading">No submissions match.</div>;
  }

  const allChecked = bulkMode && submissions.length > 0 && submissions.every((s) => selectedIds.has(s.id));
  const someChecked = bulkMode && submissions.some((s) => selectedIds.has(s.id));

  // Reusable sortable header
  const TH = ({ sortKey, children, style }) => {
    const state = sort.key === sortKey ? sort.dir : null;
    return (
      <th
        onClick={() => toggleSort(sortKey)}
        style={{ cursor: 'pointer', userSelect: 'none', ...style }}
        title={`Sort by ${typeof children === 'string' ? children : sortKey}`}
      >
        {children}
        <SortIcon state={state} />
      </th>
    );
  };

  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            {bulkMode && (
              <th style={{ width: 34 }}>
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={(el) => { if (el) el.indeterminate = !allChecked && someChecked; }}
                  onChange={() => onToggleAll?.()}
                />
              </th>
            )}
            <TH sortKey="listing_id">Listing ID</TH>
            <TH sortKey="society">Society</TH>
            <TH sortKey="city">City</TH>
            <TH sortKey="unit">Unit</TH>
            <TH sortKey="config">Config</TH>
            <TH sortKey="asking">Asking</TH>
            <TH sortKey="cp">CP</TH>
            <TH sortKey="status">Status</TH>
            <TH sortKey="submitted">Submitted</TH>
          </tr>
        </thead>
        <tbody>
          {sorted.map((s) => {
            const stage = stageMeta(s.status);
            const isWeakMatch = s.weak_match === true;
            const isRejected = s.status === 'Rejected';
            const isChecked = selectedIds.has(s.id);
            const isCollatedPartial = s.status === 'Unapproved' && s.collated_match === true;
            const handleClick = () => {
              if (bulkMode) onToggleSelect?.(s.id);
              else onSelect(s.id);
            };
            return (
              <tr
                key={s.id}
                className={`${selectedId === s.id ? 'active' : ''} ${isWeakMatch ? 'weak-match' : ''} ${isChecked ? 'bulk-selected' : ''}`}
                onClick={handleClick}
                title={isWeakMatch ? 'Weak society match during import — verify' : undefined}
              >
                {bulkMode && (
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => onToggleSelect?.(s.id)}
                    />
                  </td>
                )}
                <td style={{ fontFamily: 'monospace', fontSize: 12, color: '#555', fontWeight: 600 }}>
                  {s.public_id || '—'}
                </td>
                <td style={{ fontWeight: 600 }}>
                  {isWeakMatch && <span style={{ color: '#DC2626', marginRight: 6 }}>⚠</span>}
                  {s.society_name}
                </td>
                <td style={{ color: '#888' }}>{s.city || '—'}</td>
                <td>
                  {[s.tower && s.unit_no ? `${s.tower}-${s.unit_no}` : (s.tower || s.unit_no || '—'), s.floor && `F${s.floor}`]
                    .filter(Boolean).join(' · ')}
                </td>
                <td>{[s.bhk, s.sqft ? `${s.sqft} sqft` : null].filter(Boolean).join(' · ') || '—'}</td>
                <td style={{ fontWeight: 600, color: '#FF6B2B' }}>{formatPrice(s.asking_price)}</td>
                <td>
                  {s.cp_name}
                  <div style={{ fontSize: 11, color: '#999' }}>{s.cp_code}</div>
                </td>
                <td>
                  <span
                    className={`status-pill ${isRejected ? 'is-rejected' : ''}`}
                    style={{ background: stage.bg, color: stage.color }}
                  >
                    {s.status}
                  </span>
                  {isCollatedPartial && (
                    <span
                      title="Partial match from collated_data — society + BHK + floor matched an external-scraper listing; tower/unit couldn't be verified"
                      style={{
                        marginLeft: 6,
                        padding: '2px 8px',
                        borderRadius: 10,
                        fontSize: 11,
                        fontWeight: 600,
                        background: '#FEF3C7',
                        color: '#92400E',
                        border: '1px solid #FCD34D',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Collated match
                    </span>
                  )}
                </td>
                <td style={{ color: '#999' }}>{timeAgo(s.submitted_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
