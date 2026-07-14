import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useUnreadConversations } from '../hooks/useUnreadConversations';
import SegToggle from '../components/SegToggle.jsx';
import { stageMeta, stageLabel } from '../format';

// Pipeline order (funnel top → bottom, then the two terminal rejections). Each
// bar is directly labelled (stage name + value), so the stage colours — reused
// from the app's stage palette for consistency — never carry identity alone
// (they FAIL CVD adjacency, which is legal only with that secondary encoding).
const PIPELINE = [
  'Unapproved', 'Submitted', 'Visit Requested', 'Visit Scheduled',
  'Visit Completed', 'Offer', 'Closure', 'Price Rejected', 'Rejected',
];

export default function Home() {
  const { user } = useAuth();
  const isViewer = user?.role === 'viewer';
  const isAdmin = user?.role === 'admin';
  const unreadChats = useUnreadConversations({ city: user?.city, isAdmin, enabled: !isViewer });

  const [counts, setCounts] = useState({});
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(true);
  // New submissions per stage ({ count, latest }) for the chosen range.
  const [nsRange, setNsRange] = useState('today'); // 'today' | 'week'
  const [newSubs, setNewSubs] = useState({ loading: true, Unapproved: { count: 0, latest: null }, Submitted: { count: 0, latest: null } });

  useEffect(() => {
    let alive = true;
    api.adminListSubmissions({ limit: 1 })
      .then((d) => { if (alive) setCounts(d.counts || {}); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    if (!isViewer) {
      api.ticketsPendingCount().then((r) => { if (alive) setPending(r?.count || 0); }).catch(() => {});
    }
    return () => { alive = false; };
  }, [isViewer]);

  // New submissions in the chosen range. date_from..date_to scopes submitted_at
  // AND makes `counts` range-scoped; limit:1 → latest row per stage (PARTITION
  // BY status ORDER BY submitted_at DESC). Local dates. Week = rolling 7 days.
  useEffect(() => {
    let alive = true;
    setNewSubs((s) => ({ ...s, loading: true }));
    const fmt = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const today = new Date();
    const from = new Date(today);
    if (nsRange === 'week') from.setDate(today.getDate() - 6);
    api.adminListSubmissions({ date_from: fmt(from), date_to: fmt(today), limit: 1 })
      .then((res) => {
        if (!alive) return;
        const subs = res.submissions || [];
        const c = res.counts || {};
        const latestOf = (stage) => subs.find((s) => s.status === stage) || null;
        setNewSubs({
          loading: false,
          Unapproved: { count: c.Unapproved || 0, latest: latestOf('Unapproved') },
          Submitted: { count: c.Submitted || 0, latest: latestOf('Submitted') },
        });
      })
      .catch(() => { if (alive) setNewSubs((s) => ({ ...s, loading: false })); });
    return () => { alive = false; };
  }, [nsRange]);

  // Pipeline rows (skip admin-only stages for non-admins) + the max for scaling.
  const stages = PIPELINE.filter((k) => isAdmin || !stageMeta(k).adminOnly);
  const rows = stages.map((k) => ({ key: k, label: stageLabel(k), color: stageMeta(k).color, n: counts[k] ?? 0 }));
  const max = Math.max(1, ...rows.map((r) => r.n));

  // Outcomes: won (Closure), lost (both rejections), active (everything else).
  const total = counts.Total ?? 0;
  const won = counts.Closure ?? 0;
  const lost = (counts.Rejected ?? 0) + (counts['Price Rejected'] ?? 0);
  const active = Math.max(0, total - won - lost);
  const outcomes = [
    { label: 'Active', n: active, color: '#6366F1' },
    { label: 'Won', n: won, color: '#10B981' },
    { label: 'Lost', n: lost, color: '#DC2626' },
  ];

  return (
    <div className="home">
      <h2 className="home-sec">Updates</h2>
      <div className="home-updates">
        {/* New Submissions (left, narrow = Outcomes width) — today's Unapproved
            & Submitted counts + the latest of each. Whole card filters to both. */}
        <Link to="/submissions?status=Unapproved,Submitted" className="report-card home-newsubs">
          <div className="report-head">
            <h3>New Submissions</h3>
            {/* Range toggle (bare) — SegToggle stops the click bubbling to the card Link. */}
            <SegToggle
              bare
              options={[{ value: 'today', label: 'Today' }, { value: 'week', label: 'This week' }]}
              value={nsRange}
              onChange={setNsRange}
              style={{ marginLeft: 'auto' }}
            />
          </div>
          <div className="ns-cols">
            {['Unapproved', 'Submitted'].map((stage) => {
              const d = newSubs[stage];
              const latest = d.latest;
              const unit = latest && (latest.tower && latest.unit_no ? `${latest.tower}-${latest.unit_no}` : (latest.unit_no || ''));
              const meta = latest ? [unit, latest.bhk ? `${latest.bhk} BHK` : ''].filter(Boolean).join(' · ') : '';
              return (
                <div key={stage} className="ns-col">
                  <div className="ns-stage" style={{ color: stageMeta(stage).color }}>{stage}</div>
                  <div className="ns-count">{newSubs.loading ? '—' : d.count}</div>
                  <div className="ns-cap muted">added {nsRange === 'week' ? 'this week' : 'today'}</div>
                  <div className="ns-latest">
                    {newSubs.loading ? (
                      <span className="inv-skel" style={{ width: '85%', height: 12, display: 'block' }} />
                    ) : latest ? (
                      <>
                        <div className="ns-latest-soc">{latest.society_name || '—'}</div>
                        <div className="ns-latest-meta muted">{meta || latest.public_id || ''}</div>
                      </>
                    ) : (
                      <div className="ns-latest-meta muted">Nothing new {nsRange === 'week' ? 'this week' : 'today'}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Link>

        {/* Unread chats (right, wide = Pipeline width). Read-only preview list;
            the whole card navigates to /chat. */}
        <Link to="/chat" className="report-card home-unread">
          <div className="report-head">
            <h3>Unread Chats</h3>
            {!isViewer && unreadChats.length > 0 && (
              <span className="muted">{unreadChats.length} conversation{unreadChats.length === 1 ? '' : 's'}</span>
            )}
          </div>
          {isViewer ? (
            <div className="muted" style={{ fontSize: 13 }}>—</div>
          ) : unreadChats.length === 0 ? (
            <div className="muted" style={{ fontSize: 13 }}>No unread messages.</div>
          ) : (
            <div className="uc-list">
              {unreadChats.slice(0, 3).map((c) => (
                <div key={c.uid} className="uc-row">
                  <span className="uc-badge">{c.unread > 9 ? '9+' : c.unread}</span>
                  <div className="uc-body">
                    <div className="uc-name"><strong>{c.name}</strong></div>
                    <div className="uc-preview muted">{c.text || 'unread message'}</div>
                  </div>
                </div>
              ))}
              {unreadChats.length > 3 && (
                <div className="muted uc-more">+{unreadChats.length - 3} more unread →</div>
              )}
            </div>
          )}
        </Link>
      </div>

      <h2 className="home-sec">Summary</h2>
      <div className="home-reports">
        {/* Pipeline — horizontal magnitude bars, one per stage, clickable to filter. */}
        <div className="report-card">
          <div className="report-head">
            <h3>Pipeline</h3>
            <span className="muted">by stage · click to filter</span>
          </div>
          <div className="pl-list">
            {loading
              ? Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="pl-row pl-row-skel">
                  <span className="inv-skel" style={{ width: '70%', height: 11 }} />
                  <span className="pl-track"><span className="inv-skel" style={{ width: `${30 + (i * 9) % 60}%`, height: 22, display: 'block' }} /></span>
                  <span className="inv-skel" style={{ width: 20, height: 11 }} />
                </div>
              ))
              : rows.map((r) => (
                <Link
                  key={r.key}
                  to={`/submissions?status=${encodeURIComponent(r.key)}`}
                  className="pl-row"
                  title={`${r.label} · ${r.n}${total ? ` (${Math.round((r.n / total) * 100)}%)` : ''}`}
                >
                  <span className="pl-label">{r.label}</span>
                  <span className="pl-track">
                    <span className="pl-fill" style={{ width: `${(r.n / max) * 100}%`, minWidth: r.n > 0 ? 4 : 0, background: r.color }} />
                  </span>
                  <span className="pl-val">{r.n}</span>
                </Link>
              ))}
          </div>
        </div>

        {/* Right column: Outcomes on top, Tickets below — together they match
            the pipeline's height (grid stretches the column; Tickets flex-grows
            to fill), and both stay within the narrower column's width. */}
        <div className="home-right">
          {/* Outcomes — hero total + a labelled composition bar (active / won / lost). */}
          <div className="report-card">
            <div className="report-head"><h3>Outcomes</h3></div>
            <div className="oc-total">{loading ? '—' : total}</div>
            <div className="oc-total-lbl muted">total submissions</div>

            <div className="oc-bar" role="img" aria-label="Outcome composition">
              {outcomes.map((o) => (
                <span
                  key={o.label}
                  className="oc-seg"
                  title={`${o.label} · ${o.n}`}
                  style={{ flexGrow: Math.max(o.n, total ? 0 : 1), background: o.color, minWidth: o.n > 0 ? 4 : 0 }}
                />
              ))}
            </div>

            <div className="oc-legend">
              {outcomes.map((o) => (
                <div key={o.label} className="oc-leg-row">
                  <span className="oc-dot" style={{ background: o.color }} />
                  <span className="oc-leg-lbl">{o.label}</span>
                  <span className="oc-leg-val">{loading ? '—' : o.n}</span>
                  <span className="oc-leg-pct muted">{loading || !total ? '' : `${Math.round((o.n / total) * 100)}%`}</span>
                </div>
              ))}
            </div>
          </div>

          {!isViewer && (
            <Link to="/tickets" className="task-card task-card-link home-tickets" style={{ '--tc': '#2563eb' }}>
              <span className="st-num" style={{ color: '#2563eb', minWidth: 56 }}>{pending}</span>
              <span className="muted">unresolved ticket{pending === 1 ? '' : 's'}→</span>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
