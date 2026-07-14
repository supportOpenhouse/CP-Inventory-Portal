/**
 * Loading placeholder for the expanded submission detail. Two shapes:
 *  - `columns` (table row-expand): mirrors the Direct-style column layout —
 *    real column titles up top, shimmer bars where the data will land.
 *  - default / `stacked`: shimmer cards (masonry / popup).
 */
function SkelBars({ rows }) {
  return Array.from({ length: rows }).map((_, i) => (
    <div key={i} className="inv-skel" style={{ width: `${88 - i * 12}%`, marginBottom: 9 }} />
  ));
}

function SkelCard({ lines }) {
  return (
    <div className="card-block">
      <div className="inv-skel" style={{ width: '42%', height: 15, marginBottom: 16 }} />
      <SkelBars rows={lines} />
    </div>
  );
}

// Column titles mirror the real expanded columns (same order: Status, Notes,
// Chat, Tickets, Unit details, Pricing, Activity, Attachments). Counter Offer
// folds into Pricing and is usually empty, so it's omitted from the placeholder.
const SKEL_COLS = [
  { titles: ['Status'], rows: 2 },
  { titles: ['Notes'], rows: 3 },
  { titles: ['Chat'], rows: 5, cls: 'expand-col-chat' },
  { titles: ['Tickets'], rows: 2 },
  { titles: ['Unit details'], rows: 6 },
  { titles: ['Pricing', 'People'], rows: 3 },
  { titles: ['Assigned RM', 'Activity'], rows: 3 },
  { titles: ['Attachments'], rows: 2 },
];

export default function SectionsSkeleton({ stacked, columns }) {
  if (columns) {
    return (
      <div className="expand-scroll">
        <div className="expand-inner expand-cols">
          {SKEL_COLS.map((col, i) => (
            <div key={i} className={`expand-col${col.cls ? ` ${col.cls}` : ''}`}>
              {col.titles.map((t, ti) => (
                <div key={ti} className="card-block">
                  <h3>{t}</h3>
                  <SkelBars rows={col.rows} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Line counts roughly mirror the real sections so columns balance similarly.
  const shape = stacked ? [3, 4, 3, 3, 2] : [5, 3, 4, 3, 4, 2, 3, 3];
  return (
    <div className={`expand-inner${stacked ? ' expand-stack' : ''}`}>
      {shape.map((n, i) => <SkelCard key={i} lines={n} />)}
    </div>
  );
}
