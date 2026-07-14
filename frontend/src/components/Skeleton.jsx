/**
 * Shimmering skeleton placeholder. Replaces "Loading…" text.
 * Usage: <Skeleton height={40} /> or <Skeleton width="60%" height={16} />
 *
 * Ported from CP verbatim (leaf dependency copied per task-1 brief step 1).
 * NOT yet wired into any submissions/detail section — available for
 * Task 3/4 board/table loading states. Its classnames (.skeleton-shimmer,
 * .unit-card, .dash-stat) are CP-specific and not yet defined in Direct's
 * styles.css; add matching CSS (or swap classnames) when wiring this in.
 */
export default function Skeleton({ width = '100%', height = 14, radius = 6, style = {} }) {
  return (
    <div
      className="skeleton-shimmer"
      style={{ width, height, borderRadius: radius, ...style }}
    />
  );
}

export function UnitCardSkeleton() {
  return (
    <div className="unit-card">
      <div className="unit-card-body" style={{ display: 'flex', gap: 14 }}>
        <Skeleton width={72} height={72} radius={8} style={{ flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <Skeleton width="70%" height={18} style={{ marginBottom: 8 }} />
          <Skeleton width="90%" height={12} style={{ marginBottom: 10 }} />
          <Skeleton width="40%" height={20} />
        </div>
      </div>
    </div>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="dash-stat">
      <Skeleton width={40} height={28} style={{ margin: '0 auto 6px' }} />
      <Skeleton width={60} height={11} style={{ margin: '0 auto' }} />
    </div>
  );
}
