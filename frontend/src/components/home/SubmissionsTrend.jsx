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
import { useCallback, useEffect, useRef, useState } from 'react';

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

// Round the y-axis top up to a clean number so ticks read 0/40/80, not 0/32.5/65.
const NICE = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
function niceMax(v) {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (NICE.find((s) => n <= s) ?? 10) * pow;
}

/**
 * Monotone cubic (Fritsch–Carlson) through the points, as an SVG path.
 *
 * Deliberately NOT a plain Catmull-Rom/cardinal spline: those overshoot around
 * a spike, so the curve would dip BELOW ZERO between two quiet days and draw
 * negative submissions — inventing data the series doesn't contain. A monotone
 * fit cannot overshoot: between two points it never leaves their value range,
 * so a 0 day stays flat at 0.
 */
function monotonePath(pts) {
  const n = pts.length;
  if (n < 2) return n === 1 ? `M ${pts[0].x},${pts[0].y}` : '';

  const dx = [];
  const slope = [];
  for (let i = 0; i < n - 1; i += 1) {
    dx[i] = pts[i + 1].x - pts[i].x;
    slope[i] = (pts[i + 1].y - pts[i].y) / dx[i];
  }

  // Tangents: zero at every local extremum (that's what kills the overshoot),
  // weighted harmonic mean elsewhere.
  const m = new Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i += 1) {
    if (slope[i - 1] * slope[i] <= 0) {
      m[i] = 0;
    } else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      m[i] = (w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i]);
    }
  }

  let d = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < n - 1; i += 1) {
    const h = dx[i] / 3;
    d += ` C ${pts[i].x + h},${pts[i].y + m[i] * h}`
       + ` ${pts[i + 1].x - h},${pts[i + 1].y - m[i + 1] * h}`
       + ` ${pts[i + 1].x},${pts[i + 1].y}`;
  }
  return d;
}

export default function SubmissionsTrend() {
  const [days, setDays] = useState(30);
  const [points, setPoints] = useState(null);   // null → never loaded yet
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState(null);     // index of the crosshair's point

  const [w, setW] = useState(0);
  const roRef = useRef(null);

  // Callback ref, not useRef + useLayoutEffect([]): the plot div does not exist
  // on first render (the skeleton returns before it), so a mount-time effect
  // finds a null ref, bails, and — with empty deps — never retries. `w` would
  // stay 0 and `{w > 0 && <svg/>}` would render an empty card forever. This
  // fires whenever the node actually attaches.
  const wrapRef = useCallback((node) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!node) return;
    setW(node.getBoundingClientRect().width);   // paint this frame, don't wait for the observer
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(node);
    roRef.current = ro;
  }, []);

  useEffect(() => () => roRef.current?.disconnect(), []);

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
  const peak = Math.max(1, ...points.map((p) => p.count));
  const maxY = niceMax(peak);
  const plotW = Math.max(1, w - PAD.l - PAD.r);
  const plotH = H - PAD.t - PAD.b;
  const x = (i) => PAD.l + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v) => PAD.t + plotH - (v / maxY) * plotH;
  const baseline = PAD.t + plotH;

  const xy = points.map((p, i) => ({ x: x(i), y: y(p.count) }));
  const line = monotonePath(xy);
  const area = `${line} L ${x(n - 1)},${baseline} L ${x(0)},${baseline} Z`;
  const ticks = [0, maxY / 2, maxY];
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
            aria-label={`Submissions per day for the last ${days} days. ${total} total, peaking at ${peak} in a day.`}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          >
            <defs>
              {/* Fade the wash out downwards so the curve reads as the mark and
                  the fill stays a wash, never a block. */}
              <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--brand)" stopOpacity="0.20" />
                <stop offset="1" stopColor="var(--brand)" stopOpacity="0" />
              </linearGradient>
            </defs>

            <path d={area} fill="url(#trend-fill)" />

            {/* Gridlines + axis: solid hairlines one step off the surface, never
                dashed — dashing reads as "threshold" when it's just a grid. */}
            {ticks.map((t) => (
              <line
                key={t}
                x1={PAD.l} y1={y(t)} x2={w - PAD.r} y2={y(t)}
                stroke="var(--border)" strokeWidth="1"
                opacity={t === 0 ? 1 : 0.55}
              />
            ))}

            {/* Y ticks carry the values that aren't directly labelled — load-bearing
                here, since the brand hue is under 3:1 on the light surface. */}
            {ticks.map((t) => (
              <text key={t} x={PAD.l - 6} y={y(t) + 3} className="trend-tick" textAnchor="end">{t}</text>
            ))}

            {/* X: first and last only — dense date ticks are unreadable at 90 points. */}
            <text x={PAD.l} y={H - 6} className="trend-tick">{fmtDay(points[0].date)}</text>
            <text x={w - PAD.r} y={H - 6} className="trend-tick" textAnchor="end">{fmtDay(last.date)}</text>

            {hover != null && (
              <line
                x1={x(hover)} y1={PAD.t} x2={x(hover)} y2={baseline}
                stroke="var(--border)" strokeWidth="1"
              />
            )}

            <path
              d={line}
              fill="none"
              stroke="var(--brand)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {/* The pulse: a short bright dash swept along the same curve.
                pathLength="100" normalises the dash to percent, so one CSS
                keyframe works for both 30 and 90 points and any card width.
                Purely decorative — aria-hidden, and CSS drops it entirely under
                prefers-reduced-motion. */}
            <path
              className="trend-pulse"
              d={line}
              pathLength="100"
              fill="none"
              stroke="var(--brand-strong)"
              strokeWidth="2.5"
              strokeLinecap="round"
              aria-hidden="true"
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
