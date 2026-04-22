import { useEffect, useState } from 'react';

import { api, ApiError } from '../api';
import { thumbnailUrl } from '../cloudinary';
import { formatDateTime, formatPrice } from '../format';

/**
 * Full-screen modal showing all details of a CP's submission:
 *   - Unit info (society, tower, unit, floor, BHK, sqft, registry)
 *   - Pricing (asking + closing + counter offer)
 *   - Photos
 *   - Current status with clear source (Openhouse vs you)
 *   - Timeline of events
 */
export default function SubmissionDetailModal({ submission, onClose }) {
  const s = submission;
  const [events, setEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(true);

  useEffect(() => {
    let alive = true;
    api.listMySubmissionEvents(s.id)
      .then((data) => { if (alive) setEvents(data.events || []); })
      .catch(() => { if (alive) setEvents([]); })
      .finally(() => { if (alive) setLoadingEvents(false); });
    return () => { alive = false; };
  }, [s.id]);

  // Determine clear rejection source
  let rejectionSource = null;
  if (s.status === 'Rejected') {
    if (s.counter_offer_status === 'rejected') {
      rejectionSource = { by: 'you', label: 'You rejected the counter offer from Openhouse' };
    } else {
      rejectionSource = { by: 'openhouse', label: 'This listing was rejected by Openhouse' };
    }
  }

  const thumbId = Array.isArray(s.photos) && s.photos.length > 0 ? s.photos[0] : null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
        zIndex: 1000, display: 'flex', alignItems: 'flex-end',
        justifyContent: 'center', backdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', width: '100%', maxWidth: 560, maxHeight: '92vh',
          borderRadius: '16px 16px 0 0', overflow: 'auto', display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 20px', borderBottom: '1px solid var(--oh-border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            position: 'sticky', top: 0, background: '#fff', zIndex: 2,
          }}
        >
          <div>
            <div style={{ fontFamily: 'Fraunces, serif', fontSize: 18, fontWeight: 700 }}>
              {s.society_name}
            </div>
            {s.public_id && (
              <div style={{
                fontSize: 11, color: 'var(--oh-gray)', fontFamily: 'monospace',
                fontWeight: 600, letterSpacing: '0.5px', marginTop: 2,
              }}>
                {s.public_id}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', fontSize: 24, color: 'var(--oh-gray)',
              cursor: 'pointer', padding: 4, lineHeight: 1,
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div style={{ padding: '16px 20px' }}>
          {/* Rejection source — most important, show first */}
          {rejectionSource && (
            <div
              style={{
                padding: '12px 14px',
                background: rejectionSource.by === 'you' ? '#FFF3ED' : '#FEE2E2',
                border: `1.5px solid ${rejectionSource.by === 'you' ? '#FF6B2B' : '#DC2626'}`,
                borderRadius: 10,
                marginBottom: 16,
              }}
            >
              <div style={{
                fontSize: 10, fontWeight: 700,
                color: rejectionSource.by === 'you' ? '#FF6B2B' : '#DC2626',
                letterSpacing: '0.5px', marginBottom: 4,
              }}>
                REJECTED
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--oh-charcoal)' }}>
                {rejectionSource.label}
              </div>
              {s.counter_offer_response_text && (
                <div style={{ fontSize: 12, color: 'var(--oh-gray)', marginTop: 6, fontStyle: 'italic' }}>
                  Your note: "{s.counter_offer_response_text}"
                </div>
              )}
            </div>
          )}

          {/* Photo */}
          {thumbId && (
            <img
              src={thumbnailUrl(thumbId, 560)}
              alt=""
              style={{
                width: '100%', maxHeight: 200, objectFit: 'cover',
                borderRadius: 10, marginBottom: 16,
              }}
            />
          )}

          {/* Unit info */}
          <SectionTitle>Unit Details</SectionTitle>
          <DetailGrid>
            <Row label="BHK" value={s.bhk} />
            <Row label="Floor" value={s.floor} />
            <Row label="Tower" value={s.tower} />
            <Row label="Unit No" value={s.unit_no} />
            <Row label="Area" value={s.sqft ? `${s.sqft} sqft` : null} />
            <Row label="Registry" value={s.registry_status} />
            {s.furnishing && <Row label="Furnishing" value={s.furnishing} />}
            {s.parking && <Row label="Parking" value={s.parking} />}
            {s.exit_facing && <Row label="Exit facing" value={s.exit_facing} />}
            {s.balcony_facing && <Row label="Balcony facing" value={s.balcony_facing} />}
            {s.balcony_view && <Row label="Balcony view" value={s.balcony_view} />}
            {Array.isArray(s.extra_rooms) && s.extra_rooms.length > 0 && (
              <Row label="Extras" value={s.extra_rooms.join(', ')} colSpan={2} />
            )}
          </DetailGrid>

          {/* Pricing */}
          <SectionTitle>Pricing</SectionTitle>
          <DetailGrid>
            <Row label="Asking" value={formatPrice(s.asking_price)} />
            <Row label="Closing" value={formatPrice(s.closing_price)} />
          </DetailGrid>

          {/* Counter offer — if any */}
          {s.counter_offer_price && (
            <>
              <SectionTitle>Counter Offer from Openhouse</SectionTitle>
              <div
                style={{
                  padding: '12px 14px',
                  background: s.counter_offer_status === 'pending' ? '#FFF8EC' :
                              s.counter_offer_status === 'accepted' ? '#ECFDF5' : '#FEE2E2',
                  border: `1px solid ${
                    s.counter_offer_status === 'pending' ? '#E8A838' :
                    s.counter_offer_status === 'accepted' ? '#10B981' : '#DC2626'
                  }`,
                  borderRadius: 10,
                }}
              >
                <div style={{ fontSize: 16, fontWeight: 700 }}>
                  {formatPrice(s.counter_offer_price)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--oh-gray)', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 2 }}>
                  Status: {s.counter_offer_status || '—'}
                </div>
                {s.counter_offer_at && (
                  <div style={{ fontSize: 11, color: 'var(--oh-gray)', marginTop: 2 }}>
                    Sent {formatDateTime(s.counter_offer_at)}
                  </div>
                )}
                {s.counter_offer_response_text && (
                  <div style={{ marginTop: 8, padding: '8px 10px', background: 'rgba(255,255,255,0.6)', borderRadius: 6, fontSize: 13, color: 'var(--oh-charcoal)' }}>
                    Your note: "{s.counter_offer_response_text}"
                  </div>
                )}
              </div>
            </>
          )}

          {/* Timeline */}
          <SectionTitle>Timeline</SectionTitle>
          {loadingEvents ? (
            <div style={{ color: 'var(--oh-gray)', fontSize: 13, padding: '8px 0' }}>
              Loading timeline…
            </div>
          ) : events.length === 0 ? (
            <div style={{ color: 'var(--oh-gray)', fontSize: 13, padding: '8px 0' }}>
              No events recorded.
            </div>
          ) : (
            <div style={{ position: 'relative', paddingLeft: 20 }}>
              {events.map((ev, i) => (
                <div key={ev.id} style={{ position: 'relative', paddingBottom: i === events.length - 1 ? 0 : 14 }}>
                  {/* Dot */}
                  <div
                    style={{
                      position: 'absolute', left: -16, top: 4, width: 10, height: 10,
                      borderRadius: '50%', background: 'var(--oh-orange)',
                      border: '2px solid #fff', boxShadow: '0 0 0 1px var(--oh-border)',
                    }}
                  />
                  {/* Line */}
                  {i < events.length - 1 && (
                    <div
                      style={{
                        position: 'absolute', left: -12, top: 14, width: 2, bottom: -4,
                        background: 'var(--oh-border)',
                      }}
                    />
                  )}
                  <div style={{ fontSize: 13, color: 'var(--oh-charcoal)' }}>
                    {ev.kind === 'status_change' && (
                      <>Status: <strong>{ev.from_status || '—'}</strong> → <strong>{ev.to_status}</strong></>
                    )}
                    {ev.kind === 'system' && ev.to_status && (
                      <>Status: <strong>{ev.to_status}</strong></>
                    )}
                    {ev.kind === 'counter_offer' && <strong>Counter offer</strong>}
                    {ev.kind === 'comment' && <strong>Comment</strong>}
                  </div>
                  {ev.text && (
                    <div style={{ fontSize: 12, color: 'var(--oh-gray)', marginTop: 2 }}>
                      {ev.text}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--oh-gray)', marginTop: 2 }}>
                    {formatDateTime(ev.created_at)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color: 'var(--oh-gray)',
      textTransform: 'uppercase', letterSpacing: '0.5px',
      marginTop: 16, marginBottom: 8,
    }}>
      {children}
    </div>
  );
}

function DetailGrid({ children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px' }}>
      {children}
    </div>
  );
}

function Row({ label, value, colSpan = 1 }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div style={{ gridColumn: `span ${colSpan}` }}>
      <div style={{ fontSize: 10, color: 'var(--oh-gray)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.3px' }}>
        {label}
      </div>
      <div style={{ fontSize: 14, color: 'var(--oh-charcoal)', marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}
