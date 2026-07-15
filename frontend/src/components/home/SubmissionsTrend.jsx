/**
 * Home → Summary → submissions-per-day trend.
 *
 * Single series, plotted from `submitted_at` (intake date), so a day's value is
 * historical and never rewrites itself. Inline SVG — the app carries no charting
 * library and one line does not justify adding ~500 KB to a 2.4 MB bundle.
 *
 * Sizing: geometry is computed in real pixels from a ResizeObserver rather than
 * scaling a fixed viewBox. A scaled viewBox would stretch the 2px stroke, oval
 * the end dot, and blow up the tick text on wide cards.
 *
 * Colour: `var(--brand)` is only 2.77:1 on the light surface — below the 3:1 bar.
 * The axis ticks and the end label are therefore load-bearing, not decoration:
 * they are what keeps every value readable without relying on the line's colour.
 * Text wears text tokens, never the series colour.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { api } from '../../api';
import SegToggle from '../SegToggle.jsx';

const RANGE_OPTIONS = [{ value: 30, label: '30d' }, { value: 90, label: '90d' }];
const H = 168;                       // plot + x-axis band; the card must not scroll
const PAD = { t: 10, r: 14, b: 22, l: 34 };

function fmtDay(iso) {
  // iso is 'YYYY-MM-DD'; parsed as UTC midnight, which renders as the same
  // calendar day in IST (UTC+5:30).
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export default function SubmissionsTrend() {
  const [days, setDays] = useState(30);
  const [points, setPoints] = useState(null);   // null → never loaded yet
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState(null);     // index of the crosshair's point

  const wrapRef = useRef(null);
  const [w, setW] = useState(0);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    setFailed(false);
    api.adminSubmissionsByDate(days)
      .then((d) => { if (alive) setPoints(d?.points || []); })
      .catch(() => { if (alive) setFailed(true); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [days]);

  const onMove = useCallback((e) => {
    if (!points?.length || w <= 0) return;
    const box = e.currentTarget.getBoundingClientRect();
    const plotW = Math.max(1, w - PAD.l - PAD.r);
    const t = (e.clientX - box.left - PAD.l) / plotW;
    // Crosshair snaps to the nearest point: the reader aims at a date, never at
    // a 2px line.
    const i = Math.round(t * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  }, [points, w]);

  const head = (
    <div className="report-head">
      <h3>Submissions</h3>
      <span className="muted">per day · by submitted date</span>
      <SegToggle
        bare
        options={RANGE_OPTIONS}
        value={days}
        onChange={setDays}
        style={{ marginLeft: 'auto' }}
      />
    </div>
  );

  // First load only. On a range switch we keep the previous render at reduced
  // opacity instead — a skeleton there flashes and jumps the layout.
  if (points === null && busy) {
    return (
      <div className="report-card trend-card">
        {head}
        <span className="inv-skel" style={{ width: '100%', height: H, display: 'block' }} />
      </div>
    );
  }

  const total = (points || []).reduce((a, p) => a + p.count, 0);
  if (failed || !points?.length || total === 0) {
    return (
      <div className="report-card trend-card">
        {head}
        <div className="trend-empty muted">
          {failed ? 'Could not load the trend.' : `No submissions in the last ${days} days.`}
        </div>
      </div>
    );
  }

  const n = points.length;
  const maxY = Math.max(1, ...points.map((p) => p.count));
  const plotW = Math.max(1, w - PAD.l - PAD.r);
  const plotH = H - PAD.t - PAD.b;
  const x = (i) => PAD.l + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v) => PAD.t + plotH - (v / maxY) * plotH;
  const baseline = PAD.t + plotH;

  const line = points.map((p, i) => `${x(i)},${y(p.count)}`).join(' ');
  const area = `M ${x(0)},${baseline} L ${line.split(' ').join(' L ')} L ${x(n - 1)},${baseline} Z`;
  const last = points[n - 1];
  const active = hover == null ? null : points[hover];

  return (
    <div className="report-card trend-card">
      {head}
      <div
        className="trend-plot"
        ref={wrapRef}
        style={{ opacity: busy ? 0.5 : 1 }}   /* refetch holds the frame */
      >
        {w > 0 && (
          <svg
            width={w}
            height={H}
            role="img"
            aria-label={`Submissions per day for the last ${days} days. ${total} total, peaking at ${maxY} in a day.`}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          >
            {/* Area wash — the series hue at ~10%, never a saturated block. */}
            <path d={area} fill="color-mix(in srgb, var(--brand) 10%, transparent)" />

            {/* Axis: a solid hairline, one step off the surface. Never dashed. */}
            <line x1={PAD.l} y1={baseline} x2={w - PAD.r} y2={baseline} stroke="var(--border)" strokeWidth="1" />

            {/* Y ticks carry the values that aren't directly labelled. */}
            <text x={PAD.l - 6} y={baseline + 3} className="trend-tick" textAnchor="end">0</text>
            <text x={PAD.l - 6} y={PAD.t + 8} className="trend-tick" textAnchor="end">{maxY}</text>

            {/* X: first and last only — dense date ticks are unreadable at 90 points. */}
            <text x={PAD.l} y={H - 6} className="trend-tick">{fmtDay(points[0].date)}</text>
            <text x={w - PAD.r} y={H - 6} className="trend-tick" textAnchor="end">{fmtDay(last.date)}</text>

            {hover != null && (
              <line
                x1={x(hover)} y1={PAD.t} x2={x(hover)} y2={baseline}
                stroke="var(--border)" strokeWidth="1"
              />
            )}

            <polyline
              points={line}
              fill="none"
              stroke="var(--brand)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {/* End dot + the one direct label: the latest value. Labelling every
                point would be chaos; the crosshair carries the rest. */}
            <circle cx={x(n - 1)} cy={y(last.count)} r="4" fill="var(--brand)" stroke="var(--surface)" strokeWidth="2" />
            {hover != null && (
              <circle cx={x(hover)} cy={y(active.count)} r="4" fill="var(--brand)" stroke="var(--surface)" strokeWidth="2" />
            )}
          </svg>
        )}

        {hover != null && (
          <div
            className="trend-tip"
            style={{ left: Math.min(Math.max(x(hover), 44), Math.max(44, w - 44)) }}
          >
            {/* Value leads, label follows — the reader has the date, wants the number. */}
            <span className="trend-tip-val">{active.count}</span>
            <span className="trend-tip-day muted">{fmtDay(active.date)}</span>
          </div>
        )}
      </div>

      <div className="trend-foot muted">
        <span><strong className="trend-foot-n">{total}</strong> submitted in {days} days</span>
        <span>latest <strong className="trend-foot-n">{last.count}</strong> on {fmtDay(last.date)}</span>
      </div>
    </div>
  );
}
