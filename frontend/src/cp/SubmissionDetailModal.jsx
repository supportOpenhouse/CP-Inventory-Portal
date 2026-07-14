import { useEffect, useState } from 'react';

import { api, ApiError } from '../api';
import { thumbnailUrl, cloudinaryUrl } from '../cloudinary';
import { formatBhk, formatDateTime, formatPrice } from '../format';
import ShareMediaModal from './ShareMediaModal';
import BookVisitModal from './BookVisitModal';
import MediaVisitActions from './MediaVisitActions';

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
  // Play the slide-down exit before actually unmounting (keep in sync with the
  // .cp-sheet.closing animation duration in styles.css).
  const [closing, setClosing] = useState(false);
  const close = () => { if (closing) return; setClosing(true); setTimeout(onClose, 250); };
  const [events, setEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [showAllEvents, setShowAllEvents] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [visitOpen, setVisitOpen] = useState(false);
  // Local copies so the "Uploaded media" gallery + limits update right after an
  // upload, without refetching the whole submission.
  const [photos, setPhotos] = useState(Array.isArray(s.photos) ? s.photos : []);
  const [videos, setVideos] = useState(Array.isArray(s.videos) ? s.videos : []);

  useEffect(() => {
    setPhotos(Array.isArray(s.photos) ? s.photos : []);
    setVideos(Array.isArray(s.videos) ? s.videos : []);
  }, [s.id]);

  const reloadEvents = () => {
    api.listMySubmissionEvents(s.id)
      .then((data) => setEvents(data.events || []))
      .catch(() => {});
  };

  const handleDeleteVideo = (publicId) => {
    if (!publicId || !window.confirm('Delete this video?')) return;
    api.deleteVideo(s.id, publicId)
      .then((res) => { if (Array.isArray(res?.videos)) setVideos(res.videos); reloadEvents(); })
      .catch(() => {});
  };

  useEffect(() => {
    let alive = true;
    setLoadingEvents(true);
    api.listMySubmissionEvents(s.id)
      .then((data) => { if (alive) setEvents(data.events || []); })
      .catch(() => { if (alive) setEvents([]); })
      .finally(() => { if (alive) setLoadingEvents(false); });
    return () => { alive = false; };
  }, [s.id]);

  // Determine clear rejection source.
  // CPs see only the 'Rejected' label (status_reason is admin-only), so we
  // use the perfect_match_at_submit flag — already exposed to the CP — to
  // distinguish "auto-rejected as duplicate at submit" from other rejections.
  let rejectionSource = null;
  if (s.status === 'Price Rejected' || s.status === 'Rejected') {
    if (s.counter_offer_status === 'rejected') {
      rejectionSource = { by: 'you', label: 'You rejected the counter offer from Openhouse' };
    } else if (s.perfect_match_at_submit) {
      rejectionSource = { by: 'openhouse', label: 'This listing was already in Openhouse inventory' };
    } else {
      rejectionSource = { by: 'openhouse', label: 'This listing was rejected by Openhouse' };
    }
  }

  const notRejected = s.status !== 'Rejected' && s.status !== 'Price Rejected';
  const hasMedia = photos.length > 0 || videos.length > 0;

  // Timeline: newest first, latest 2, then a "+N" button reveals the rest.
  const sortedEvents = [...events].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const shownEvents = showAllEvents ? sortedEvents : sortedEvents.slice(0, 2);
  const extraEvents = sortedEvents.length - shownEvents.length;

  return (
    <>
    <div
      className={`cp-sheet-overlay${closing ? ' closing' : ''}`}
      onClick={close}
    >
      <div
        className={`cp-sheet${closing ? ' closing' : ''}`}
        onClick={(e) => e.stopPropagation()}
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
            onClick={close}
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

          {/* Actions. No media yet → Upload Media + Book Visit sit side by side
              here. Once media exists → Upload moves to the gallery card below
              and only Book Visit (Submitted) stays up top. */}
          {notRejected && (!hasMedia || s.status === 'Submitted') && (
            <div style={{
              border: '1px solid var(--oh-border)', borderRadius: 12,
              padding: 14, marginBottom: 16, background: '#FAFAFA',
            }}>
              <MediaVisitActions
                submission={s}
                showHeading
                hideUploadMedia={hasMedia}
                onUploadMedia={() => setMediaOpen(true)}
                onBookSlot={() => setVisitOpen(true)}
              />
            </div>
          )}

          {/* Unit info */}
          <SectionTitle>Unit Details</SectionTitle>
          <DetailGrid>
            <Row label="BHK" value={formatBhk(s.bhk, false)} />
            <Row label="Floor" value={s.floor} />
            <Row label="Tower" value={s.tower} />
            <Row label="Unit No" value={s.unit_no} />
            <Row label="Area" value={s.sqft ? `${s.sqft} sqft` : null} />
            <Row label="Occupancy" value={s.occupancy_status} />
          </DetailGrid>

          {/* Pricing */}
          <SectionTitle>Pricing</SectionTitle>
          <DetailGrid>
            <Row label="Asking" value={formatPrice(s.asking_price)} />
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
              {shownEvents.map((ev, i) => (
                <div key={ev.id} style={{ position: 'relative', paddingBottom: i === shownEvents.length - 1 ? 0 : 14 }}>
                  {/* Dot */}
                  <div
                    style={{
                      position: 'absolute', left: -16, top: 4, width: 10, height: 10,
                      borderRadius: '50%', background: 'var(--oh-orange)',
                      border: '2px solid #fff', boxShadow: '0 0 0 1px var(--oh-border)',
                    }}
                  />
                  {/* Line */}
                  {i < shownEvents.length - 1 && (
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
              {extraEvents > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAllEvents(true)}
                  style={{ background: 'none', border: 0, padding: '6px 0 0', color: 'var(--oh-orange)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
                >
                  +{extraEvents} more
                </button>
              )}
            </div>
          )}

          {/* Uploaded media — all photos + videos for this listing, at the bottom. */}
          {notRejected && (
            <div style={{
              border: '1px solid var(--oh-border)', borderRadius: 12,
              padding: 14, marginTop: 8,
            }}>
              <div style={{
                fontSize: 11, fontWeight: 700, letterSpacing: 0.4,
                textTransform: 'uppercase', color: 'var(--oh-gray)', marginBottom: 10,
              }}>
                Uploaded media
              </div>

              {(photos.length > 0 || videos.length > 0) ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                  {photos.map((pid) => (
                    <a key={pid} href={cloudinaryUrl(pid)} target="_blank" rel="noopener noreferrer">
                      <img
                        src={thumbnailUrl(pid, 80)} alt=""
                        style={{ width: 72, height: 72, borderRadius: 8, objectFit: 'cover', display: 'block' }}
                      />
                    </a>
                  ))}
                  {videos.map((v, i) => (
                    <div key={v.public_id || i} style={{ position: 'relative' }}>
                      <video
                        src={v.url} controls preload="metadata"
                        style={{ width: 120, height: 72, borderRadius: 8, background: '#000', objectFit: 'cover', display: 'block' }}
                      />
                      {v.public_id && (
                        <button
                          type="button"
                          onClick={() => handleDeleteVideo(v.public_id)}
                          aria-label="Delete video"
                          style={{
                            position: 'absolute', top: 4, right: 4, width: 22, height: 22,
                            borderRadius: '50%', border: 'none', cursor: 'pointer', padding: 0,
                            background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 15, lineHeight: '22px',
                          }}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--oh-gray)', marginBottom: 12 }}>
                  No media uploaded yet.
                </div>
              )}

              {hasMedia && (
                <button
                  type="button" className="primary-btn" style={{ width: '100%' }}
                  onClick={() => setMediaOpen(true)}
                >
                  Upload Media
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>

    <ShareMediaModal
      open={mediaOpen}
      submissionId={s.id}
      photoCount={photos.length}
      videoCount={videos.length}
      onClose={() => setMediaOpen(false)}
      onShared={(res) => {
        if (res && Array.isArray(res.photos)) setPhotos(res.photos);
        if (res && Array.isArray(res.videos)) setVideos(res.videos);
        reloadEvents();
      }}
    />
    <BookVisitModal
      open={visitOpen}
      submissionId={s.id}
      onClose={() => setVisitOpen(false)}
      onBooked={reloadEvents}
    />
    </>
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
