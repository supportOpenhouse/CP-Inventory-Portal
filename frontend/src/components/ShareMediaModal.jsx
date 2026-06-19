import { useRef, useState } from 'react';

import { api, ApiError } from '../api';
import { uploadToCloudinary, validateFile, validateVideo } from '../cloudinary';

/**
 * CP "Share media" popup — two buttons (Photo / Video). Each opens the device
 * gallery (multiple selection, respective formats only), uploads every file to
 * Cloudinary, then records the references on the submission.
 *
 * Props: open, submissionId, onClose, onShared (fires after a successful share,
 *        receives the updated { photos, videos } lists), photoCount/videoCount
 *        (how many already exist, for enforcing the per-listing limits).
 */
export const PHOTO_LIMIT = 15;
export const VIDEO_LIMIT = 1;

export default function ShareMediaModal({
  open, submissionId, onClose, onShared, photoCount = 0, videoCount = 0,
}) {
  const photoInputRef = useRef(null);
  const videoInputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total, pct }
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  if (!open) return null;

  const handleFiles = async (fileList, kind) => {
    setError('');
    setDone('');
    const files = Array.from(fileList || []);
    if (!files.length) return;

    const validate = kind === 'video' ? validateVideo : validateFile;
    for (const f of files) {
      const msg = validate(f);
      if (msg) { setError(msg); return; }
    }

    // Enforce per-listing limits (existing + this batch).
    if (kind === 'video' && videoCount + files.length > VIDEO_LIMIT) {
      setError(`Max ${VIDEO_LIMIT} videos per listing (you have ${videoCount}).`);
      return;
    }
    if (kind !== 'video' && photoCount + files.length > PHOTO_LIMIT) {
      setError(`Max ${PHOTO_LIMIT} photos per listing (you have ${photoCount}).`);
      return;
    }

    setBusy(true);
    try {
      const photos = [];
      const videos = [];
      for (let i = 0; i < files.length; i++) {
        setProgress({ done: i, total: files.length, pct: 0 });
        const res = await uploadToCloudinary(
          files[i],
          (pct) => setProgress({ done: i, total: files.length, pct }),
          kind === 'video' ? 'video' : 'image',
        );
        if (kind === 'video') videos.push({ public_id: res.publicId, url: res.secureUrl });
        else photos.push(res.publicId);
      }
      const res = await api.shareMedia(submissionId, { photos, videos });
      setProgress(null);
      setDone(`Shared ${files.length} ${kind === 'video' ? 'video(s)' : 'photo(s)'}.`);
      onShared?.(res);  // res = { ok, photos, videos } — updated full lists
      onClose?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e?.message || 'Upload failed'));
    } finally {
      setBusy(false);
      // reset so the same file can be re-selected later
      if (photoInputRef.current) photoInputRef.current.value = '';
      if (videoInputRef.current) videoInputRef.current.value = '';
    }
  };

  return (
    <div
      onClick={busy ? undefined : onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
        zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20, backdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 16, padding: 22, maxWidth: 360, width: '100%',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ fontFamily: 'Fraunces, serif', fontSize: 20, fontWeight: 700, color: 'var(--oh-charcoal)', marginBottom: 6 }}>
          Share media
        </div>
        <div style={{ fontSize: 13, color: 'var(--oh-gray)', marginBottom: 16, lineHeight: 1.5 }}>
          Add photos or video for this unit. You can pick multiple files.
          <br />
          <span style={{ fontSize: 12 }}>
            Photos {photoCount}/{PHOTO_LIMIT} · Video {videoCount}/{VIDEO_LIMIT}
          </span>
        </div>

        <input
          ref={photoInputRef} type="file" accept="image/*" multiple
          style={{ display: 'none' }}
          onChange={(e) => handleFiles(e.target.files, 'photo')}
        />
        <input
          ref={videoInputRef} type="file" accept="video/*" multiple
          style={{ display: 'none' }}
          onChange={(e) => handleFiles(e.target.files, 'video')}
        />

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button" className="primary-btn" style={{ flex: 1 }}
            disabled={busy || photoCount >= PHOTO_LIMIT}
            onClick={() => photoInputRef.current?.click()}
          >
            Photos
          </button>
          <button
            type="button" className="primary-btn"
            style={{ flex: 1, background: '#10B981', borderColor: '#10B981' }}
            disabled={busy || videoCount >= VIDEO_LIMIT}
            onClick={() => videoInputRef.current?.click()}
          >
            Video
          </button>
        </div>

        {busy && progress && (
          <div style={{ marginTop: 14, fontSize: 13, color: 'var(--oh-gray)' }}>
            Uploading {progress.done + 1}/{progress.total}… {progress.pct}%
          </div>
        )}
        {error && <div className="error-text" style={{ marginTop: 12 }}>{error}</div>}
        {done && <div style={{ marginTop: 12, fontSize: 13, color: '#10B981' }}>{done}</div>}

        <button
          type="button" onClick={onClose} disabled={busy}
          style={{
            marginTop: 16, width: '100%', padding: 10, borderRadius: 10,
            border: '1.5px solid var(--oh-border)', background: '#fff',
            fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
          }}
        >
          {busy ? 'Uploading…' : 'Close'}
        </button>
      </div>
    </div>
  );
}
