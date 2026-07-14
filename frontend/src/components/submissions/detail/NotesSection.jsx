/**
 * Notes — user-authored comments (kind === 'comment' events). Composer at
 * the top (staff only), list below, auto-scrolling to the newest note when
 * one is appended (never on initial load). Ported from CP DetailPanel.jsx
 * ("Notes" block + handleAddComment + the notes-autoscroll effect).
 * Distinct from the general Activity timeline (status changes / system
 * events), which is not one of the extracted sections.
 *
 * Expects `submission.events` — the adminGetSubmission(id) events array —
 * alongside the submission's own fields (host should merge
 * `{ ...submission, events }` before passing it to any detail section).
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../api';
import { formatDateTime } from '../../../format';

export default function NotesSection({ submission, canAct, onChanged }) {
  const [newComment, setNewComment] = useState('');
  const [busy, setBusy] = useState(false);
  const notesEndRef = useRef(null);
  const prevNotesCount = useRef(null);

  const allEvents = submission?.events || [];
  const notes = allEvents.filter((ev) => ev.kind === 'comment');

  // Reset the auto-scroll baseline whenever a different submission is shown
  // (or this section is mounted fresh), so opening a new card never yanks
  // the scroll position.
  useEffect(() => {
    prevNotesCount.current = null;
  }, [submission?.id]);

  useEffect(() => {
    if (prevNotesCount.current != null && notes.length > prevNotesCount.current) {
      notesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
    prevNotesCount.current = notes.length;
  }, [notes.length]);

  if (!submission) return null;
  const s = submission;

  const handleAddComment = async () => {
    const text = newComment.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await api.adminAddComment(s.id, text);
      setNewComment('');
      const fresh = await api.adminGetSubmission(s.id);
      onChanged?.({ ...fresh.submission, events: fresh.events });
    } catch (err) {
      alert(err.message || 'Failed to add comment');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card-block">
      <div className="note-thread-head">
        <h3 style={{ marginBottom: 0 }}>Notes</h3>
        <span className="note-thread-count">{notes.length}</span>
      </div>
      {canAct && (
        <div className="note-input-row" style={{ marginBottom: notes.length > 0 ? 12 : 0 }}>
          <input
            placeholder="Add a note…"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleAddComment();
              }
            }}
            disabled={busy}
          />
          <button type="button" className="note-send" onClick={handleAddComment} disabled={busy || !newComment.trim()}>
            {busy ? '…' : '➤'}
          </button>
        </div>
      )}
      {notes.length > 0 ? (
        <div className="note-list">
          {notes.map((ev) => (
            <div key={ev.id} className="note-item">
              <div className="note-body">
                <div className="note-meta">
                  <strong>{ev.actor_name || 'System'}</strong>
                  {ev.actor_role && ev.actor_role !== 'cp' && (
                    <span className="role-chip">{ev.actor_role}</span>
                  )}
                  <span className="note-time">{formatDateTime(ev.created_at)}</span>
                </div>
                <div className="note-text">{ev.text}</div>
              </div>
            </div>
          ))}
          <div ref={notesEndRef} />
        </div>
      ) : (
        <div className="note-empty">No notes yet.</div>
      )}
    </div>
  );
}
