import { useCallback, useEffect, useState } from 'react';

import { api, ApiError } from '../../api';
import { formatDateTime, formatPrice, stageMeta, STAGES } from '../../format';

export default function CpHistoryDrawer({ cpId, onClose, onOpenSubmission }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.adminGetCpHistory(cpId);
      setData(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [cpId]);

  useEffect(() => { load(); }, [load]);

  const cp = data?.cp;
  const subs = data?.submissions || [];
  const summary = data?.summary || {};

  return (
    <>
      <div className="panel-overlay" onClick={onClose} />
      <div className="admin-panel admin-panel-cp">
        <div className="admin-panel-header">
          <div style={{ flex: 1, minWidth: 0 }}>
            {loading ? (
              <div style={{ fontSize: 16, color: '#999' }}>Loading CP history…</div>
            ) : error ? (
              <div style={{ fontSize: 14, color: 'var(--oh-red)' }}>{error}</div>
            ) : cp ? (
              <>
                <div className="admin-panel-title">{cp.name}</div>
                <div className="admin-panel-sub">
                  {cp.cp_code} · +91 {cp.phone}
                  {cp.company ? ` · ${cp.company}` : ''}
                  {cp.city ? ` · ${cp.city}` : ''}
                </div>
              </>
            ) : null}
          </div>
          <button className="panel-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="admin-panel-body">
          {cp && (
            <>
              {/* Summary stats */}
              <div className="admin-panel-section">
                <div className="admin-panel-section-title">
                  Summary · {subs.length} submission{subs.length === 1 ? '' : 's'}
                </div>
                <div className="cp-stats-row">
                  {STAGES.map((st) => (
                    <div key={st.key} className="cp-stat">
                      <span className="cp-stat-dot" style={{ background: st.color }} />
                      <span className="cp-stat-count">{summary[st.key] || 0}</span>
                      <span className="cp-stat-label">{st.key}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Submissions list */}
              <div className="admin-panel-section" style={{ borderBottom: 'none' }}>
                <div className="admin-panel-section-title">All submissions</div>
                {subs.length === 0 && (
                  <div style={{ fontSize: 13, color: '#999' }}>No submissions yet.</div>
                )}
                {subs.map((s) => {
                  const stage = stageMeta(s.status);
                  return (
                    <button
                      key={s.id}
                      className="cp-history-row"
                      onClick={() => onOpenSubmission?.(s.id)}
                      title="Open this submission"
                    >
                      <div className="cp-history-main">
                        <div className="cp-history-title">
                          {s.society_name}
                          {s.weak_match && (
                            <span style={{ color: '#DC2626', marginLeft: 6 }} title="Weak match">⚠</span>
                          )}
                        </div>
                        <div className="cp-history-meta">
                          {[
                            s.bhk,
                            s.sqft ? `${s.sqft} sqft` : null,
                            s.tower && s.unit_no ? `${s.tower}-${s.unit_no}` : s.unit_no,
                            s.floor ? `Fl ${s.floor}` : null,
                            s.city,
                          ].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      <div className="cp-history-right">
                        <span
                          className="status-pill"
                          style={{ background: stage.bg, color: stage.color }}
                        >
                          {s.status}
                        </span>
                        <div className="cp-history-price">{formatPrice(s.asking_price)}</div>
                        <div className="cp-history-time">{formatDateTime(s.submitted_at)}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}