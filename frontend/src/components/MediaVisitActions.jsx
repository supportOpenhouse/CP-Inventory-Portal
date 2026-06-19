/**
 * CP action buttons for a listing: "Upload Media" and (only while Submitted)
 * "Book Visit Slot". Shared by the dashboard card and the detail modal so the
 * gating stays consistent.
 *
 *   - Upload Media: any stage except rejected (Rejected / Price Rejected).
 *   - Book Visit Slot: only 'Submitted' (booking pushes to 'Visit Requested').
 *   - When Book isn't shown, Upload Media fills the row (wider).
 *
 * Props:
 *   submission     — the row (uses .status)
 *   onUploadMedia  — () => void (opens the share-media modal)
 *   onBookSlot     — () => void (opens the book-visit modal)
 *   showHeading    — render the "Add photos/videos…" heading above the buttons
 */
export default function MediaVisitActions({ submission, onUploadMedia, onBookSlot, showHeading = false }) {
  const status = submission?.status;
  const canBook = status === 'Submitted';
  const canMedia = status !== 'Rejected' && status !== 'Price Rejected';
  if (!canMedia && !canBook) return null;

  const stop = (fn) => (e) => { e.stopPropagation(); fn?.(); };

  return (
    <div>
      {showHeading && (
        <div style={{
          fontSize: 11, fontWeight: 700, letterSpacing: 0.4,
          textTransform: 'uppercase', color: 'var(--oh-gray)', marginBottom: 10,
        }}>
          {canBook ? 'Add photos/videos and book visit slot' : 'Add photos/videos'}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        {canMedia && (
          <button
            type="button" className="primary-btn" style={{ flex: 1 }}
            onClick={stop(onUploadMedia)}
          >
            Upload Media
          </button>
        )}
        {canBook && (
          <button
            type="button" className="primary-btn"
            style={{ flex: 1, background: '#10B981', borderColor: '#10B981' }}
            onClick={stop(onBookSlot)}
          >
            Book Visit Slot
          </button>
        )}
      </div>
    </div>
  );
}
