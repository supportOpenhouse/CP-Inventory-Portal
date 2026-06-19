import { useRef, useState } from 'react';

import { api, ApiError } from '../api';
import { uploadToCloudinary, validateFile, validateVideo } from '../cloudinary';

/**
 * CP "Share media" popup — two buttons (Photo / Video). Each opens the device
 * gallery (multiple selection, respective formats only), uploads every file to
 * Cloudinary, then records the references on the submission.
 *
 * Props: open, submissionId, onClose, onShared (fires after a successful share)
 */
export default function ShareMediaModal({ open, submissionId, onClose, onShared }) {
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
      await api.shareMedia(submissionId, { photos, videos });
      setProgress(null);
      setDone(`Shared ${files.length} ${kind === 'video' ? 'video(s)' : 'photo(s)'}.`);
      onShared?.();
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
          Add photos or videos for this unit. You can pick multiple files.
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
            disabled={busy} onClick={() => photoInputRef.current?.click()}
          >
            Photo
          </button>
          <button
            type="button" className="primary-btn"
            style={{ flex: 1, background: '#10B981', borderColor: '#10B981' }}
            disabled={busy} onClick={() => videoInputRef.current?.click()}
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
